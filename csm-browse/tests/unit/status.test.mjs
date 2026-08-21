import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { freshSessionsRoot, removeRoot } from "./helpers/env.mjs";
import { startFakeCdp } from "./helpers/fake-cdp-server.mjs";

const root = await freshSessionsRoot("csm-browse-status-");
const status = await import("../../lib/verbs/status.mjs");

after(async () => {
  await removeRoot(root);
});

async function runStatus(state) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => {
    lines.push(a.join(" "));
  };
  try {
    await status.run({ args: [], state, verb: "status" });
  } finally {
    console.log = orig;
  }
  return JSON.parse(lines[0]);
}

test("status reports browser info, ports and artifactCount from the tmp session dir", async () => {
  const server = await startFakeCdp({
    responses: {
      "Browser.getVersion": () => ({ product: "Chrome/99.0.0", userAgent: "UA-test" }),
      "Target.getTargets": () => ({ targetInfos: [{ type: "page", url: "http://page/one" }] }),
    },
  });
  const sid = "st-a";
  const sDir = join(root, sid);
  await mkdir(join(sDir, "artifacts"), { recursive: true });
  for (const name of ["a.png", "b.webm", "c.mp4"])
    await writeFile(join(sDir, "artifacts", name), "x");
  const state = { wsUrl: server.url, sid, sessionDir: sDir, internalPort: 9224, publicPort: 9225 };

  const report = await runStatus(state);
  assert.equal(report.version, "Chrome/99.0.0");
  assert.equal(report.userAgent, "UA-test");
  assert.equal(report.currentUrl, "http://page/one");
  assert.equal(report.daemonAlive, false);
  assert.deepEqual(report.ports, { internal: 9224, public: 9225 });
  assert.equal(report.artifactCount, 3);

  await rm(join(sDir, "artifacts"), { recursive: true, force: true });
  const report2 = await runStatus(state);
  assert.equal(report2.artifactCount, 0);
  await server.stop();
});

test("status reports daemonAlive=true only when ready marker + live pid agree", async () => {
  const server = await startFakeCdp({
    responses: {
      "Browser.getVersion": () => ({ product: "p", userAgent: "u" }),
      "Target.getTargets": () => ({ targetInfos: [] }),
    },
  });
  const sid = "st-b";
  const sDir = join(root, sid);
  await mkdir(sDir, { recursive: true });
  const state = { wsUrl: server.url, sid, sessionDir: sDir, internalPort: 9226, publicPort: 9227 };

  // pid file alone (no ready marker) is not enough
  await writeFile(join(sDir, "daemon.pid"), String(process.pid));
  assert.equal((await runStatus(state)).daemonAlive, false);

  // ready marker + live pid -> alive
  await writeFile(join(sDir, "daemon.ready"), String(process.pid));
  assert.equal((await runStatus(state)).daemonAlive, true);
  assert.equal((await runStatus(state)).currentUrl, null); // no page targets

  await server.stop();
});
