"use strict";

// Enforcement: durable timestamps are ISO-8601 UTC ending in Z.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isUtc, utcNow } from "../scripts/lib/utc.mjs";
import { appendTrace, recordDecision } from "../scripts/lib/trace-log.mjs";
import { readPlanArtifact } from "../csm-plan/lib/plan.mjs";

test("utcNow() is UTC (ends in Z) and isUtc validates", () => {
  assert.ok(isUtc(utcNow()));
  assert.ok(isUtc("2026-09-19T20:00:00Z"));
  assert.ok(!isUtc("2026-09-19T20:00:00+01:00"));
  assert.ok(!isUtc("2026-09-19 20:00:00"));
  assert.ok(!isUtc("not-a-date"));
});

test("trace and decision entries carry UTC timestamps", async () => {
  const dir = await mkdtemp(join(tmpdir(), "utc-"));
  try {
    const file = join(dir, "trace.jsonl");
    const base = {
      runId: "run-20260919t200000z-2d54b3767507",
      actor: "t",
      action: "a",
      target: "x",
      justification: "j",
      outcome: "ok",
    };
    const t = await appendTrace(base, { file });
    const d = await recordDecision(base, { file });
    assert.ok(isUtc(t.entry.ts), `trace ts must be UTC: ${t.entry.ts}`);
    assert.ok(isUtc(d.entry.ts), `decision ts must be UTC: ${d.entry.ts}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("plan journal timestamps are UTC", async () => {
  const plan = await readPlanArtifact(".agents/plans/2026-09-19-action-traces-cleanup-csm.json");
  assert.ok(plan.journal.length > 0);
  for (const entry of plan.journal)
    assert.ok(isUtc(entry.timestamp), `journal ts not UTC: ${entry.timestamp}`);
});
