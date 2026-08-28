"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { createConfigVersionRegistry } from "../../lib/rollout/versions.mjs";
import { fixedNow } from "./helpers.mjs";

function registry() {
  return createConfigVersionRegistry({ now: fixedNow });
}

test("config versions: registration records a stable digest and an immutable config snapshot", () => {
  const versionRegistry = registry();
  const record = versionRegistry.register({ mode: "baseline", nested: { items: [1] } });
  assert.equal(record.state, "registered");
  assert.ok(record.versionId.startsWith("cfg-v1-"));
  assert.equal(record.registeredAt, fixedNow());
  assert.equal(record.configDigest.startsWith("sha256:"), true);
  assert.deepEqual(record.config, { mode: "baseline", nested: { items: [1] } });
  assert.throws(() => {
    record.config.mode = "mutated";
  }, TypeError);
  assert.throws(() => {
    record.state = "active";
  }, TypeError);
});

test("config versions: registration is idempotent by digest and history is append-only", () => {
  const versionRegistry = registry();
  const first = versionRegistry.register({ mode: "baseline" });
  const again = versionRegistry.register({ mode: "baseline" });
  assert.equal(again.versionId, first.versionId);
  const second = versionRegistry.register({ mode: "candidate" });
  assert.notEqual(second.versionId, first.versionId);
  assert.ok(second.versionId.startsWith("cfg-v2-"));
  assert.equal(versionRegistry.historySize(), 2);
  assert.deepEqual(
    versionRegistry.list().map((record) => record.seq),
    [1, 2],
  );
});

test("config versions: activation moves the single active pointer atomically", () => {
  const versionRegistry = registry();
  const first = versionRegistry.register({ mode: "one" });
  const second = versionRegistry.register({ mode: "two" });
  const activation = versionRegistry.activate(first.versionId);
  assert.deepEqual(activation, {
    activated: first.versionId,
    previousActiveVersionId: null,
    changed: true,
  });
  assert.equal(versionRegistry.getActiveVersionId(), first.versionId);
  assert.equal(versionRegistry.getActive().versionId, first.versionId);
  const reactivation = versionRegistry.activate(first.versionId);
  assert.equal(reactivation.changed, false);
  const switchOver = versionRegistry.activate(second.versionId);
  assert.deepEqual(switchOver, {
    activated: second.versionId,
    previousActiveVersionId: first.versionId,
    changed: true,
  });
  assert.equal(versionRegistry.get(first.versionId).state, "superseded");
  assert.equal(versionRegistry.get(first.versionId).supersededAt, fixedNow());
  assert.equal(versionRegistry.get(second.versionId).state, "active");
  assert.equal(versionRegistry.get(second.versionId).activations.length, 1);
  assert.equal(
    versionRegistry.get(second.versionId).activations[0].previousActiveVersionId,
    first.versionId,
  );
});

test("config versions: fencing is terminal, clears an active pointer, and blocks dispatch immediately", () => {
  const versionRegistry = registry();
  const first = versionRegistry.register({ mode: "one" });
  versionRegistry.activate(first.versionId);
  assert.equal(versionRegistry.authorizeDispatch(first.versionId).allowed, true);
  const fenced = versionRegistry.fence(first.versionId, "stop-condition");
  assert.equal(fenced.state, "fenced");
  assert.equal(fenced.fenceReason, "stop-condition");
  assert.equal(fenced.fencedWhileActive, true);
  assert.equal(versionRegistry.getActiveVersionId(), null);
  assert.equal(versionRegistry.authorizeDispatch(first.versionId).reason, "version-fenced");
  assert.throws(
    () => versionRegistry.activate(first.versionId),
    (error) => error.code === "version-fenced",
  );
  assert.throws(
    () => versionRegistry.markKnownGood(first.versionId),
    (error) => error.code === "version-fenced",
  );
  const refenced = versionRegistry.fence(first.versionId, "different-reason");
  assert.equal(refenced.fenceReason, "stop-condition");
});

test("config versions: dispatch authorization only ever allows the single active version", () => {
  const versionRegistry = registry();
  const active = versionRegistry.register({ mode: "active" });
  const idle = versionRegistry.register({ mode: "idle" });
  versionRegistry.activate(active.versionId);
  assert.deepEqual(versionRegistry.authorizeDispatch(active.versionId), {
    allowed: true,
    reason: "active-version",
    versionId: active.versionId,
  });
  assert.deepEqual(versionRegistry.authorizeDispatch(idle.versionId), {
    allowed: false,
    reason: "not-active",
    versionId: idle.versionId,
  });
  assert.deepEqual(versionRegistry.authorizeDispatch("cfg-v99-deadbeef"), {
    allowed: false,
    reason: "unknown-version",
    versionId: "cfg-v99-deadbeef",
  });
  const decision = versionRegistry.assertDispatchable(active.versionId);
  assert.equal(decision.allowed, true);
  assert.throws(
    () => versionRegistry.assertDispatchable(idle.versionId),
    (error) => error.code === "not-active",
  );
});

test("config versions: last known good respects exclusions and never returns a fenced version", () => {
  const versionRegistry = registry();
  const first = versionRegistry.register({ mode: "one" });
  const second = versionRegistry.register({ mode: "two" });
  const third = versionRegistry.register({ mode: "three" });
  versionRegistry.markKnownGood(first.versionId, { run: 1 });
  versionRegistry.markKnownGood(second.versionId, { run: 2 });
  assert.equal(versionRegistry.getLastKnownGood().versionId, second.versionId);
  assert.equal(
    versionRegistry.getLastKnownGood({ excluding: second.versionId }).versionId,
    first.versionId,
  );
  versionRegistry.fence(second.versionId, "bad");
  assert.equal(versionRegistry.getLastKnownGood().versionId, first.versionId);
  versionRegistry.fence(first.versionId, "bad-too");
  assert.equal(versionRegistry.getLastKnownGood(), null);
  assert.equal(versionRegistry.get(third.versionId).knownGood, false);
});

test("config versions: unknown versions and invalid inputs fail closed", () => {
  const versionRegistry = registry();
  assert.throws(
    () => versionRegistry.get("cfg-v1-nope"),
    (error) => error.code === "unknown-version",
  );
  assert.throws(
    () => versionRegistry.activate(null),
    (error) => error.code === "unknown-version",
  );
  assert.throws(
    () => versionRegistry.fence("cfg-v1-nope", "reason"),
    (error) => error.code === "unknown-version",
  );
  assert.throws(
    () => versionRegistry.register("not-an-object"),
    (error) => error.code === "invalid-config",
  );
  assert.throws(
    () => versionRegistry.fence(versionRegistry.register({}).versionId, ""),
    (error) => error.code === "invalid-reason",
  );
});

test("config versions: superseded history and known-good evidence survive later transitions", () => {
  const versionRegistry = registry();
  const first = versionRegistry.register({ mode: "one" });
  const second = versionRegistry.register({ mode: "two" });
  versionRegistry.activate(first.versionId);
  versionRegistry.markKnownGood(first.versionId, { canaryId: "canary-1", samples: 120 });
  versionRegistry.activate(second.versionId);
  const record = versionRegistry.get(first.versionId);
  assert.equal(record.state, "superseded");
  assert.equal(record.knownGood, true);
  assert.deepEqual(record.knownGoodEvidence, { canaryId: "canary-1", samples: 120 });
  assert.equal(versionRegistry.list().length, 2);
  versionRegistry.activate(first.versionId);
  assert.equal(versionRegistry.get(first.versionId).state, "active");
  assert.equal(versionRegistry.get(first.versionId).activations.length, 2);
  assert.equal(versionRegistry.get(second.versionId).state, "superseded");
});
