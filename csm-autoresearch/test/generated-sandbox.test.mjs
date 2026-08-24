"use strict";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  createGeneratedProvider,
  hash,
  policyChecks,
  probeSandbox,
} from "../lib/providers/generated.mjs";

const approval = { status: "approved", approver: "synthetic-test", reason: "containment fixture" };
const limits = { timeoutMs: 1000, maxOutputBytes: 10000, maxWorkspaceBytes: 10000 };
const request = (source) => ({
  format: "csm-autoresearch-evaluator-request/1",
  requestId: "synthetic-request",
  runId: "synthetic-run",
  candidate: {
    id: "synthetic",
    parentId: null,
    sourceHash: hash(source),
    patchHash: hash("synthetic-patch"),
  },
  limits: {
    timeoutMs: limits.timeoutMs,
    maxOutputBytes: limits.maxOutputBytes,
    network: "disabled",
  },
  input: { source, value: 2 },
});
const capability = (token = Symbol("cleanup")) =>
  Object.freeze({
    attest: ({ provider, limits: declared, network, mounts, evaluatorAssets, credentials }) => ({
      provider,
      limits: Object.keys(declared),
      network,
      mounts,
      evaluatorAssets,
      credentials,
    }),
    verifyLimits: (evidence, declared) =>
      Object.keys(declared).every((key) => evidence.limits.includes(key)),
    verifyCleanup: (result) => result.cleanup?.token === token,
  });

test("sandbox probe fails closed without verified capability", () => {
  const result = probeSandbox();
  assert.equal(result.status, "sandbox_unavailable");
  assert.equal(result.verified, false);
  assert.match(result.diagnostics.join(" "), /sandbox provider/);
});

test("generated provider returns sandbox_unavailable before candidate execution", async () => {
  let executed = false;
  const source = await readFile(
    new URL("./fixtures/generated-candidate.mjs", import.meta.url),
    "utf8",
  );
  const provider = createGeneratedProvider({
    sandbox: {
      verified: false,
      execute: async () => {
        executed = true;
      },
    },
    evaluatorHash: hash("evaluator"),
    environmentHash: hash("environment"),
    limits,
    cleanup: { supported: true, verifiable: true },
    approval,
  });
  const result = await provider.evaluate(request(source));
  assert.equal(result.status, "sandbox_unavailable");
  assert.equal(executed, false);
});

test("generated provider rejects self-attested sandbox metadata", async () => {
  let executed = false;
  const provider = createGeneratedProvider({
    sandbox: {
      name: "synthetic",
      verified: true,
      execute: async () => {
        executed = true;
      },
    },
    sandboxProvider: "synthetic",
    evaluatorHash: hash("evaluator"),
    environmentHash: hash("environment"),
    limits,
    cleanup: { supported: true, verifiable: true, verified: true },
    approval,
  });
  const result = await provider.evaluate(request("export default () => ({ score: 1 })"));
  assert.equal(result.status, "sandbox_unavailable");
  assert.equal(executed, false);
});

test("generated provider requires a non-forgeable host capability before execution", async () => {
  const source = "export default () => ({ score: 1 })";
  const token = Symbol("cleanup");
  const hostCapability = capability(token);
  const provider = createGeneratedProvider({
    sandbox: {
      name: "synthetic",
      capability: hostCapability,
      execute: async () => ({ status: "ok", metrics: { score: 1 }, cleanup: { token } }),
    },
    hostCapability,
    sandboxProvider: "synthetic",
    evaluatorHash: hash("evaluator"),
    environmentHash: hash("environment"),
    limits,
    approval,
  });
  assert.equal((await provider.evaluate(request(source))).status, "sandbox_unavailable");
  const unverifiedCleanup = createGeneratedProvider({
    sandbox: {
      name: "synthetic",
      capability: hostCapability,
      execute: async () => ({ status: "ok", metrics: { score: 1 }, cleanup: { verified: true } }),
    },
    hostCapability,
    sandboxProvider: "synthetic",
    evaluatorHash: hash("evaluator"),
    environmentHash: hash("environment"),
    limits,
    approval,
  });
  assert.equal((await unverifiedCleanup.evaluate(request(source))).status, "sandbox_unavailable");
});

test("policy rejects network, mounts, assets, credentials, limits, and cleanup gaps", () => {
  const diagnostics = policyChecks({
    sandbox: { verified: true, execute() {} },
    network: "enabled",
    mounts: ["/tmp"],
    evaluatorAssets: "shared",
    credentials: "present",
    limits: {},
    cleanup: { supported: false, verifiable: false },
  });
  assert.equal(diagnostics.length, 6);
  assert.match(diagnostics.join(" "), /network|mounts|assets|credentials|limits|cleanup/);
});

test("generated mode rejects optional limits without matching enforcement evidence", async () => {
  const hostCapability = Object.freeze({ ...capability(), verifyLimits: () => false });
  const provider = createGeneratedProvider({
    sandbox: { name: "synthetic", capability: hostCapability, execute() {} },
    hostCapability,
    sandboxProvider: "synthetic",
    evaluatorHash: hash("evaluator"),
    environmentHash: hash("environment"),
    limits: { ...limits, maxMemoryMb: 32 },
    approval,
  });
  const result = await provider.evaluate(request("export default () => ({ score: 1 })"));
  assert.equal(result.status, "sandbox_unavailable");
});

test("caller-supplied verification arrays and cleanup claims cannot enable execution", async () => {
  let executed = false;
  const provider = createGeneratedProvider({
    sandbox: {
      name: "synthetic",
      execute: async () => {
        executed = true;
      },
    },
    sandboxProvider: "synthetic",
    allowlistedProviders: ["synthetic"],
    verifiedProviders: ["synthetic"],
    enforcedLimits: ["timeoutMs", "maxOutputBytes", "maxWorkspaceBytes", "network"],
    cleanupVerified: true,
    evaluatorHash: hash("evaluator"),
    environmentHash: hash("environment"),
    limits,
    approval,
  });
  assert.equal(
    (await provider.evaluate(request("export default () => ({ score: 1 })"))).status,
    "sandbox_unavailable",
  );
  assert.equal(executed, false);
});
