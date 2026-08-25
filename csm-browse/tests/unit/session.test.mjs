import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readdir, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { freshSessionsRoot, removeRoot } from "./helpers/env.mjs";

const root = await freshSessionsRoot("csm-browse-session-");
const { validateSid, sessionDir, loadState, saveState, removeState, rotateToken } =
  await import("../../lib/session.mjs");

after(async () => {
  await removeRoot(root);
});

test("SID regex accepts valid session ids", () => {
  for (const sid of [
    "a",
    "abc",
    "a1",
    "session-x_y-2",
    "z".repeat(41),
    "0-start-digit",
    "has--double_underscore",
  ]) {
    assert.doesNotThrow(() => validateSid(sid), `expected accept: ${sid}`);
  }
});

test("SID regex rejects invalid session ids", () => {
  const bad = [
    "",
    "-lead",
    "_lead",
    ".lead",
    "Upper",
    "a b",
    "a.b",
    "a:b",
    "a/b",
    "z".repeat(42),
    null,
    undefined,
    42,
    {},
  ];
  for (const sid of bad) {
    assert.throws(() => validateSid(sid), `expected reject: ${String(sid)}`);
  }
});

test("sessionDir lives under the env-overridden root", () => {
  assert.equal(sessionDir("abc"), join(root, "abc"));
});

test("saveState is atomic (tmp+rename) and round-trips via loadState", async () => {
  const state = {
    sid: "rt-1",
    wsUrl: "ws://127.0.0.1:9224/x",
    internalPort: 9224,
    publicPort: 9225,
    nested: { a: [1, 2, 3] },
  };
  await saveState("rt-1", state);
  const dir = join(root, "rt-1");
  assert.ok(existsSync(join(dir, "state.json")), "state.json missing");
  const entries = await readdir(dir);
  assert.ok(!entries.some((e) => e.includes(".tmp")), `leftover tmp file: ${entries}`);
  assert.deepEqual(await loadState("rt-1"), state);
});

test("saveState concurrent writers use distinct temporary claims", async () => {
  const states = [1, 2, 3, 4].map((version) => ({
    sid: "atomic-race",
    wsUrl: "ws://127.0.0.1:9224/x",
    internalPort: 9224,
    publicPort: 9225,
    version,
  }));
  await Promise.all(states.map((state) => saveState("atomic-race", state)));
  const loaded = await loadState("atomic-race");
  assert.ok(states.some((state) => state.version === loaded.version));
  const entries = await readdir(join(root, "atomic-race"));
  assert.ok(!entries.some((entry) => entry.startsWith("state.json.tmp-")), entries);
});

test("token lifecycle round-trips through state.json at 0600", async () => {
  const state = {
    sid: "tok-rt",
    token: "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2",
    tokenGeneration: 1,
    internalPort: 9224,
    publicPort: 9225,
    wsUrl:
      "ws://127.0.0.1:9225/devtools/browser/x?token=A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2",
    cdpUrl: "http://127.0.0.1:9225?token=A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2",
  };
  await saveState("tok-rt", state);
  const loaded = await loadState("tok-rt");
  assert.deepEqual(loaded, state);
  const info = await stat(join(root, "tok-rt", "state.json"));
  assert.equal(info.mode & 0o777, 0o600);
  // A rotated token must still validate + round-trip.
  rotateToken(state);
  await saveState("tok-rt", state);
  const rotated = await loadState("tok-rt");
  assert.equal(rotated.tokenGeneration, 2);
  assert.equal(new URL(rotated.wsUrl).searchParams.get("token"), rotated.token);
  assert.equal(new URL(rotated.cdpUrl).searchParams.get("token"), rotated.token);
});

test("loadState returns null when state.json is absent", async () => {
  assert.equal(await loadState("never-created"), null);
});

test("saveState fails closed: a token without a matching embedded token is rejected", async () => {
  const token = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2";
  await assert.rejects(
    saveState("tok-bad-1", {
      sid: "tok-bad-1",
      token,
      wsUrl: "ws://127.0.0.1:9225/devtools/browser/x",
    }),
    /token mismatch/,
  );
  await assert.rejects(
    saveState("tok-bad-2", { sid: "tok-bad-2", token, cdpUrl: "http://127.0.0.1:9225" }),
    /token mismatch/,
  );
});

test("loadState rejects on malformed JSON", async () => {
  await mkdir(join(root, "bad-1"), { recursive: true });
  await writeFile(join(root, "bad-1", "state.json"), "{not json", "utf-8");
  await assert.rejects(loadState("bad-1"), SyntaxError);
});

test("removeState deletes the whole session dir", async () => {
  await saveState("rm-1", { a: 1 });
  await removeState("rm-1");
  assert.ok(!existsSync(join(root, "rm-1")));
});
