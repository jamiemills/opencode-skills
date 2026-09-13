"use strict";

import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import test from "node:test";
import { loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";
import {
  createMemoryTransport,
  createTelemetryEmitter,
} from "../csm-orchestrate/lib/telemetry.mjs";
import {
  EGRESS_LIMIT_REASONS,
  createEgressBroker,
  createEgressBrokerListener,
  createEgressLedger,
  enforceEgressLimits,
  evaluateEgress,
  validateEgressPolicy,
  verifyEgressChain,
} from "../csm-orchestrate/lib/egress-broker.mjs";

const registry = await loadSchemaRegistry();
const policy = {
  schema: "csm-orchestrate-egress-policy/1",
  schemaRevision: 1,
  defaultAction: "deny",
  failMode: "blocked",
  entries: [{ scheme: "https", host: "registry.npmjs.org", port: 443 }],
  credentialInjections: [
    { host: "registry.npmjs.org", header: "Authorization", credentialRef: "credref-npm" },
  ],
};

test("T007: egress policy is default-deny and allowlisted by host:port", () => {
  validateEgressPolicy(policy);
  assert.equal(
    evaluateEgress(policy, { scheme: "https", host: "registry.npmjs.org", port: 443 }).decision,
    "allowed",
  );
  assert.equal(
    evaluateEgress(policy, { scheme: "https", host: "evil.example", port: 443 }).decision,
    "denied",
  );
  assert.equal(
    evaluateEgress(policy, { scheme: "https", host: "registry.npmjs.org", port: 8443 }).decision,
    "denied",
  );
  assert.throws(() => validateEgressPolicy({ defaultAction: "allow" }), /default-deny/);
});

test("T007: a scheme-less target cannot satisfy a scheme-scoped rule", () => {
  assert.equal(
    evaluateEgress(policy, { host: "registry.npmjs.org", port: 443 }).decision,
    "denied",
  );
  const scoped = {
    ...policy,
    entries: [
      { scheme: "https", host: "api.example", port: 443, methods: ["GET"], pathPrefix: "/safe" },
    ],
  };
  assert.equal(
    evaluateEgress(scoped, {
      scheme: "https",
      host: "api.example",
      port: 443,
      method: "GET",
      path: "/safe/x",
    }).decision,
    "allowed",
  );
  assert.equal(
    evaluateEgress(scoped, {
      scheme: "https",
      host: "api.example",
      port: 443,
      method: "DELETE",
      path: "/safe/x",
    }).decision,
    "denied",
  );
  assert.equal(
    evaluateEgress(scoped, {
      scheme: "https",
      host: "api.example",
      port: 443,
      method: "GET",
      path: "/secret",
    }).decision,
    "denied",
  );
  for (const path of ["/safe/../secret", "/safe/..%2f..%2fsecret", "/safex"])
    assert.equal(
      evaluateEgress(scoped, {
        scheme: "https",
        host: "api.example",
        port: 443,
        method: "GET",
        path,
      }).decision,
      "denied",
      `path traversal must be denied: ${path}`,
    );
});

test("T007: the egress audit chain detects edits, reordering, and wrong keys", () => {
  const ledger = createEgressLedger({ runId: "run-egress-1", key: "host-secret-key" });
  const first = ledger.append({
    decision: "allowed",
    targetHost: "registry.npmjs.org",
    targetPort: 443,
  });
  const second = ledger.append({ decision: "denied", targetHost: "evil.example", targetPort: 443 });
  assert.equal(first.previousHash, `sha256:${"0".repeat(64)}`);
  assert.equal(second.previousHash, first.recordHash);
  assert.equal(ledger.verify().valid, true);
  assert.equal(registry.validate("csm-orchestrate-egress-event/1", second).valid, true);

  const edited = ledger.records();
  edited[0].decision = "denied";
  assert.equal(verifyEgressChain(edited, "host-secret-key").why, "recordHash");
  assert.equal(verifyEgressChain(ledger.records(), "attacker-key-999").why, "anchor-mac");
  assert.throws(() => ledger.append({ decision: "allowed", targetPort: 443 }), /targetHost/);
  assert.throws(
    () =>
      ledger.append({
        decision: "allowed",
        targetHost: "x",
        targetPort: 443,
        credentialRef: "not-a-ref",
      }),
    /credentialRef/,
  );
});

test("T007: broker denies by default, logs every attempt, and retains target identity", async () => {
  const transport = createMemoryTransport();
  const emitter = createTelemetryEmitter({
    runId: "run-egress-1",
    effectiveConfigDigest: `sha256:${"a".repeat(64)}`,
    transport,
  });
  const ledger = createEgressLedger({ runId: "run-egress-1", key: "host-secret-key" });
  const broker = createEgressBroker({
    policy,
    ledger,
    emitter,
    policyDigest: `sha256:${"b".repeat(64)}`,
    credentials: { "credref-npm": "opaque-token" },
  });

  const allowed = await broker.handle(
    { scheme: "https", host: "registry.npmjs.org", port: 443 },
    { credentialRef: "credref-npm", workerId: "worker-build-1", taskId: "task-build-1" },
  );
  const denied = await broker.handle({ scheme: "https", host: "evil.example", port: 443 });
  assert.equal(allowed.decision, "allowed");
  assert.equal(denied.decision, "denied");
  assert.equal(ledger.length(), 2);
  assert.equal(ledger.verify().valid, true);

  const decisions = transport.list().filter((event) => event.eventType === "egress.decision");
  assert.equal(decisions.length, 2);
  assert.equal(decisions[0].payload.targetHost, "registry.npmjs.org");
  assert.equal(decisions[0].payload.credentialRef, "credref-npm");
  assert.equal(JSON.stringify(decisions).includes("host-secret-key"), false, "no secret leaks");
});

test("T007: anchor metadata and malformed policy are fail-closed", () => {
  const ledger = createEgressLedger({ runId: "run-egress-1", key: "host-secret-key" });
  ledger.append({ decision: "allowed", targetHost: "registry.npmjs.org", targetPort: 443 });
  const tampered = ledger.records();
  tampered[0].anchor.keyId = "attacker";
  assert.equal(verifyEgressChain(tampered, "host-secret-key").why, "anchor-mac");
  assert.equal(verifyEgressChain([null], "host-secret-key").valid, false);
  assert.throws(
    () => validateEgressPolicy({ ...policy, entries: [{ host: "x", port: 443, methods: "GET" }] }),
    /methods/,
  );
  assert.throws(
    () => validateEgressPolicy({ ...policy, entries: [{ host: "x", port: 443, pathPrefix: 123 }] }),
    /pathPrefix/,
  );
  assert.throws(
    () => createEgressLedger({ runId: "bad", key: "host-secret-key" }),
    /canonical runId/,
  );
});

test("T004: the egress chain persists, reloads, verifies, and anchors externally", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "csm-egress-"));
  const filePath = join(dir, "egress.jsonl");
  const published = [];
  try {
    const first = createEgressLedger({
      runId: "run-egress-1",
      key: "host-secret-key",
      filePath,
      publishAnchor: (event) => published.push(event),
    });
    first.append({ decision: "allowed", targetHost: "registry.npmjs.org", targetPort: 443 });
    first.append({ decision: "denied", targetHost: "evil.example", targetPort: 443 });
    assert.equal(first.length(), 2);
    assert.equal(published.length, 2);

    const reloaded = createEgressLedger({
      runId: "run-egress-1",
      key: "host-secret-key",
      filePath,
    });
    assert.equal(reloaded.length(), 2);
    assert.equal(reloaded.verify().valid, true);
    const third = reloaded.append({
      decision: "allowed",
      targetHost: "api.example",
      targetPort: 443,
    });
    assert.equal(third.sequence, 2);
    assert.equal(third.previousHash, reloaded.records()[1].recordHash);

    // Tampering the persisted chain is detected on reload.
    const { readFileSync, writeFileSync: write } = await import("node:fs");
    const rows = readFileSync(filePath, "utf8").trim().split("\n");
    const tampered = JSON.parse(rows[0]);
    tampered.decision = "denied";
    rows[0] = JSON.stringify(tampered);
    write(filePath, `${rows.join("\n")}\n`);
    assert.throws(
      () => createEgressLedger({ runId: "run-egress-1", key: "host-secret-key", filePath }),
      /failed verification/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("T004: the durable chain binds runId, tolerates a torn tail, and enforces the anchor", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "csm-egress-2-"));
  const filePath = join(dir, "egress.jsonl");
  try {
    const ledger = createEgressLedger({ runId: "run-egress-1", key: "host-secret-key", filePath });
    ledger.append({ decision: "allowed", targetHost: "a.example", targetPort: 443 });
    appendFileSync(filePath, '{"partial":');
    const reloaded = createEgressLedger({
      runId: "run-egress-1",
      key: "host-secret-key",
      filePath,
    });
    assert.equal(reloaded.length(), 1, "torn tail must be dropped");
    assert.throws(
      () => createEgressLedger({ runId: "run-other-1", key: "host-secret-key", filePath }),
      /different run/,
    );
    assert.throws(
      () =>
        createEgressLedger({
          runId: "run-egress-1",
          key: "host-secret-key",
          filePath,
          readAnchor: () => `sha256:${"0".repeat(64)}`,
        }),
      /external anchor/,
    );
    const anchored = createEgressLedger({
      runId: "run-egress-1",
      key: "host-secret-key",
      filePath,
    });
    const head = anchored.records().at(-1).anchor.headDigest;
    const good = createEgressLedger({
      runId: "run-egress-1",
      key: "host-secret-key",
      filePath,
      readAnchor: () => head,
    });
    assert.equal(good.length(), 1);

    const failingPath = join(dir, "egress-2.jsonl");
    const failing = createEgressLedger({
      runId: "run-egress-2",
      key: "host-secret-key",
      filePath: failingPath,
      publishAnchor: () => {
        throw new Error("anchor down");
      },
    });
    assert.throws(
      () => failing.append({ decision: "allowed", targetHost: "b.example", targetPort: 443 }),
      /anchor publication failed/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("T004: credentials are injected broker-side and never logged", async () => {
  const transport = createMemoryTransport();
  const emitter = createTelemetryEmitter({
    runId: "run-egress-1",
    effectiveConfigDigest: `sha256:${"a".repeat(64)}`,
    transport,
  });
  const ledger = createEgressLedger({ runId: "run-egress-1", key: "host-secret-key" });
  const broker = createEgressBroker({
    policy,
    ledger,
    emitter,
    credentials: { "credref-npm": "SUPER-SECRET-TOKEN" },
  });
  const allowed = await broker.handle(
    { scheme: "https", host: "registry.npmjs.org", port: 443 },
    { credentialRef: "credref-npm" },
  );
  assert.equal(allowed.injection.header, "Authorization");
  assert.equal(allowed.injection.value, "SUPER-SECRET-TOKEN");
  const denied = await broker.handle(
    { scheme: "https", host: "evil.example", port: 443 },
    { credentialRef: "credref-npm" },
  );
  assert.equal(denied.injection, null);
  const serialized = JSON.stringify({ records: ledger.records(), events: transport.list() });
  assert.equal(serialized.includes("SUPER-SECRET-TOKEN"), false, "secret must never be logged");
});

test("T004: unmediated drops are recorded into the same chain", () => {
  const ledger = createEgressLedger({ runId: "run-egress-1", key: "host-secret-key" });
  const broker = createEgressBroker({ policy, ledger });
  const record = broker.recordDrop({
    targetHost: "1.1.1.1",
    targetPort: 443,
    reasonCode: "kernel-drop",
  });
  assert.equal(record.decision, "dropped-unmediated");
  assert.equal(record.reasonCode, "kernel-drop");
  assert.equal(ledger.verify().valid, true);
});

test("T004: a configured injection with no available secret fails closed", async () => {
  const ledger = createEgressLedger({ runId: "run-egress-1", key: "host-secret-key" });
  const broker = createEgressBroker({ policy, ledger, credentials: {} });
  const result = await broker.handle(
    { scheme: "https", host: "registry.npmjs.org", port: 443 },
    { credentialRef: "credref-npm" },
  );
  assert.equal(result.decision, "denied");
  assert.equal(result.reasonCode, "credential-unavailable");
  assert.equal(result.injection, null);
  assert.equal(result.record.decision, "denied");
});

test("T004: malformed credential injections are rejected by policy validation", () => {
  assert.throws(
    () =>
      validateEgressPolicy({
        ...policy,
        credentialInjections: [{ host: "x", header: "Authorization" }],
      }),
    /credentialRef/,
  );
});

test("T009: allowed egress carries the entry byte/time limits", () => {
  const scoped = {
    ...policy,
    entries: [{ scheme: "https", host: "api.example", port: 443, maxBytes: 1024, timeoutMs: 5000 }],
  };
  const result = evaluateEgress(scoped, { scheme: "https", host: "api.example", port: 443 });
  assert.equal(result.decision, "allowed");
  assert.equal(result.limits.maxBytes, 1024);
  assert.equal(result.limits.timeoutMs, 5000);
});

test("T004: broker denies over-budget bytes and never forwards them", async () => {
  const scoped = {
    ...policy,
    entries: [{ scheme: "https", host: "api.example", port: 443, maxBytes: 100 }],
  };
  const ledger = createEgressLedger({ runId: "run-egress-1", key: "host-secret-key" });
  const broker = createEgressBroker({ policy: scoped, ledger });

  const within = await broker.handle({
    scheme: "https",
    host: "api.example",
    port: 443,
    bytesOut: 40,
    bytesIn: 40,
  });
  assert.equal(within.decision, "allowed");
  assert.equal(within.record.bytesOut, 40);
  assert.equal(within.record.bytesIn, 40);

  const over = await broker.handle({
    scheme: "https",
    host: "api.example",
    port: 443,
    bytesOut: 60,
    bytesIn: 60,
  });
  assert.equal(over.decision, "denied");
  assert.equal(over.reasonCode, "max-bytes-exceeded");
  assert.equal(over.injection, null, "an over-budget request must not be forwarded");
  assert.equal(over.record.decision, "denied");
  assert.equal(over.record.reasonCode, "max-bytes-exceeded");

  const declared = await broker.handle({
    scheme: "https",
    host: "api.example",
    port: 443,
    declaredBytes: 101,
  });
  assert.equal(declared.decision, "denied");
  assert.equal(declared.reasonCode, "max-bytes-exceeded");

  assert.equal(ledger.verify().valid, true);
});

test("T004: broker denies over-budget time and never forwards it", async () => {
  const scoped = {
    ...policy,
    entries: [{ scheme: "https", host: "api.example", port: 443, timeoutMs: 1000 }],
  };
  const ledger = createEgressLedger({ runId: "run-egress-1", key: "host-secret-key" });
  const broker = createEgressBroker({ policy: scoped, ledger });

  const within = await broker.handle({
    scheme: "https",
    host: "api.example",
    port: 443,
    elapsedMs: 250,
    latencyMs: 250,
  });
  assert.equal(within.decision, "allowed");
  assert.equal(within.record.latencyMs, 250);

  const over = await broker.handle({
    scheme: "https",
    host: "api.example",
    port: 443,
    elapsedMs: 1500,
  });
  assert.equal(over.decision, "denied");
  assert.equal(over.reasonCode, "timeout-exceeded");
  assert.equal(over.injection, null, "an over-budget request must not be forwarded");

  const requested = await broker.handle({
    scheme: "https",
    host: "api.example",
    port: 443,
    timeoutMs: 5000,
  });
  assert.equal(requested.decision, "denied");
  assert.equal(requested.reasonCode, "timeout-exceeded");
});

test("T004: malformed egress limits are rejected fail-closed", () => {
  assert.throws(
    () => validateEgressPolicy({ ...policy, entries: [{ host: "x", port: 443, maxBytes: 0 }] }),
    /maxBytes/,
  );
  assert.throws(
    () => validateEgressPolicy({ ...policy, entries: [{ host: "x", port: 443, timeoutMs: -1 }] }),
    /timeoutMs/,
  );
});

const listenerPolicy = {
  ...policy,
  entries: [{ scheme: "https", host: "api.example", port: 443 }],
  credentialInjections: [
    { host: "api.example", header: "Authorization", credentialRef: "credref-api" },
  ],
};

test("T001: listener proxies an allowlisted request and injects the credential only on allow", async () => {
  const forwarded = [];
  const forward = async (request) => {
    forwarded.push(request);
    return { status: 200, headers: { "content-type": "text/plain" }, body: "upstream-ok" };
  };
  const ledger = createEgressLedger({ runId: "run-egress-1", key: "host-secret-key" });
  const listener = createEgressBrokerListener({
    policy: listenerPolicy,
    ledger,
    credentials: { "credref-api": "SUPER-SECRET-TOKEN" },
    forward,
  });

  const result = await listener.handle(
    {
      target: { scheme: "https", host: "api.example", port: 443, method: "GET", path: "/v1" },
      headers: { accept: "application/json" },
      body: "payload",
    },
    { taskId: "task-1", workerId: "worker-1" },
  );

  assert.equal(result.decision, "allowed");
  assert.equal(result.reasonCode, "allowlist-match");
  assert.equal(result.upstream.body, "upstream-ok");
  assert.equal(result.injection, null, "the listener must not echo the injected secret");
  assert.equal(result.credentialRef, "credref-api");
  assert.equal(forwarded.length, 1, "an allowed request must be forwarded");
  assert.equal(forwarded[0].target.host, "api.example");
  assert.equal(forwarded[0].headers.Authorization, "SUPER-SECRET-TOKEN");
  assert.equal(forwarded[0].headers.accept, "application/json");
  assert.equal(forwarded[0].body, "payload");
  assert.equal(result.record.decision, "allowed");
  assert.equal(result.record.credentialRef, "credref-api");
  assert.equal(ledger.length(), 1, "one authoritative record per request");
  assert.equal(ledger.verify().valid, true);
  assert.equal(
    JSON.stringify(result).includes("SUPER-SECRET-TOKEN"),
    false,
    "secret must not leak",
  );
});

test("T001: listener denies an unlisted target and never forwards it", async () => {
  let forwarded = 0;
  const forward = async () => {
    forwarded += 1;
    return { status: 200, body: "should-not-happen" };
  };
  const ledger = createEgressLedger({ runId: "run-egress-1", key: "host-secret-key" });
  const listener = createEgressBrokerListener({ policy: listenerPolicy, ledger, forward });

  const result = await listener.handle({ scheme: "https", host: "evil.example", port: 443 });
  assert.equal(result.decision, "denied");
  assert.equal(result.reasonCode, "default-deny");
  assert.equal(result.upstream, null);
  assert.equal(result.injection, null);
  assert.equal(forwarded, 0, "a denied target must not be forwarded");
  assert.equal(result.record.decision, "denied");
  assert.equal(result.record.reasonCode, "default-deny");
  assert.equal(ledger.verify().valid, true);
});

test("T001: listener denies over-limit requests without forwarding or injecting", async () => {
  const scoped = {
    ...listenerPolicy,
    entries: [{ scheme: "https", host: "api.example", port: 443, maxBytes: 100, timeoutMs: 1000 }],
  };
  let forwarded = 0;
  const forward = async () => {
    forwarded += 1;
    return { status: 200, body: "should-not-happen" };
  };
  const ledger = createEgressLedger({ runId: "run-egress-1", key: "host-secret-key" });
  const listener = createEgressBrokerListener({
    policy: scoped,
    ledger,
    credentials: { "credref-api": "SUPER-SECRET-TOKEN" },
    forward,
  });

  const bytes = await listener.handle({
    scheme: "https",
    host: "api.example",
    port: 443,
    declaredBytes: 101,
  });
  assert.equal(bytes.decision, "denied");
  assert.equal(bytes.reasonCode, EGRESS_LIMIT_REASONS.maxBytes);
  assert.equal(bytes.reasonCode, "max-bytes-exceeded");
  assert.equal(bytes.injection, null);
  assert.equal(bytes.upstream, null);

  const time = await listener.handle({
    scheme: "https",
    host: "api.example",
    port: 443,
    declaredTimeoutMs: 5000,
  });
  assert.equal(time.decision, "denied");
  assert.equal(time.reasonCode, EGRESS_LIMIT_REASONS.timeoutMs);
  assert.equal(time.injection, null);
  assert.equal(time.upstream, null);
  assert.equal(forwarded, 0, "an over-limit request must never be forwarded");
  assert.equal(ledger.verify().valid, true);
});

test("T001: listener enforces the entry timeout budget with a distinct reason code", async () => {
  const scoped = {
    ...listenerPolicy,
    entries: [{ scheme: "https", host: "api.example", port: 443, timeoutMs: 25 }],
  };
  const withinLedger = createEgressLedger({ runId: "run-egress-1", key: "host-secret-key" });
  const within = createEgressBrokerListener({
    policy: scoped,
    ledger: withinLedger,
    credentials: { "credref-api": "SUPER-SECRET-TOKEN" },
    forward: async () => ({ status: 200, body: "fast-ok" }),
  });
  const fast = await within.handle({ scheme: "https", host: "api.example", port: 443 });
  assert.equal(fast.decision, "allowed", "a forward inside the budget must be allowed");

  const ledger = createEgressLedger({ runId: "run-egress-1", key: "host-secret-key" });
  const listener = createEgressBrokerListener({
    policy: scoped,
    ledger,
    credentials: { "credref-api": "SUPER-SECRET-TOKEN" },
    forward: ({ signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  });
  const result = await listener.handle({ scheme: "https", host: "api.example", port: 443 });
  assert.equal(result.decision, "denied");
  assert.equal(result.reasonCode, EGRESS_LIMIT_REASONS.timeoutMs);
  assert.equal(result.reasonCode, "timeout-exceeded");
  assert.notEqual(result.reasonCode, EGRESS_LIMIT_REASONS.maxBytes);
  assert.equal(result.upstream, null);
  assert.equal(result.injection, null, "a timed-out request must not report injected credentials");
  assert.equal(result.record.decision, "denied");
  assert.equal(result.record.reasonCode, "timeout-exceeded");
  assert.equal(ledger.verify().valid, true);
});

test("T001: the enforcement budget is separated from a caller-declared/elapsed timeout", () => {
  const allowed = {
    decision: "allowed",
    reasonCode: "allowlist-match",
    limits: { maxBytes: null, timeoutMs: 1000 },
  };
  // A declared timeout inside the budget and observed time inside the budget: allow.
  assert.equal(enforceEgressLimits(allowed, { elapsedMs: 10, timeoutMs: 500 }).decision, "allowed");
  assert.equal(
    enforceEgressLimits(allowed, { elapsedMs: 10, timeoutMs: 5000 }).reasonCode,
    EGRESS_LIMIT_REASONS.timeoutMs,
  );
  assert.equal(
    enforceEgressLimits(allowed, { declaredTimeoutMs: 1500 }).reasonCode,
    EGRESS_LIMIT_REASONS.timeoutMs,
  );
  assert.equal(
    enforceEgressLimits(allowed, { elapsedMs: 1500 }).reasonCode,
    EGRESS_LIMIT_REASONS.timeoutMs,
  );
  // No entry budget means nothing to enforce, regardless of a caller timeoutMs.
  assert.equal(
    enforceEgressLimits(
      { decision: "allowed", limits: { timeoutMs: null } },
      { timeoutMs: 9_999_999 },
    ).decision,
    "allowed",
  );
});

test("T001: the listener fails closed without a forward transport", () => {
  const ledger = createEgressLedger({ runId: "run-egress-1", key: "host-secret-key" });
  assert.throws(
    () => createEgressBrokerListener({ policy: listenerPolicy, ledger }),
    /forward function/,
  );
});
