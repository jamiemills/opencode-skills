import test from "node:test";
import assert from "node:assert/strict";

const { memAvailableMb } = await import("../../scripts/ensure-browser.mjs");

const FREE_M_OUTPUT = `               total        used        free      shared  buff/cache   available
Mem:           32000       15884        4212        1024        7042       16284
Swap:           2047           0        2047`;

test("memAvailableMb parses the available column of `free -m` output", async () => {
  const calls = [];
  const execFile = async (cmd, args) => {
    calls.push([cmd, args]);
    return { stdout: FREE_M_OUTPUT };
  };
  const mb = await memAvailableMb(execFile);
  assert.equal(mb, 16284);
  assert.deepEqual(calls, [["free", ["-m"]]]);
});

test("memAvailableMb returns -1 on non-numeric output", async () => {
  const mb = await memAvailableMb(async () => ({ stdout: "not free output" }));
  assert.equal(mb, -1);
});

test("memAvailableMb returns -1 when the executor rejects", async () => {
  const mb = await memAvailableMb(async () => {
    throw new Error("spawn failed");
  });
  assert.equal(mb, -1);
});
