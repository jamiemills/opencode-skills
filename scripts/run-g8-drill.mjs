// G8 promotion-gate drill: exercises every canary stop rule against the REAL
// rollout controllers and completes a verified rollback + a promotion path.
// Produces the evidence bundle for promotion gate G8.
//
// Usage: node scripts/run-g8-drill.mjs [--out <path>]
// Default output: .agents/evidence/t007-g8-drill.json
"use strict";

import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createRolloutStack, healthyMetrics } from "../tests/rollout/helpers.mjs";

const ABSOLUTE_RULES = [
  "falseVerified",
  "unauthorizedEffects",
  "duplicateNonIdempotentEffects",
  "provenanceMismatches",
  "telemetryBlindSpots",
];

function freshStack(label) {
  let tick = 0;
  return {
    label,
    ...createRolloutStack({
      now: () => new Date(2026, 8, 5, 12, 0, tick++).toISOString(),
      canaryClock: () => (tick += 61_000),
    }),
    record: { label, rounds: [] },
  };
}

function seedGood(stack) {
  const good = stack.versionRegistry.register({ mode: "baseline" }, { seed: true });
  stack.versionRegistry.activate(good.versionId);
  stack.versionRegistry.markKnownGood(good.versionId, { seeded: true });
  return good;
}

function candidateRound(stack, triggerMetrics) {
  seedGood(stack);
  const candidate = stack.versionRegistry.register({ mode: "candidate" });
  stack.canary.start({ mode: "candidate" }, { configVersion: candidate.versionId });
  const evaluation = stack.canary.checkSLOs(triggerMetrics);
  assert.equal(evaluation.decision, "rollback");
  const canaryId = stack.canary.getStatus().canaryId;
  const record = stack.rollback.execute(
    canaryId,
    `stop:${evaluation.violations[0]?.rule ?? "unknown"}`,
  );
  const verification = stack.rollback.verify(canaryId);
  assert.equal(verification.verified, true, JSON.stringify(verification));
  stack.record.rounds.push({
    label: stack.label,
    violation: evaluation.violations[0] ?? null,
    fenced: record.fenced,
    dispatchBlocked: record.dispatchBlocked,
    pointerMovedTo: record.lastKnownGoodVersionId,
    rollbackVerified: verification.verified,
  });
}

async function main() {
  const roundsOut = [];

  // Rollback rounds: each absolute stop rule + telemetry blindness + relative rules
  for (const rule of ABSOLUTE_RULES) {
    const stack = freshStack(`absolute:${rule}`);
    candidateRound(stack, healthyMetrics({ samples: 10, [rule]: 1 }));
    roundsOut.push(stack.record);
  }
  {
    // telemetry blindness: non-finite/missing measurements
    const stack = freshStack("blindness:missing-measurements");
    candidateRound(stack, { samples: 10, canary: {}, control: {} });
    roundsOut.push(stack.record);
  }
  {
    // relative: p99 latency ratio 2.0 > 1.5
    const stack = freshStack("relative:p99-latency-ratio");
    candidateRound(
      stack,
      healthyMetrics({
        samples: 10,
        canary: { p99LatencyMs: 200, errorRate: 0.01 },
        control: { p99LatencyMs: 100, errorRate: 0.01 },
      }),
    );
    roundsOut.push(stack.record);
  }
  {
    // relative: error rate ratio 3.0 > 2.0
    const stack = freshStack("relative:error-rate-ratio");
    candidateRound(
      stack,
      healthyMetrics({
        samples: 10,
        canary: { p99LatencyMs: 100, errorRate: 0.03 },
        control: { p99LatencyMs: 100, errorRate: 0.01 },
      }),
    );
    roundsOut.push(stack.record);
  }

  // Promotion path
  {
    let tick = 0;
    const stack = createRolloutStack({
      now: () => new Date(2026, 8, 5, 12, 0, tick).toISOString(),
      canaryClock: () => (tick += 61_000),
      stopRules: { minSamples: 50, minDurationMs: 60_000 },
    });
    seedGood(stack);
    const candidate = stack.versionRegistry.register({ mode: "candidate" });
    stack.canary.start({ mode: "candidate" }, { configVersion: candidate.versionId });
    for (let i = 0; i < 3; i++) {
      const evaluation = stack.canary.checkSLOs(healthyMetrics({ samples: 25 }));
      assert.equal(evaluation.decision, "healthy");
    }
    assert.equal(stack.canary.shouldPromote(), true);
    stack.canary.markPromoted();
    stack.versionRegistry.markKnownGood(candidate.versionId, {
      canaryId: stack.canary.getStatus().canaryId,
      samples: 75,
    });
    roundsOut.push({
      label: "promotion-path",
      rounds: [
        {
          label: "promotion-path",
          healthyEvaluations: 3,
          samples: 75,
          promoted: true,
          knownGood: candidate.versionId,
        },
      ],
    });
  }

  const summary = {
    schema: "csm-g8-drill/1",
    executedAt: new Date().toISOString(),
    host: "this-machine (MVD per t007-mvd-designation)",
    controllers: "lib/rollout canary + rollback + versions (production modules)",
    stopRulesExercised: [
      "falseVerified",
      "unauthorizedEffects",
      "duplicateNonIdempotentEffects",
      "provenanceMismatches",
      "telemetryBlindSpots",
      "p99-latency-ratio",
      "error-rate-ratio",
    ],
    rollbackDrillsVerified: roundsOut.filter((r) => r.rounds?.[0]?.rollbackVerified === true)
      .length,
    promotionPathVerified: roundsOut.some((r) =>
      (r.rounds ?? []).some((round) => round.promoted === true),
    ),
    rounds: roundsOut,
  };

  assert.equal(summary.rollbackDrillsVerified, 8, "all 8 rollback drills must verify");
  assert.equal(summary.promotionPathVerified, true, "promotion path must verify");

  const out = process.argv.includes("--out")
    ? process.argv[process.argv.indexOf("--out") + 1]
    : ".agents/evidence/t007-g8-drill.json";
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(
    `G8 DRILL: PASS — ${summary.rollbackDrillsVerified}/8 rollback drills verified, promotion path verified`,
  );
  console.log(`evidence: ${out}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
