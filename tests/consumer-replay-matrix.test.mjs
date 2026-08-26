import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import inventory from "./fixtures/json-migration/edge-inventory.json" with { type: "json" };
import { resolveConsumerInput } from "../lib/consumer-adapters/index.mjs";
import { digest } from "../lib/schema-runtime/index.mjs";
import { resolvePlanInput } from "../csm-plan/lib/input-resolver.mjs";
import { resolveBddInput } from "../csm-build/lib/bdd-input-resolver.mjs";
import {
  createBuildState,
  dispatchBuild,
  recoverBuildState,
  resolveBuildInputs,
  transitionBuildState,
} from "../csm-build/lib/state.mjs";
import { resolveTestPackage } from "../csm-build/lib/test-package.mjs";
import {
  validatePublicationDescriptor,
  snapshotPublicationInputs,
} from "../csm-upload/lib/publication.mjs";
import {
  analyzeRepository,
  readPublishedPair,
  writeArtifacts,
} from "../csm-ddd/lib/ddd/pipeline.mjs";
import { replayFixtures, writeBuildFixtures } from "./fixtures/json-migration/replay-fixtures.mjs";

const fixtures = await replayFixtures();
const { payloads, envelopes, registry, verification } = fixtures;
const sourcePlanDigest = digest(payloads.plan);

test("declared edges have registered producer-shaped fixtures", () => {
  assert.equal(inventory.edges.length, 17);
  for (const edge of inventory.edges) {
    const value =
      edge.producer === "csm-ddd"
        ? payloads.ddd
        : payloads[
            edge.path.artifact === "norms"
              ? "norms"
              : edge.path.artifact === "finding"
                ? "research"
                : edge.path.artifact === "review"
                  ? "review"
                  : edge.path.artifact === "approach"
                    ? "approach"
                    : edge.path.artifact === "package"
                      ? "bdd"
                      : edge.path.artifact === "test-ledger"
                        ? "tests"
                        : edge.path.artifact === "evidence"
                          ? "browse"
                          : "plan"
          ];
    const schema = edge.producer === "csm-ddd" ? "csm-ddd-graph/1" : edge.schema.producer;
    assert.equal(registry.validate(schema, value).valid, true, edge.id);
    assert.equal(edge.owner.producer, edge.producer);
  }
});

test("feasible edges execute their real consumer resolvers and preserve identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-replay-matrix-"));
  try {
    await writeBuildFixtures(root, payloads, verification);
    await writeFile(join(root, "package.json"), JSON.stringify(payloads.bdd));
    const direct = [
      ["csm-scan->csm-plan", "norms", "norms", "csm-scan"],
      ["csm-deep-research->csm-plan", "research", "research", "csm-deep-research"],
      ["csm-review->csm-plan", "review", "review", "csm-review"],
      ["csm-grill->csm-plan", "approach", "approach", "csm-grill"],
    ];
    for (const [edge, kind, key, owner] of direct) {
      const result = await resolvePlanInput(kind, payloads[key], { root });
      assert.equal(result.status, "resolved", edge);
      assert.equal(
        result.value.runId ?? result.value.artifact?.runId,
        payloads[key].runId ?? payloads[key].artifact?.runId,
        edge,
      );
      assert.equal(owner, edge.split("->")[0], edge);
    }

    const bdd = await resolveBddInput("package.json", { root });
    assert.equal(bdd.status, "resolved", "csm-plan->csm-bdd-tdd");
    assert.equal(bdd.value.sourcePlan.digest, sourcePlanDigest);
    const tests = await resolveTestPackage(payloads.tests, {
      root,
      expectedPlanDigest: sourcePlanDigest,
      replay: true,
    });
    assert.equal(tests.status, "resolved", "csm-make-tests->csm-build");
    assert.equal(tests.digest, digest(payloads.tests));

    const buildInputs = await resolveBuildInputs(
      {
        plan: payloads.plan,
        bdd: payloads.bdd,
        tests: payloads.tests,
        ddd: payloads.ddd,
        norms: payloads.norms,
      },
      { root, expectedPlanDigest: sourcePlanDigest },
    );
    assert.equal(buildInputs.status, "resolved", "plan/ddd/scan->build");
    assert.deepEqual(
      buildInputs.inputs.map((input) => input.owner),
      ["csm-plan", "csm-bdd-tdd", "csm-make-tests", "csm-ddd", "csm-norms"],
    );

    for (const [edge, input, owner] of [
      ["scan->review", envelopes.norms, "csm-scan"],
      ["research->grill", envelopes.research, "csm-deep-research"],
      ["research->make-tests", envelopes.research, "csm-deep-research"],
      ["review->grill", envelopes.review, "csm-review"],
    ]) {
      const result = await resolveConsumerInput(edge, input, { root });
      assert.equal(result.status, "resolved", edge);
      assert.deepEqual(result.lineage, {
        owner,
        runId: "run-replay-source",
        digest: input.payload.artifactDigest ?? digest(input.payload),
      });
      assert.equal(
        result.value.runId ?? result.envelope?.artifact.runId,
        "run-replay-source",
        edge,
      );
    }

    const evidencePath = "evidence.txt";
    await writeFile(join(root, evidencePath), "evidence");
    const evidenceDigest = `sha256:${createHash("sha256").update("evidence").digest("hex")}`;
    const publication = {
      ...payloads.publication,
      inputs: [
        {
          evidenceId: payloads.browse.evidenceId,
          path: evidencePath,
          bytes: 8,
          contentType: "text/plain",
          digest: evidenceDigest,
        },
      ],
    };
    publication.descriptorDigest = digest(
      Object.fromEntries(Object.entries(publication).filter(([key]) => key !== "descriptorDigest")),
    );
    assert.equal(validatePublicationDescriptor(publication).sourceRunId, "run-replay-source");
    assert.equal((await snapshotPublicationInputs(publication, { root }))[0].path, evidencePath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("DDD publishes a valid pair, ddd->plan resolves it, and failed replacement rolls back", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-ddd-replay-"));
  try {
    await writeFile(join(root, "README.md"), "replay repository\n");
    const first = await analyzeRepository({
      root,
      runId: "run-ddd-replay-1",
      now: "2026-08-26T00:00:00.000Z",
    });
    const report = join(root, ".agents/ddd/report.json");
    const graph = join(root, ".agents/ddd/graph.json");
    const published = await writeArtifacts(first, report, graph, { root });
    const pair = await readPublishedPair(report, graph, root);
    assert.equal(pair.ok, true);
    assert.equal(pair.pointer.runId, first.runId);
    assert.equal(
      pair.pointer.graphSha256,
      createHash("sha256").update(first.graphJson).digest("hex"),
    );
    assert.equal(
      pair.pointer.reportSha256,
      createHash("sha256").update(first.reportJson).digest("hex"),
    );
    const ddd = await resolvePlanInput("ddd", published.descriptor, { root });
    assert.equal(ddd.status, "resolved");
    assert.equal(ddd.value.format, "csm-ddd-graph/1");
    const second = await analyzeRepository({
      root,
      runId: "run-ddd-replay-2",
      now: "2026-08-26T00:00:01.000Z",
    });
    await assert.rejects(
      () => writeArtifacts(second, report, graph, { root, failureAt: "after-report" }),
      /injected publication failure/,
    );
    const retained = await readPublishedPair(report, graph, root);
    assert.equal(retained.ok, true);
    assert.equal(retained.pointer.runId, first.runId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("lifecycle, recovery, ownership, projection, legacy, and mutation negatives fail closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-replay-negative-"));
  try {
    const state = createBuildState({
      sourcePlan: { artifactId: payloads.plan.artifactId, digest: sourcePlanDigest },
    });
    const paused = transitionBuildState(transitionBuildState(state, "VALIDATE"), "SELECT");
    const recovered = recoverBuildState(transitionBuildState(paused, "PAUSED"));
    assert.equal(recovered.control.currentState, "RECOVER");
    const selected = transitionBuildState(recovered, "VALIDATE");
    assert.equal(
      dispatchBuild(transitionBuildState(selected, "SELECT"), { status: "resolved", inputs: [] })
        .control.currentState,
      "DISPATCH",
    );
    const wrongOwner = structuredClone(envelopes.research);
    wrongOwner.artifact.owner = "csm-review";
    assert.equal(
      (await resolveConsumerInput("research->grill", wrongOwner)).code,
      "ownership-mismatch",
    );
    const stale = structuredClone(envelopes.research);
    stale.artifact.digest = `sha256:${"f".repeat(64)}`;
    assert.equal((await resolveConsumerInput("research->grill", stale)).code, "digest-mismatch");
    assert.equal(
      (await resolveBddInput({ schema: "csm-projection/1" }, { root })).code,
      "projection-input",
    );
    assert.equal((await resolveTestPackage("legacy-ledger.md", { root })).code, "json-only-input");
    assert.equal(
      (await resolveConsumerInput("research->grill", { schema: "csm-research/1" })).code,
      "bare-payload",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
