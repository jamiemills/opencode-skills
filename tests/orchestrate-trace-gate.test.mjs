"use strict";

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TRACE_ENFORCEMENT,
  evaluateTraceGate,
  resolveTracePolicy,
} from "../scripts/lib/trace-enforcement.mjs";

test("policy precedence: flag > env > default auto", () => {
  assert.equal(
    resolveTracePolicy({ flag: "required", env: { CSM_TRACE_ENFORCE: "off" } }),
    "required",
  );
  assert.equal(resolveTracePolicy({ flag: "off", env: { CSM_TRACE_ENFORCE: "required" } }), "off");
  assert.equal(
    resolveTracePolicy({ flag: null, env: { CSM_TRACE_ENFORCE: "required" } }),
    "required",
  );
  assert.equal(resolveTracePolicy({ flag: null, env: { CSM_TRACE_ENFORCE: " bogus " } }), "auto");
  assert.equal(resolveTracePolicy({ flag: null, env: {} }), DEFAULT_TRACE_ENFORCEMENT);
});

test("Jev active forces the strict required policy", () => {
  assert.equal(
    resolveTracePolicy({ jevActive: true, env: { CSM_TRACE_ENFORCE: "off" } }),
    "required",
  );
  assert.equal(resolveTracePolicy({ jevActive: true, env: {} }), "required");
  assert.equal(
    resolveTracePolicy({ jevActive: true, flag: "off" }),
    "off",
    "explicit host off still wins",
  );
});

test("off never enforces", () => {
  const gate = evaluateTraceGate({ policy: "off", scheduled: 5, matched: 0 });
  assert.equal(gate.enforce, false);
  assert.equal(gate.ok, true);
});

test("required enforces on any run", () => {
  assert.equal(evaluateTraceGate({ policy: "required", scheduled: 0, matched: 0 }).ok, false);
  assert.equal(evaluateTraceGate({ policy: "required", scheduled: 0, matched: 1 }).ok, true);
});

test("auto passes a run that scheduled no tracing", () => {
  const gate = evaluateTraceGate({ policy: "auto", scheduled: 0, matched: 0 });
  assert.equal(gate.enforce, false);
  assert.equal(gate.ok, true);
  assert.equal(gate.reason, "not-scheduled");
});

test("auto fails a run that scheduled tracing but produced none", () => {
  const gate = evaluateTraceGate({ policy: "auto", scheduled: 2, matched: 0 });
  assert.equal(gate.enforce, true);
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "no-trace-for-run");
});

test("auto passes a run that scheduled and emitted", () => {
  assert.equal(evaluateTraceGate({ policy: "auto", scheduled: 2, matched: 3 }).ok, true);
});
