"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import {
  createProgressDocument,
  itemForNode,
  updateProgress,
} from "../csm-orchestrate/lib/progress.mjs";
import { projectProgress } from "../csm-orchestrate/output/projection.mjs";

const phase = { phaseId: "phase-project", graphRevision: 1 };
const makeItem = (nodeId, skill, weight = 50) =>
  itemForNode({
    runId: "run-project",
    graphRevision: 1,
    phase,
    node: { nodeId, skill },
    weight,
  });

test("projection renders one aggregate bar and one milestone row", () => {
  const first = makeItem("node-one", "csm-build");
  const second = makeItem("node-two", "csm-review");
  let document = createProgressDocument({ runId: "run-project", items: [first, second] });
  document = updateProgress(document, first.itemId, { state: "verified" });
  document = updateProgress(document, second.itemId, {
    state: "active",
    verifiedFraction: 0.2,
    attempt: 2,
  });
  const projection = projectProgress(document);

  assert.equal(projection.overall.percentage, 60);
  assert.equal(projection.metrics.aggregate.plannedProgress, 0.6);
  assert.equal(projection.metrics.skillInvocations.observed, 2);
  assert.deepEqual(projection.metrics.attempts, { total: 3, retried: 1 });
  assert.equal(projection.metrics.telemetry.eventsObserved, document.aggregate.eventsObserved);
  assert.equal(projection.text.split("\n").length, 3);
  assert.match(projection.text, /TASK PROGRESS/);
  assert.match(projection.text, /csm-build\/node-one complete/);
});

test("quiet progress suppresses text without changing canonical metrics", () => {
  const document = createProgressDocument({
    runId: "run-project",
    items: [makeItem("node-one", "csm-build")],
  });
  const projection = projectProgress(document, { quiet: true });
  assert.equal(projection.text, "");
  assert.equal(projection.metrics.aggregate.plannedProgress, 0);
  assert.equal(projection.metrics.telemetry.eventsObserved, 0);
});

test("indeterminate and terminal states remain textual", () => {
  const empty = projectProgress(createProgressDocument({ runId: "run-project" }));
  assert.match(empty.text, /not estimated/);
  let document = createProgressDocument({
    runId: "run-project",
    items: [makeItem("node-one", "csm-build")],
  });
  document = updateProgress(document, document.items[0].itemId, {
    state: "blocked",
    blocker: { code: "WAITING", message: "secret detail" },
  });
  const projection = projectProgress(document);
  assert.match(projection.text, /blocked/);
  assert.match(projection.text, /0%/);
});

test("projection consumes canonical JSON only and does not parse Markdown", () => {
  assert.throws(() => projectProgress("TASK PROGRESS [####] 100%"), /canonical JSON/);
});

test("browse and upload profiles redact sensitive operational fields", () => {
  const item = makeItem("node-secret", "csm-browse");
  const document = createProgressDocument({
    runId: "run-project",
    items: [
      {
        ...item,
        evidenceRefs: ["sha256:" + "a".repeat(64)],
        blocker: { code: "AUTH", message: "password=secret" },
      },
    ],
  });
  const browse = projectProgress(document, { profile: "csm-browse" });
  const upload = projectProgress(
    { ...document, items: [{ ...document.items[0], skill: "csm-upload" }] },
    { profile: "csm-upload" },
  );
  for (const projection of [browse, upload]) {
    assert.doesNotMatch(projection.text, /secret|password|sha256/);
    assert.equal(projection.milestones[0].name, `${projection.profile}/phase-project`);
    assert.equal(projection.milestones[0].evidenceRefs, undefined);
  }
  const inferred = projectProgress(document);
  assert.doesNotMatch(inferred.text, /node-secret|sha256/);
});
