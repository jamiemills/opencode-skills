import { constants as fsConstants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, rename, rm, link, unlink, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { parseJson } from "../schema-runtime/index.mjs";

const { O_APPEND, O_CREAT, O_EXCL, O_NOFOLLOW, O_RDONLY, O_WRONLY } = fsConstants;

// Stable diagnostics for operators and replay tests. Callers may add a domain prefix.
export const DURABLE_RECOVERY_CODES = Object.freeze({
  symlink: "unsafe path component",
  "partial-tail": "unterminated JSONL tail",
  "duplicate-identity": "duplicate JSONL identity",
  "durable-locked": "live or unclaimed durable lock",
  "lock-ownership": "lock changed before release",
  "concurrent-replacement": "file changed during read",
});

function failure(code, message, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code });
}

export async function assertNoSymlinkComponents(
  path,
  { root = null, allowMissingLeaf = false } = {},
) {
  const absolute = resolve(path);
  const start = root ? resolve(root) : dirname(absolute);
  const startInfo = await lstat(start).catch(() => null);
  if (startInfo?.isSymbolicLink())
    throw failure("symlink", "durable paths must not contain symlinks");
  const suffix = relative(start, absolute).split("/").filter(Boolean);
  if (isAbsolute(relative(start, absolute)) || suffix.includes(".."))
    throw failure("path-containment", "durable path escapes its root");
  let current = resolve("/");
  const components = absolute.slice(1).split("/").filter(Boolean);
  for (const [index, part] of components.entries()) {
    current = resolve(current, part);
    const info = await lstat(current).catch(() => null);
    if (!info) {
      if (allowMissingLeaf || index === components.length - 1) break;
      continue;
    }
    if (info.isSymbolicLink()) throw failure("symlink", "durable paths must not contain symlinks");
  }
  return absolute;
}

export async function readDurableJson(path, options = {}) {
  const bytes = await readDurableBytes(path, options);
  return parseJson(bytes.toString("utf8"));
}

export async function readDurableBytes(path, options = {}) {
  const absolute = await assertNoSymlinkComponents(path, options);
  const handle = await open(absolute, O_RDONLY | O_NOFOLLOW);
  try {
    const openedPath = await realpath(`/proc/self/fd/${handle.fd}`);
    const rootPath = options.root ? await realpath(options.root) : null;
    if (
      rootPath &&
      (isAbsolute(relative(rootPath, openedPath)) ||
        relative(rootPath, openedPath).split("/").includes(".."))
    )
      throw failure("symlink", "durable path changed outside its root");
    const before = await handle.stat({ bigint: true });
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (
      `${before.dev}:${before.ino}:${before.size}:${before.mtimeNs}` !==
      `${after.dev}:${after.ino}:${after.size}:${after.mtimeNs}`
    )
      throw failure("concurrent-replacement", "durable JSON changed while being read");
    return bytes;
  } finally {
    await handle.close();
  }
}

async function flushDirectory(directory) {
  try {
    const handle = await open(directory, O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EISDIR"].includes(error.code)) throw error;
  }
}

export async function atomicWrite(
  path,
  data,
  { mode = 0o600, root = null, quarantine = true, exclusive = false } = {},
) {
  const absolute = await assertNoSymlinkComponents(path, { root, allowMissingLeaf: true });
  const directory = dirname(absolute);
  await assertNoSymlinkComponents(directory, { root, allowMissingLeaf: true });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertNoSymlinkComponents(directory, { root, allowMissingLeaf: false });
  const temporary = `${absolute}.tmp-${process.pid}-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, mode);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (exclusive) {
      await link(temporary, absolute);
      await rm(temporary, { force: true });
    } else await rename(temporary, absolute);
    await flushDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => {});
    if (quarantine) await rename(temporary, `${temporary}.quarantine`).catch(() => {});
    else await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function writeDurableJson(path, value, options = {}) {
  return atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`, options);
}

export async function appendDurableJsonLine(path, value, { mode = 0o600 } = {}) {
  await withLock(`${path}.append-lock`, async () => {
    await assertNoSymlinkComponents(path, { allowMissingLeaf: true });
    const handle = await open(path, O_WRONLY | O_APPEND | O_CREAT | O_NOFOLLOW, mode);
    try {
      await handle.writeFile(`${JSON.stringify(value)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await flushDirectory(dirname(resolve(path)));
  });
}

export async function acquireLock(path, { staleMs = 5 * 60 * 1000 } = {}) {
  await assertNoSymlinkComponents(path, { allowMissingLeaf: true });
  const token = randomUUID();
  const payload = `${JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() })}\n`;
  let handle;
  try {
    handle = await open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600);
    await handle.writeFile(payload);
    await handle.sync();
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error.code !== "EEXIST") throw error;
    const owner = await readDurableJson(path).catch(() => null);
    const age = owner?.createdAt ? Date.now() - Date.parse(owner.createdAt) : 0;
    if (!owner || age < staleMs || owner.pid === process.pid)
      throw failure("durable-locked", "durable path is locked");
    try {
      process.kill(owner.pid, 0);
      throw failure("durable-locked", "durable lock owner is alive");
    } catch (probe) {
      if (probe.code !== "ESRCH") throw probe;
    }
    await rename(path, `${path}.abandoned-${Date.now()}-${randomUUID()}`);
    return acquireLock(path, { staleMs });
  }
  await handle.close();
  return {
    token,
    async release() {
      const retired = `${path}.release-${token}`;
      try {
        await link(path, retired);
      } catch (error) {
        if (error.code === "ENOENT") return;
        throw failure("lock-ownership", "durable lock ownership changed", error);
      }
      try {
        const owner = await readDurableJson(retired);
        const current = await lstat(path).catch(() => null);
        const claimed = await lstat(retired).catch(() => null);
        if (
          owner?.token !== token ||
          !current ||
          !claimed ||
          current.dev !== claimed.dev ||
          current.ino !== claimed.ino
        )
          throw failure("lock-ownership", "durable lock ownership changed");
        await unlink(path);
      } finally {
        await rm(retired, { force: true });
        await flushDirectory(dirname(resolve(path)));
      }
    },
  };
}

export async function withLock(path, operation, options = {}) {
  const lock = await acquireLock(path, options);
  try {
    return await operation();
  } finally {
    await lock.release();
  }
}

export async function readJsonLines(
  path,
  { identity, quarantine = false, recoverPartialTail = false, onRecord, onPartialTail } = {},
) {
  const absolute = await assertNoSymlinkComponents(path);
  const handle = await open(absolute, O_RDONLY | O_NOFOLLOW);
  let text;
  try {
    const before = await handle.stat({ bigint: true });
    text = await handle.readFile("utf8");
    const after = await handle.stat({ bigint: true });
    if (
      `${before.dev}:${before.ino}:${before.size}:${before.mtimeNs}` !==
      `${after.dev}:${after.ino}:${after.size}:${after.mtimeNs}`
    )
      throw failure("concurrent-replacement", "durable JSONL changed while being read");
  } finally {
    await handle.close();
  }
  const lines = text.split(/\r?\n/);
  const hasPartialTail = lines.at(-1) !== "";
  if (hasPartialTail) {
    if (quarantine)
      await rename(path, `${path}.partial-${Date.now()}-${randomUUID()}`).catch(() => {});
    if (!recoverPartialTail)
      throw failure("partial-tail", "JSONL has an unterminated partial tail");
    onPartialTail?.(lines.at(-1));
    lines.pop();
  }
  const records = [];
  const identities = new Set();
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    let value;
    try {
      JSON.parse(line);
    } catch (cause) {
      const error = failure("invalid-jsonl", `JSONL line ${index + 1} is invalid`, cause);
      error.line = `${line}\n`;
      throw error;
    }
    value = parseJson(line);
    const key = identity?.(value);
    if (key !== undefined && key !== null) {
      if (identities.has(key))
        throw failure("duplicate-identity", `JSONL identity is duplicated: ${key}`);
      identities.add(key);
    }
    records.push(value);
    onRecord?.(value, index);
  }
  return records;
}

export async function syncDirectory(path) {
  await flushDirectory(path);
}

export async function linkDurable(source, target, { root = null } = {}) {
  await assertNoSymlinkComponents(source, { root });
  const absoluteTarget = await assertNoSymlinkComponents(target, { root, allowMissingLeaf: true });
  await link(source, absoluteTarget);
  await flushDirectory(dirname(absoluteTarget));
}

export function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
