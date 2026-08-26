import { createHash } from "node:crypto";
import { O_APPEND, O_CREAT, O_NOFOLLOW, O_WRONLY } from "node:constants";
import { lstat, readFile, mkdir, realpath, open } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { digest, loadSchemaRegistry } from "../../lib/schema-runtime/index.mjs";
import { acquireLock, readDurableJson, readJsonLines } from "../../lib/durable-json/index.mjs";

const registry = await loadSchemaRegistry();

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function assertContainedRelativePath(path, root = process.cwd()) {
  if (
    typeof path !== "string" ||
    !path ||
    path.includes("\0") ||
    path.includes("\\") ||
    isAbsolute(path)
  )
    fail("unsafe-path", `path must be a relative POSIX path: ${path}`);
  const resolved = resolve(root, path);
  const fromRoot = relative(resolve(root), resolved);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${"/"}`) || isAbsolute(fromRoot))
    fail("unsafe-path", `path escapes its root: ${path}`);
  return resolved;
}

function validate(schema, value) {
  const result = registry.validate(schema, value);
  if (!result.valid)
    fail(
      "invalid-descriptor",
      `${schema} is invalid: ${result.errors.map((e) => e.message).join("; ")}`,
    );
  return value;
}

export function validateEvidenceDescriptor(value, { root, sourceRunId } = {}) {
  if (root && value && typeof value.path === "string")
    assertContainedRelativePath(value.path, root);
  validate("csm-browse-evidence/1", value);
  if (value.descriptorDigest) {
    const body = Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "descriptorDigest"),
    );
    if (value.descriptorDigest !== digest(body))
      fail("digest-mismatch", "evidence descriptor digest does not match");
  }
  if (sourceRunId && value.runId !== sourceRunId)
    fail("run-mismatch", "evidence runId does not match source run");
  if (value.kind === "screenshot" || value.kind === "video") {
    if (!value.binaryAcknowledged)
      fail("binary-acknowledgment", `${value.kind} evidence requires binary acknowledgment`);
  }
  return value;
}

export function validateSessionDescriptor(value) {
  validate("csm-browse-session/1", value);
  if (value.descriptorDigest) {
    const body = Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "descriptorDigest"),
    );
    if (value.descriptorDigest !== digest(body))
      fail("digest-mismatch", "session descriptor digest does not match");
  }
  return value;
}

export function validateEvent(value, { sourceRunId, sequence } = {}) {
  validate("csm-browse-event/1", value);
  if (sourceRunId && value.runId !== sourceRunId)
    fail("run-mismatch", "event runId does not match session run");
  if (sequence !== undefined && value.sequence !== sequence)
    fail("event-sequence", "event sequence is not contiguous");
  return value;
}

export async function digestEvidenceFile(path, { root = process.cwd(), ...fields } = {}) {
  const resolved = assertContainedRelativePath(path, root);
  const linkInfo = await lstat(resolved);
  if (linkInfo.isSymbolicLink()) fail("unsafe-artifact", `evidence is not a regular file: ${path}`);
  const target = await realpath(resolved);
  const within = relative(await realpath(root), target);
  if (isAbsolute(within) || within.split("/").includes(".."))
    fail("unsafe-path", `evidence path escapes its root: ${path}`);
  const info = await lstat(target);
  if (info.isSymbolicLink() || !info.isFile())
    fail("unsafe-artifact", `evidence is not a regular file: ${path}`);
  const bytes = await readFile(target);
  const fileDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const descriptor = {
    schema: "csm-browse-evidence/1",
    ...fields,
    path,
    digest: fileDigest,
    bytes: bytes.byteLength,
  };
  descriptor.descriptorDigest = digest(descriptor);
  validateEvidenceDescriptor(descriptor, { root });
  return descriptor;
}

export async function appendEvent(path, event, { root = process.cwd(), sourceRunId } = {}) {
  const resolved = assertContainedRelativePath(path, root);
  await mkdir(resolve(root, path, ".."), { recursive: true });
  let current = resolve(root);
  for (const part of path.split("/")) {
    current = resolve(current, part);
    if ((await lstat(current).catch(() => null))?.isSymbolicLink())
      fail("unsafe-path", "event path has a symlinked ancestor");
  }
  const parent = relative(await realpath(root), await realpath(dirname(resolved)));
  if (isAbsolute(parent) || parent.split("/").includes(".."))
    fail("unsafe-path", "event path escapes root");
  const existing = await lstat(resolved).catch(() => null);
  if (existing?.isSymbolicLink()) fail("unsafe-path", "event path is symlinked");
  const lockPath = `${resolved}.lock`;
  const lock = await acquireLock(lockPath, { staleMs: 5 * 60 * 1000 });
  try {
    const prior = await readJsonLines(resolved, { identity: (value) => value?.eventId }).catch(
      (error) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    const sequence = prior.length;
    const next = { ...event, sequence };
    validateEvent(next, { sourceRunId, sequence });
    const output = await open(resolved, O_APPEND | O_CREAT | O_WRONLY | O_NOFOLLOW, 0o600);
    try {
      await output.writeFile(`${JSON.stringify(next)}\n`);
      await output.sync();
    } finally {
      await output.close();
    }
    return next;
  } finally {
    await lock.release();
  }
}

export async function recoverEvents(path, { root = process.cwd(), sourceRunId } = {}) {
  const resolved = assertContainedRelativePath(path, root);
  let current = resolve(root);
  for (const part of path.split("/")) {
    current = resolve(current, part);
    if ((await lstat(current).catch(() => null))?.isSymbolicLink())
      fail("unsafe-path", "event path has a symlinked ancestor");
  }
  const existing = await lstat(resolved).catch(() => null);
  if (existing?.isSymbolicLink()) fail("unsafe-path", "event path is symlinked");
  try {
    const events = await readJsonLines(resolved, { identity: (value) => value?.eventId });
    events.forEach((event, sequence) => {
      validateEvent(event, { sourceRunId, sequence });
    });
    return { status: "recoverable", events };
  } catch (error) {
    if (error.code === "ENOENT") return { status: "new", events: [] };
    fail("events-corrupt", `browse events cannot be recovered: ${error.message}`);
  }
}

export async function readEvidenceDescriptor(path, options = {}) {
  if (!path.endsWith(".json")) fail("json-only", "browse machine inputs must be JSON descriptors");
  let value;
  try {
    value = await readDurableJson(path);
  } catch (error) {
    fail("json-only", `browse descriptor is not valid JSON: ${error.message}`);
  }
  return validateEvidenceDescriptor(value, options);
}

export { digest };
