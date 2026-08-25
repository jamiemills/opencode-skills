import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { freshSessionsRoot, removeRoot } from "./helpers/env.mjs";
import { startFakeCdp } from "./helpers/fake-cdp-server.mjs";

const root = await freshSessionsRoot("csm-browse-status-");
const status = await import("../../lib/verbs/status.mjs");
const input = await import("../../lib/verbs/input.mjs");

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
  assert.equal(report.currentUrl, "http://page/");
  assert.doesNotMatch(JSON.stringify(report), /page\/one/);
  assert.equal(report.daemonAlive, false);
  assert.deepEqual(report.ports, { internal: 9224, public: 9225 });
  assert.equal(report.artifactCount, 3);

  await rm(join(sDir, "artifacts"), { recursive: true, force: true });
  const report2 = await runStatus(state);
  assert.equal(report2.artifactCount, 0);
  await server.stop();
});

test("status closes the CDP client when a browser request fails", async () => {
  const server = await startFakeCdp({
    responses: {
      "Browser.getVersion": () => {
        throw new Error("synthetic failure");
      },
    },
  });
  const state = {
    wsUrl: server.url,
    sid: "st-error",
    sessionDir: join(root, "st-error"),
    internalPort: 9228,
    publicPort: 9229,
  };
  await assert.rejects(() => status.run({ args: [], state, verb: "status" }), /synthetic failure/);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(server.connections[0].readyState, server.connections[0].CLOSED);
  await server.stop();
});

test("input closes the CDP client when attaching to a page fails", async () => {
  const server = await startFakeCdp({
    responses: {
      "Target.getTargets": () => ({ targetInfos: [{ type: "page", targetId: "page-1" }] }),
      "Target.attachToTarget": () => {
        throw new Error("attach failed");
      },
    },
  });
  const state = {
    wsUrl: server.url,
    sid: "st-input-error",
    sessionDir: join(root, "st-input-error"),
    internalPort: 9230,
    publicPort: 9231,
  };
  await assert.rejects(
    () => input.run({ args: ["#submit"], state, verb: "click" }),
    /attach failed/,
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(server.connections[0].readyState, server.connections[0].CLOSED);
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
  const daemon = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)", "session-daemon.mjs", "--session", sid],
    {
      stdio: "ignore",
    },
  );

  // pid file alone (no ready marker) is not enough
  await writeFile(join(sDir, "daemon.pid"), String(daemon.pid));
  assert.equal((await runStatus(state)).daemonAlive, false);

  // ready marker + live pid -> alive
  await writeFile(join(sDir, "daemon.ready"), String(daemon.pid));
  assert.equal((await runStatus(state)).daemonAlive, true);
  assert.equal((await runStatus(state)).currentUrl, null); // no page targets

  await server.stop();
  daemon.kill("SIGKILL");
});
