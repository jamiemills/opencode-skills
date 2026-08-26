import assert from "node:assert/strict";
import { mkdtemp, readFile, symlink, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  appendDurableJsonLine,
  acquireLock,
  atomicWrite,
  readDurableJson,
  readJsonLines,
  writeDurableJson,
} from "../lib/durable-json/index.mjs";

async function root() {
  return mkdtemp(join(tmpdir(), "csm-durable-json-"));
}

test("durable JSON rejects duplicate keys and symlink components", async () => {
  const directory = await root();
  const path = join(directory, "value.json");
  await writeFile(path, '{"value":1,"value":2}\n');
  await assert.rejects(() => readDurableJson(path), SyntaxError);
  await symlink(directory, join(directory, "link"));
  await assert.rejects(() => readDurableJson(join(directory, "link", "value.json")), {
    code: "symlink",
  });
});

test("durable paths reject symlinked ancestors before missing parents are created", async () => {
  const directory = await root();
  const target = await root();
  await symlink(target, join(directory, "ancestor"));
  await assert.rejects(
    () => writeDurableJson(join(directory, "ancestor", "missing", "value.json"), { ok: true }),
    { code: "symlink" },
  );
});

test("atomic replacement preserves the complete prior artifact after a failed exclusive write", async () => {
  const directory = await root();
  const path = join(directory, "state.json");
  await writeDurableJson(path, { version: 1 });
  await assert.rejects(
    () => atomicWrite(path, '{"version":2}\n', { exclusive: true, root: directory }),
    { code: "EEXIST" },
  );
  assert.deepEqual(await readDurableJson(path, { root: directory }), { version: 1 });
  assert.match(await readFile(path, "utf8"), /version/);
});

test("locks serialize hostile same-user writers and release only their owner", async () => {
  const directory = await root();
  const path = join(directory, "state.lock");
  const first = await acquireLock(path);
  await assert.rejects(() => acquireLock(path), { code: "durable-locked" });
  await first.release();
  const second = await acquireLock(path);
  await second.release();
});

test("lock release cannot remove a replacement owner", async () => {
  const directory = await root();
  const path = join(directory, "state.lock");
  const first = await acquireLock(path);
  await rename(path, `${path}.old`);
  await writeFile(
    path,
    `${JSON.stringify({ token: "replacement", createdAt: new Date().toISOString() })}\n`,
  );
  await assert.rejects(() => first.release(), { code: "lock-ownership" });
  assert.match(await readFile(path, "utf8"), /replacement/);
});

test("stale locks with dead owners are archived and replaced", async () => {
  const directory = await root();
  const path = join(directory, "state.lock");
  await writeFile(
    path,
    `${JSON.stringify({ pid: 2147483647, token: "stale", createdAt: "2000-01-01T00:00:00.000Z" })}\n`,
  );
  const owner = await acquireLock(path, { staleMs: 1 });
  assert.notEqual(owner.token, "stale");
  await owner.release();
});

test("JSONL recovery detects partial tails and duplicate identities", async () => {
  const directory = await root();
  const partial = join(directory, "partial.jsonl");
  await writeFile(partial, '{"id":"one"}\n{"id":"two"');
  await assert.rejects(() => readJsonLines(partial, { identity: (value) => value.id }), {
    code: "partial-tail",
  });
  const duplicate = join(directory, "duplicate.jsonl");
  await writeFile(duplicate, '{"id":"one"}\n{"id":"one"}\n');
  await assert.rejects(() => readJsonLines(duplicate, { identity: (value) => value.id }), {
    code: "duplicate-identity",
  });
});

test("shared durable JSONL append produces a recovered complete record", async () => {
  const directory = await root();
  const path = join(directory, "events.jsonl");
  await appendDurableJsonLine(path, { id: "one", value: 1 });
  await appendDurableJsonLine(path, { id: "two", value: 2 });
  assert.deepEqual(await readJsonLines(path, { identity: (value) => value.id }), [
    { id: "one", value: 1 },
    { id: "two", value: 2 },
  ]);
});
