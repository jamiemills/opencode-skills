"use strict";

// N2: the verified-sandbox runtime supplies safe defaults for the egress policy,
// forward transport, and ledger key so callers only enable it and provide the
// app-specific worker source/executor.
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
  createHttpForward,
  createVerifiedSandboxRuntime,
  defaultEgressPolicy,
  resolveVerifiedSandboxRuntime,
} from "../csm-orchestrate/lib/verified-sandbox-runtime.mjs";

test("N2: the default egress policy is default-deny", () => {
  const policy = defaultEgressPolicy();
  assert.equal(policy.schema, "csm-orchestrate-egress-policy/1");
  assert.equal(policy.defaultAction, "deny");
  assert.deepEqual(policy.entries, []);
});

test("N2: a runtime constructs from only {enabled, workerSource} (no policy/forward/ledgerKey)", () => {
  const runtime = createVerifiedSandboxRuntime({
    enabled: true,
    workerSource: "process.stdin.resume()\n",
  });
  assert.equal(typeof runtime.invoke, "function");
  assert.equal(typeof runtime.effectiveIsolation, "function");
  assert.equal(runtime.effectiveIsolation().isolation, "verified-sandbox");
});

test("N2: the default HTTP forward performs the request", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(`ok:${req.url}`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const forward = createHttpForward();
    const result = await forward({
      target: { scheme: "http", host: "127.0.0.1", port, path: "/ping", method: "GET" },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body, "ok:/ping");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("N2: an enabled config with no worker/executor fails closed at resolve", () => {
  const runtime = resolveVerifiedSandboxRuntime({ enabled: true });
  assert.equal(typeof runtime.invoke, "function");
  assert.equal(runtime.effectiveIsolation().satisfiable, false);
  return assert.rejects(() => runtime.invoke({}), /verified-sandbox/);
});
