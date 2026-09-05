import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { digest } from "../lib/schema-runtime/index.mjs";
import { loadState } from "../csm-browse/lib/session.mjs";

const execFileAsync = promisify(execFile);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BROWSE_ROOT = join(ROOT, "csm-browse");
const ENSURE = join(BROWSE_ROOT, "scripts", "ensure-browser.mjs");
const BROWSE = join(BROWSE_ROOT, "scripts", "browse.mjs");
const SERVE = join(BROWSE_ROOT, "tests", "serve.mjs");

async function runNode(script, args, options = {}) {
  return execFileAsync(process.execPath, [script, ...args], {
    cwd: ROOT,
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  });
}

function lastJson(stdout) {
  try {
    return JSON.parse(stdout.trim());
  } catch {}
  for (const line of stdout.trim().split("\n").toReversed()) {
    try {
      return JSON.parse(line);
    } catch {}
  }
  throw new Error(`command did not produce JSON state: ${stdout}`);
}

export async function startFixture() {
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, [SERVE], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const ready = new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("fixture server did not become ready")), 10000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/fixture server on (http:\/\/[^\s]+).*?READY\s+(\d+)/s);
      if (match) {
        clearTimeout(timer);
        resolve(`${match[1]}/page1.html`);
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== null) reject(new Error(`fixture server exited with code ${code}`));
    });
  });
  return {
    baseUrl: await ready,
    async close() {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    },
  };
}

export async function ensureSession(sid) {
  const { stdout } = await runNode(ENSURE, ["--session", sid], { timeout: 120000 });
  lastJson(stdout);
  return loadState(sid);
}

export async function browse(sid, ...args) {
  const { stdout } = await runNode(BROWSE, [...args, "--session", sid], { timeout: 120000 });
  return lastJson(stdout);
}

export async function closeSession(sid) {
  await browse(sid, "close");
}

export async function persistJsonEvidence({ root, path, native }) {
  const record = {
    schema: "csm-artifact/1",
    artifact: {
      artifactId: `art-${native.runId.slice(4)}-${native.evidenceId.slice(9)}`.slice(0, 140),
      kind: "evidence",
      owner: "csm-browse",
      runId: native.runId,
      digest: digest({
        artifactId: `art-${native.runId.slice(4)}-${native.evidenceId.slice(9)}`.slice(0, 140),
        kind: "evidence",
        owner: "csm-browse",
        runId: native.runId,
        createdAt: native.capturedAt,
        revision: 1,
      }),
      createdAt: native.capturedAt,
      revision: 1,
    },
    contentType: "application/json",
    location: path,
    lifecycleStatus: "active",
    sourceRunId: native.runId,
    sourceDigest: native.digest,
  };
  record.payloadDigest = digest(record);
  record.descriptorDigest = digest(record);
  const fileDigest = `sha256:${createHash("sha256")
    .update(JSON.stringify(record) + "\n")
    .digest("hex")}`;
  await writeFile(join(root, path), JSON.stringify(record) + "\n", { mode: 0o600 });
  const returned = { ...native, path, digest: fileDigest, sourceDigest: native.digest };
  const descriptor = { ...returned };
  delete descriptor.descriptorDigest;
  return { ...returned, descriptorDigest: digest(descriptor) };
}

export async function captureNative({ sid, runId, fixtureUrl, state }) {
  await browse(sid, "open", "--url", fixtureUrl);
  const output = await browse(sid, "screenshot", "--full", "--viewport", "proof.png");
  const path = output.path;
  let bytes;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      bytes = await readFile(path);
      break;
    } catch (error) {
      if (error.code !== "ENOENT" || attempt === 9) throw error;
      await browse(sid, "screenshot", "--full", "--viewport", "proof.png");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const relativePath = path.slice(`${state.sessionDir}/`.length);
  const fileDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const native = {
    schema: "csm-browse-evidence/1",
    evidenceId: `evidence-live-${sid}`,
    runId,
    owner: "csm-browse",
    kind: "screenshot",
    path: `${sid}/${relativePath}`,
    digest: fileDigest,
    bytes: (await stat(path)).size,
    contentType: "image/png",
    capturedAt: new Date().toISOString(),
    metadata: { fixture: "csm-browse/tests/fixtures/page1.html" },
    binaryAcknowledged: true,
  };
  return {
    ...native,
    descriptorDigest: digest(native),
  };
}

export async function readNativeLog({ sid, runId, fixtureUrl, state }) {
  await browse(sid, "open", "--url", fixtureUrl);
  const events = await browse(sid, "console");
  const path = `${state.sessionDir}/events.jsonl`;
  const bytes = await readFile(path);
  const native = {
    schema: "csm-browse-evidence/1",
    evidenceId: `evidence-live-log-${sid}`,
    runId,
    owner: "csm-browse",
    kind: "console",
    path: `${sid}/events.jsonl`,
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    bytes: bytes.byteLength,
    contentType: "application/json",
    capturedAt: new Date().toISOString(),
    metadata: {
      events,
      controlledNativeLog: `browser connected with token=${state.token}`,
    },
    binaryAcknowledged: true,
  };
  return { ...native, descriptorDigest: digest(native) };
}
