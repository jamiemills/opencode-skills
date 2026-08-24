"use strict";

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PopulationArchive,
  isStagnant,
  lineage,
  migrate,
  promote,
  rollback,
} from "../lib/population/index.mjs";
import history from "./fixtures/population-history.json" with { type: "json" };

test("archive is bounded, deterministic, gated, diverse, and recoverable from lineage", () => {
  const options = { maxArchive: 3, objectives: [{ name: "score", direction: "maximize" }] };
  const first = new PopulationArchive({ ...options, lineage: history });
  const second = new PopulationArchive({ ...options, lineage: history });
  assert.deepEqual(first.snapshot(), second.snapshot());
  assert.equal(first.snapshot().length, 3);
  assert.deepEqual(
    first.snapshot().map((item) => item.behaviorCategory),
    ["boundary", "robust", "speed"],
  );
  assert.equal(
    first.snapshot().some((item) => item.id === "unsafe"),
    false,
  );
  assert.deepEqual(
    lineage(history).find((item) => item.id === "speed-2"),
    {
      id: "speed-2",
      parentId: "speed-1",
      contentHash: history[4].contentHash,
      decision: "archive",
    },
  );
});

test("population activates only after measured stagnant trials and migrates deterministically", () => {
  assert.deepEqual(
    isStagnant(history.slice(0, 3), 2, { objective: { name: "score", direction: "maximize" } }),
    { stagnantTrials: 2, activated: true },
  );
  const archive = new PopulationArchive({
    maxArchive: 3,
    metric: { name: "score", direction: "maximize" },
    lineage: history,
  });
  const islands = migrate(
    archive,
    [
      { id: "a", candidates: [] },
      { id: "b", candidates: [] },
    ],
    { interval: 2, round: 2 },
  );
  assert.deepEqual(
    islands.map((island) => island.candidates[0].id),
    ["boundary-1", "robust-1"],
  );
});

test("promotion requires human approval, refuses protected paths, recovers atomically, and rolls back exact identity", async () => {
  const candidate = history[0];
  let state = "old";
  await assert.rejects(
    () =>
      promote({
        candidate: { ...candidate, changedPaths: ["policy/config.json"] },
        approval: { approved: true, candidateId: candidate.id },
        protectedPaths: ["policy"],
      }),
    /protected paths/,
  );
  await assert.rejects(
    () =>
      promote({
        candidate,
        approval: { approved: true, candidateId: candidate.id },
        read: () => state,
        apply: (value) => {
          state = value === candidate ? "new" : value;
          throw new Error("synthetic failure");
        },
      }),
    /synthetic failure/,
  );
  assert.equal(state, "old");
  const promotion = await promote({
    candidate,
    approval: { approved: true, candidateId: candidate.id },
    read: () => state,
    apply: () => {
      state = "new";
    },
  });
  assert.equal(state, "new");
  await assert.rejects(
    () =>
      rollback({
        promotion,
        candidate: { ...candidate, contentHash: "wrong" },
        restore: (value) => {
          state = value;
        },
      }),
    /identity mismatch/,
  );
  const result = await rollback({
    promotion,
    candidate,
    restore: (value) => {
      state = value;
    },
  });
  assert.equal(result.contentHash, promotion.contentHash);
  assert.equal(state, "old");
});

test("archive persists and promotion records verified before and after state hashes", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-population-"));
  const path = join(root, "archive.json");
  const archive = new PopulationArchive({
    maxArchive: 2,
    metric: { name: "score", direction: "maximize" },
    lineage: history,
  });
  await archive.save(path);
  assert.deepEqual(
    (
      await PopulationArchive.load(path, {
        maxArchive: 2,
        metric: { name: "score", direction: "maximize" },
      })
    ).snapshot(),
    archive.snapshot(),
  );
  let state = { version: 1 };
  const candidate = { ...history[0], id: "promoted" };
  const promotion = await promote({
    candidate,
    approval: { approved: true, candidateId: candidate.id },
    read: () => state,
    apply: () => {
      state = { version: 2 };
    },
  });
  assert.notEqual(promotion.beforeHash, promotion.afterHash);
  await rollback({
    promotion,
    candidate,
    read: () => state,
    restore: (previous, context) => {
      assert.equal(context.type, "population-state");
      state = previous;
    },
  });
  assert.deepEqual(state, { version: 1 });
});

test("archive persists canonical content, lineage, and provenance hashes and rejects tampering", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-population-"));
  const path = join(root, "archive.json");
  const archive = new PopulationArchive({
    maxArchive: 2,
    metric: { name: "score", direction: "maximize" },
    provenance: { evaluator: "fixture", runId: "run" },
    lineage: history,
  });
  await archive.save(path);
  const saved = JSON.parse(await readFile(path, "utf8"));
  assert.match(saved.contentHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(saved.lineageHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(saved.provenanceHash, /^sha256:[a-f0-9]{64}$/);
  saved.records[0].id = "tampered";
  await writeFile(path, `${JSON.stringify(saved)}\n`);
  await assert.rejects(
    () =>
      PopulationArchive.load(path, {
        maxArchive: 2,
        metric: { name: "score", direction: "maximize" },
      }),
    /integrity failure/,
  );
  saved.records[0].id = archive.snapshot()[0].id;
  saved.provenance.runId = "other";
  await writeFile(path, `${JSON.stringify(saved)}\n`);
  await assert.rejects(
    () =>
      PopulationArchive.load(path, {
        maxArchive: 2,
        metric: { name: "score", direction: "maximize" },
      }),
    /integrity failure/,
  );
});
