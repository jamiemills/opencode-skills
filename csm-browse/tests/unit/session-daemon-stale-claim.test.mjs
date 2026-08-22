import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { freshSessionsRoot, removeRoot } from "./helpers/env.mjs";

const root = await freshSessionsRoot("csm-browse-stale-claim-");
const SKILL = fileURLToPath(new URL("../..", import.meta.url));

function spawnDaemon(sid, env) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [join(SKILL, "scripts", "session-daemon.mjs"), "--session", sid],
      {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (out += c));
    child.on("close", (code) => resolve({ code, out }));
  });
}

test("daemon breaks a dead holder's stale pidfile and claims its own pid", async () => {
  const sid = "staleclaim1";
  const sDir = join(root, sid);
  await mkdir(sDir, { recursive: true });
  const pidFile = join(sDir, "daemon.pid");
  const DEAD_PID = "999999";
  await writeFile(pidFile, DEAD_PID);

  const { code } = await spawnDaemon(sid, {
    ...process.env,
    CSM_BROWSE_SESSIONS_ROOT: root,
  });

  // The daemon claims first, then exits when no session state exists.
  assert.notEqual(code, 2, `must not report 'already running': ${code}`);
  let content = null;
  try {
    content = await readFile(pidFile, "utf-8");
  } catch {}
  if (content !== null) {
    // The stale claim must have been broken and replaced by our own pid —
    // the old dead pid must never survive as the active claim.
    assert.notEqual(content.trim(), DEAD_PID);
    assert.ok(Number.isInteger(Number(content.trim())), `pid content sane: ${content}`);
  }
  await rm(sDir, { recursive: true, force: true });
  await removeRoot(root);
});
