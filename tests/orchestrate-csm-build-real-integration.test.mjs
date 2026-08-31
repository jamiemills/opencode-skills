import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { digest, parseJson } from "../lib/schema-runtime/index.mjs";
import { createCsmBuildCurrentContextCaller } from "../csm-build/lib/current-context.mjs";
import {
  createCsmBuildHandoff,
  csmBuildOwnedSkills,
} from "../csm-orchestrate/lib/csm-build-handoff.mjs";

const identity = {
  invocationId: "invocation-real-build",
  parentRunId: "run-real-parent",
  childRunId: "run-real-child",
  phaseId: "phase-real-build",
  edgeId: "edge-real-build",
  skill: "csm-plan",
};

const request = (input = {}) => ({
  ...identity,
  input,
  retry: { attempt: 1 },
});

function resolvedInputs(plan) {
  const values = Object.fromEntries(
    ["plan", "bdd", "tests", "ddd", "norms"].map((name) => [
      name,
      {
        status: "resolved",
        value: name === "plan" ? plan : { schema: `csm-${name}/1`, artifactId: `${name}-artifact` },
        digest: digest(name),
        path: `${name}.json`,
      },
    ]),
  );
  return {
    status: "resolved",
    inputs: Object.entries(values).map(([name, value]) => ({
      name,
      artifactId: value.value.artifactId,
      schema: value.value.schema,
      runId: `run-${name}`,
      owner: `csm-${name}`,
      digest: value.digest,
      path: value.path,
      status: "resolved",
    })),
    values,
  };
}

function nativeArtifact(root, overrides = {}) {
  const content = Buffer.from("native build artifact\n");
  const artifact = {
    schema: "csm-build-artifact/1",
    artifactId: "artifact-delivered",
    kind: "delivery",
    runId: identity.childRunId,
    owner: identity.skill,
    digest: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    path: "artifact.json",
    contentType: "application/json",
    lifecycleStatus: "completed",
    sourceArtifactIds: [],
    bytes: content.byteLength,
    ...overrides,
  };
  artifact.descriptorDigest = digest(
    Object.fromEntries(Object.entries(artifact).filter(([key]) => key !== "descriptorDigest")),
  );
  return { artifact, content };
}

test("registered current-context caller runs the real build lifecycle through the orchestrator handoff", async () => {
  const registry = parseJson(
    await readFile(new URL("../schemas/registry.json", import.meta.url), "utf8"),
  );
  const outputEntry = registry.entries.find((entry) => entry.id === "csm-build-output/1");
  assert.equal(outputEntry?.schemaPath, "csm-build/schemas/output.schema.json");
  assert.equal(
    outputEntry?.schemaContentDigest,
    digest(
      parseJson(
        await readFile(new URL("../csm-build/schemas/output.schema.json", import.meta.url), "utf8"),
      ),
    ),
  );
  const root = await mkdtemp(join(tmpdir(), "csm-build-real-"));
  try {
    const plan = {
      schema: "csm-plan/1",
      artifactId: "art-plan-real",
      digest: digest({ plan: true }),
    };
    let received;
    const caller = createCsmBuildCurrentContextCaller({
      root,
      resolveInputs: async () => resolvedInputs(plan),
      execute: async (context) => {
        received = context;
        await writeFile(join(root, "workspace-effect.txt"), "current-context");
        const delivered = nativeArtifact(root);
        await writeFile(join(root, delivered.artifact.path), delivered.content);
        return {
          output: { verified: true },
          effects: ["workspace-write"],
          artifacts: [delivered.artifact],
          evidence: [],
        };
      },
    });
    const handoff = createCsmBuildHandoff({ skill: identity.skill, execute: caller.execute });
    const result = await handoff.execute(request({ plan, bdd: {}, tests: {}, ddd: {}, norms: {} }));
    assert.equal(result.schema, "csm-build-output/1");
    assert.equal(result.status, "completed");
    assert.equal(result.requestIdentity.childRunId, identity.childRunId);
    assert.equal(result.state.control.currentState, "COMPLETE");
    assert.deepEqual(
      result.delivery.inputDigests,
      Object.values(resolvedInputs(plan).values).map((value) => value.digest),
    );
    assert.equal(result.artifacts[0].runId, identity.childRunId);
    assert.equal(result.artifacts[0].owner, identity.skill);
    assert.equal(result.artifacts[0].nativeArtifactId, "artifact-delivered");
    assert.equal(result.artifacts[0].nativeRunId, identity.childRunId);
    assert.notEqual(result.artifacts[0].artifactId, "artifact-delivered");
    assert.equal(received.identity.digest, digest(identity));
    assert.equal(received.inputs.plan.value, plan);
    assert.equal(await readFile(join(root, "workspace-effect.txt"), "utf8"), "current-context");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cancellation, malformed delivery, and execution crashes fail closed", async () => {
  const plan = {
    schema: "csm-plan/1",
    artifactId: "art-plan-real",
    digest: digest({ plan: true }),
  };
  const options = { resolveInputs: async () => resolvedInputs(plan) };
  const caller = createCsmBuildCurrentContextCaller({ ...options, execute: async () => null });
  const controller = new AbortController();
  controller.abort();
  assert.equal((await caller.execute(request(), controller.signal)).failure.code, "cancelled");
  assert.equal((await caller.execute(request(), undefined)).failure.code, "malformed-delivery");
  const crashed = createCsmBuildCurrentContextCaller({
    ...options,
    execute: async () => {
      throw new Error("crash after write");
    },
  });
  const result = await crashed.execute(request());
  assert.equal(result.status, "failed");
  assert.equal(result.failure.code, "current-context-failed");
  assert.notEqual(result.state.control.currentState, "COMPLETE");
});

test("forged native build identity, descriptor, content, and path are rejected before wrapping", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-build-forged-"));
  const plan = {
    schema: "csm-plan/1",
    artifactId: "art-plan-real",
    digest: digest({ plan: true }),
  };
  try {
    for (const overrides of [
      { owner: "forged-owner" },
      { runId: "run-forged-child" },
      { descriptorDigest: digest({ forged: true }) },
      { digest: digest("forged content") },
      { path: "../outside.json" },
    ]) {
      const delivered = nativeArtifact(root, overrides);
      if (Object.hasOwn(overrides, "descriptorDigest"))
        delivered.artifact.descriptorDigest = overrides.descriptorDigest;
      await writeFile(join(root, "artifact.json"), delivered.content);
      const caller = createCsmBuildCurrentContextCaller({
        root,
        resolveInputs: async () => resolvedInputs(plan),
        execute: async () => ({ artifacts: [delivered.artifact] }),
      });
      const result = await caller.execute(request());
      assert.equal(result.status, "failed", JSON.stringify(overrides));
      assert.equal(result.failure.code, "malformed-delivery");
      assert.deepEqual(result.artifacts, []);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("all capability routes have one explicit owner classification", async () => {
  const owned = new Set(csmBuildOwnedSkills());
  const routes = ["csm-ddd", "csm-scan", "csm-upload", ...owned, "csm-browse", "csm-autoresearch"];
  assert.equal(new Set(routes).size, 13);
  assert.equal(routes.filter((skill) => owned.has(skill)).length, 8);
  assert.deepEqual(
    routes.filter((skill) => !owned.has(skill)),
    ["csm-ddd", "csm-scan", "csm-upload", "csm-browse", "csm-autoresearch"],
  );
});
