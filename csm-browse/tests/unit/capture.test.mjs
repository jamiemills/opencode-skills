import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile, chmod, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { freshSessionsRoot, removeRoot } from "./helpers/env.mjs";
import { startFakeCdp } from "./helpers/fake-cdp-server.mjs";

// F-040: the capture verb exercised through a fake CDP endpoint + tiny
// fixtures, run in a subprocess so its process.exit() error paths are safe.
// The full-page stitch path stands in for ffmpeg with a stub executable.
const root = await freshSessionsRoot("csm-browse-capture-");

const CAPTURE_URL = fileURLToPath(new URL("../../lib/verbs/capture.mjs", import.meta.url));

const fakeBinDir = mkdtempSync(join(tmpdir(), "csm-browse-capture-fakebin-"));
const fakeFfmpeg = [
  "#!/usr/bin/env node",
  "const fs = require('node:fs');",
  "const args = process.argv.slice(2);",
  "const out = args[args.length - 1];",
  "try { fs.writeFileSync(out, 'FAKE-FRAME-DATA'); } catch {}",
  "process.stdin.resume();",
  "process.stdin.on('data', () => {});",
  "process.stdin.on('end', () => process.exit(0));",
  "setTimeout(() => process.exit(0), 10000).unref();",
  "",
].join("\n");
await writeFile(join(fakeBinDir, "ffmpeg"), fakeFfmpeg, { encoding: "utf-8" });
await chmod(join(fakeBinDir, "ffmpeg"), 0o755);
process.env.PATH = `${fakeBinDir}${process.env.PATH ? ":" : ""}${process.env.PATH}`;

after(async () => {
  await removeRoot(root);
  await rm(fakeBinDir, { recursive: true, force: true });
});

// A real 1x1 PNG so the verb's width/height reader (offsets 16/20) works.
const PNG1x1 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde,
]);

function screenshotData() {
  return PNG1x1.toString("base64");
}

function spawnCapture({ args, state }) {
  const script = `
    const { run } = await import(${JSON.stringify(CAPTURE_URL)});
    await run({ args: ${JSON.stringify(args)}, state: ${JSON.stringify(state)} });
  `;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function parseOutput(stdout) {
  const lines = stdout.trim().split("\n").filter(Boolean);
  try {
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
}

async function makeState(sid) {
  const sessionDir = join(root, sid);
  await mkdir(sessionDir, { recursive: true });
  return { wsUrl: null, sessionDir };
}

test("capture --viewport writes a JPEG file and reports format/bytes", async () => {
  const fake = await startFakeCdp({
    responses: {
      "Target.getTargets": () => ({
        targetInfos: [{ type: "page", targetId: "p1", url: "http://x/" }],
      }),
      "Target.attachToTarget": () => ({ sessionId: "s1" }),
      "Page.captureScreenshot": () => ({ data: screenshotData() }),
    },
  });
  try {
    const state = await makeState("cap-vp");
    state.wsUrl = fake.url;
    const r = await spawnCapture({ args: ["--viewport", "shot.jpg"], state });
    assert.equal(r.code, 0, r.stderr);
    const out = parseOutput(r.stdout);
    assert.ok(out, `no JSON output: ${r.stdout}`);
    assert.equal(out.format, "jpg");
    assert.equal(out.preset, "medium");
    assert.ok(out.bytes > 0);
    assert.ok(out.path.endsWith("shot.jpg"), out.path);
    assert.ok(existsSync(out.path), `output file missing: ${out.path}`);
  } finally {
    await fake.stop();
  }
});

test("capture --viewport --full writes a PNG and reads its dimensions", async () => {
  const fake = await startFakeCdp({
    responses: {
      "Target.getTargets": () => ({
        targetInfos: [{ type: "page", targetId: "p1", url: "http://x/" }],
      }),
      "Target.attachToTarget": () => ({ sessionId: "s1" }),
      "Page.captureScreenshot": () => ({ data: screenshotData() }),
    },
  });
  try {
    const state = await makeState("cap-png");
    state.wsUrl = fake.url;
    const r = await spawnCapture({ args: ["--viewport", "--full", "shot.png"], state });
    assert.equal(r.code, 0, r.stderr);
    const out = parseOutput(r.stdout);
    assert.ok(out, `no JSON output: ${r.stdout}`);
    assert.equal(out.format, "png");
    assert.equal(out.width, 1);
    assert.equal(out.height, 1);
    assert.ok(out.path.endsWith("shot.png"), out.path);
    assert.ok(existsSync(out.path));
  } finally {
    await fake.stop();
  }
});

test("capture --full stitches a multi-tile full page with the stub ffmpeg and cleans temps", async () => {
  const fake = await startFakeCdp({
    responses: {
      "Target.getTargets": () => ({
        targetInfos: [{ type: "page", targetId: "p1", url: "http://x/" }],
      }),
      "Target.attachToTarget": () => ({ sessionId: "s1" }),
      "Runtime.evaluate": (params) => {
        const expr = params.expression || "";
        if (expr.includes("document.querySelectorAll")) return { result: { value: 0 } };
        if (expr.includes("document.body.scrollHeight")) {
          return { result: { value: JSON.stringify({ h: 100, wh: 50 }) } };
        }
        if (expr.includes("window.scrollTo")) return {};
        return { result: { value: null } };
      },
      "Page.captureScreenshot": () => ({ data: screenshotData() }),
    },
  });
  try {
    const state = await makeState("cap-stitch");
    state.wsUrl = fake.url;
    const r = await spawnCapture({ args: ["--full", "stitch.png"], state });
    assert.equal(r.code, 0, r.stderr);
    const out = parseOutput(r.stdout);
    assert.ok(out, `no JSON output: ${r.stdout}`);
    assert.equal(out.stitched, true);
    assert.equal(out.tiles, 2);
    assert.equal(out.format, "png");
    assert.ok(out.path.endsWith("stitch.png"), out.path);
    assert.ok(existsSync(out.path), `stitched output missing: ${out.path}`);

    const artifacts = await readdir(join(state.sessionDir, "artifacts"));
    const leftovers = artifacts.filter((f) => f.startsWith(".stitch-"));
    assert.deepEqual(leftovers, [], `stitch temps not cleaned: ${leftovers.join(",")}`);
  } finally {
    await fake.stop();
  }
});

test("capture rejects an output name that escapes the artifacts dir", async () => {
  const fake = await startFakeCdp({ responses: {} });
  try {
    const state = await makeState("cap-bad");
    state.wsUrl = fake.url;
    const r = await spawnCapture({ args: ["--viewport", "../escape.png"], state });
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}`);
    assert.match(r.stderr, /Invalid output name/);
  } finally {
    await fake.stop();
  }
});
