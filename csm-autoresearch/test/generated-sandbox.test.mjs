"use strict";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  createGeneratedProvider,
  createHostSandboxCapability,
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
      networkIsolation: true,
      mountIsolation: true,
      credentialIsolation: true,
      resourceLimits: true,
      processContainment: true,
      descendantContainment: true,
      sourceHashBinding: true,
      cleanupVerification: true,
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
  assert.equal(result.controls.descendantContainment, false);
});

test("sandbox probe names missing host-attested controls", () => {
  const missingControlCapability = createHostSandboxCapability({
    attest: () => ({
      provider: "synthetic",
      limits: ["timeoutMs", "maxOutputBytes", "maxWorkspaceBytes"],
      network: "disabled",
      mounts: [],
      evaluatorAssets: "isolated",
      credentials: "none",
    }),
    verifyLimits: () => true,
    verifyCleanup: () => true,
  });
  const result = probeSandbox({
    provider: { name: "synthetic", capability: missingControlCapability, execute() {} },
  });
  assert.equal(result.status, "sandbox_unavailable");
  assert.match(result.diagnostics.join(" "), /networkIsolation/);
  assert.equal(result.controls.networkIsolation, false);
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

test("generated execution rejects forged or incomplete attestation evidence", async () => {
  const source = "export default () => ({ score: 1 })";
  const cleanup = Symbol("cleanup");
  const hostCapability = createHostSandboxCapability(capability(cleanup));
  const provider = createGeneratedProvider({
    sandbox: {
      name: "synthetic",
      capability: hostCapability,
      execute: async () => ({
        status: "ok",
        metrics: { score: 1 },
        cleanup: { token: cleanup },
        attestation: {
          status: "verified",
          policyDigest: hash("forged-policy"),
          imageDigest: hash("forged-image"),
          sourceHash: hash(source),
          controls: {},
        },
      }),
    },
    hostCapability,
    sandboxProvider: "synthetic",
    evaluatorHash: hash("evaluator"),
    environmentHash: hash("environment"),
    limits,
    approval,
  });
  assert.equal((await provider.evaluate(request(source))).status, "blocked");
});

test("generated execution rejects a successful result without attestation", async () => {
  const source = "export default () => ({ score: 1 })";
  const cleanup = Symbol("cleanup");
  const hostCapability = createHostSandboxCapability(capability(cleanup));
  const provider = createGeneratedProvider({
    sandbox: {
      name: "synthetic",
      capability: hostCapability,
      execute: async () => ({ status: "ok", metrics: { score: 1 }, cleanup: { token: cleanup } }),
    },
    hostCapability,
    sandboxProvider: "synthetic",
    evaluatorHash: hash("evaluator"),
    environmentHash: hash("environment"),
    limits,
    approval,
  });
  assert.equal((await provider.evaluate(request(source))).status, "blocked");
});

test("Docker policy and attestation schemas freeze the host boundary", async () => {
  const policy = JSON.parse(
    await readFile(
      new URL("../schemas/docker-sandbox-policy.schema.json", import.meta.url),
      "utf8",
    ),
  );
  const attestation = JSON.parse(
    await readFile(
      new URL("../schemas/docker-sandbox-attestation.schema.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(policy.additionalProperties, false);
  assert.equal(policy.properties.image.properties.digest.pattern, "^sha256:[0-9a-f]{64}$");
  assert.deepEqual(policy.properties.mounts.const, []);
  assert.equal(policy.properties.network.const, "none");
  assert.equal(policy.properties.rootFilesystem.const, "read-only");
  assert.deepEqual(policy.properties.security.properties.capDrop.const, ["ALL"]);
  assert.equal(policy.properties.security.properties.noNewPrivileges.const, true);
  assert.equal(policy.properties.security.properties.dockerSocket.const, false);
  assert.deepEqual(policy.properties.environment.properties.allowlist.const, []);
  assert.deepEqual(attestation.properties.cleanup.properties.status.enum, [
    "verified",
    "unknown",
    "failed",
  ]);
  assert.ok(attestation.properties.controls.required.includes("descendantContainment"));
  assert.ok(attestation.properties.controls.required.includes("sourceHashBinding"));
  assert.ok(attestation.properties.controls.required.includes("cleanupVerification"));
  assert.equal(attestation.$defs.inspect.properties.network.const, "none");
  assert.deepEqual(attestation.$defs.inspect.properties.mounts.const, []);
  assert.equal(attestation.$defs.inspect.properties.dockerSocket.const, false);
  assert.deepEqual(attestation.$defs.inspect.properties.limits.required, [
    "cpuQuotaUs",
    "memoryBytes",
    "pids",
    "maxOutputBytes",
    "timeoutMs",
    "workspaceBytes",
  ]);
});
