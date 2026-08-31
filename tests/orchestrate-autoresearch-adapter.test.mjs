import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCsmAutoresearchAdapter } from "../csm-orchestrate/lib/csm-autoresearch-adapter.mjs";
import {
  createExecutorDescriptors,
  createExecutorHandlers,
  executeSkill,
} from "../csm-orchestrate/lib/skill-executor-handlers.mjs";
import { sharedRunId } from "../csm-autoresearch/lib/artifacts/index.mjs";
import { hash } from "../csm-autoresearch/lib/ledger/index.mjs";
import { writeFile } from "node:fs/promises";

const limits = { timeoutMs: 1000, maxOutputBytes: 10000, maxWorkspaceBytes: 10000 };
const contractFor = (runId, mode = "registered") => ({
  format: "csm-autoresearch-contract/1",
  runId,
  source: { mode, id: "fixture", sourceHash: hash("fixture") },
  metric: { name: "score", unit: "points", direction: "maximize", aggregation: "max" },
  mutation: { mode: "diff", allowedPaths: ["src/target.mjs"], maxChangedBytes: 1000 },
  budget: { maxTrials: 2, maxProposals: 2, timeoutMs: 1000 },
  policy: {
    format: "csm-autoresearch-policy/1",
    mode: "hill-climb",
    hardGates: [{ id: "valid", kind: "valid" }],
    population: { enabled: false, activateAfterStagnantTrials: 2, maxArchive: 2 },
    execution: {
      network: "disabled",
      credentials: "none",
      evaluatorAssets: "isolated",
      isolation: mode === "generated" ? "verified-sandbox" : "trusted-in-process",
      limits,
    },
  },
});

function registeredProvider() {
  return {
    mode: "registered",
    trust: "trusted-in-process",
    evaluatorHash: hash("evaluator"),
    environmentHash: hash("environment"),
    async evaluate(request) {
      return {
        format: "csm-autoresearch-evaluator-response/1",
        requestId: request.requestId,
        runId: request.runId,
        status: "ok",
        valid: true,
        metrics: { score: 1 },
        diagnostics: [],
        provenance: {
          evaluatorHash: hash("evaluator"),
          environmentHash: hash("environment"),
          limits,
          redacted: true,
        },
      };
    },
  };
}

function context(native) {
  return { runId: sharedRunId(native), owner: "csm-autoresearch", attempt: 1 };
}

test("maps native autoresearch artifacts onto the orchestrator child lineage", async () => {
  const root = await mkdtemp(join(tmpdir(), "orchestrate-autoresearch-"));
  try {
    const native = "native-adapter-run";
    const adapter = createCsmAutoresearchAdapter({
      providers: { registered: registeredProvider() },
    });
    const result = await adapter.execute({
      context: context(native),
      input: { contract: contractFor(native), artifactRoot: root },
    });
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.equal(result.output.nativeRunId, native);
    assert.equal(result.output.sharedRunId, context(native).runId);
    assert.equal(result.output.sourceMode, "registered");
    assert.match(result.output.policyHash, /^sha256:/);
    assert.equal(result.artifacts.length, 3);
    for (const artifact of result.artifacts) {
      assert.equal(artifact.runId, context(native).runId);
      assert.equal(artifact.owner, "csm-autoresearch");
      assert.equal(artifact.nativeRunId, native);
      assert.equal(artifact.sourceRunId, context(native).runId);
      assert.ok(artifact.path);
    }
    assert.equal(result.output.manifest.nativeRunId, native);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("handler is injected, keeps evaluator ownership immutable, and exact descriptors are registered", async () => {
  const root = await mkdtemp(join(tmpdir(), "orchestrate-autoresearch-handler-"));
  const native = "immutable-adapter-run";
  try {
    const adapter = createCsmAutoresearchAdapter({
      providers: { registered: registeredProvider() },
    });
    const handlers = createExecutorHandlers({ csmAutoresearchAdapter: adapter });
    const descriptors = createExecutorDescriptors({ handlers, csmAutoresearchAdapter: adapter });
    assert.ok(descriptors.some((item) => item.skill === "csm-autoresearch"));
    const result = await executeSkill(
      "csm-autoresearch",
      {
        context: context(native),
        input: {
          contract: contractFor(native),
          artifactRoot: root,
          evaluate: () => ({ score: 999 }),
        },
      },
      { handlers, descriptor: descriptors.find((item) => item.skill === "csm-autoresearch") },
    );
    assert.equal(result.status, "failed");
    assert.match(result.failure.message, /evaluator callback must be host-injected/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generated mode remains blocked without a verified host sandbox", async () => {
  const native = "generated-adapter-run";
  let called = false;
  const adapter = createCsmAutoresearchAdapter({
    providers: {
      generated: {
        mode: "generated",
        sandboxProvider: "unverified",
        evaluate: async () => {
          called = true;
        },
      },
    },
  });
  await assert.rejects(
    adapter.execute({
      context: context(native),
      input: { contract: contractFor(native, "generated") },
    }),
    /host-attested/,
  );
  assert.equal(called, false);
});

test("cancellation before dispatch has no artifacts and promotion cannot bypass human approval", async () => {
  const native = "cancelled-adapter-run";
  const controller = new AbortController();
  controller.abort();
  const adapter = createCsmAutoresearchAdapter({ providers: { registered: registeredProvider() } });
  const result = await adapter.execute({
    context: context(native),
    signal: controller.signal,
    input: { contract: contractFor(native) },
  });
  assert.equal(result.status, "cancelled");
  assert.deepEqual(result.artifacts, []);
  await assert.rejects(adapter.promote({ approval: { approved: false } }), /human approval/);
});

test("adapter timeout after dispatch is durably classified by the shared invocation boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "orchestrate-autoresearch-timeout-"));
  const calls = [];
  const adapter = createCsmAutoresearchAdapter({
    providers: {
      registered: {
        ...registeredProvider(),
        async evaluate() {
          calls.push(true);
          await new Promise((resolve) => setTimeout(resolve, 20));
          return {
            status: "timed_out",
            valid: false,
            metrics: {},
            diagnostics: ["synthetic timeout"],
            provenance: {
              evaluatorHash: hash("evaluator"),
              environmentHash: hash("environment"),
              limits,
              redacted: true,
            },
          };
        },
      },
    },
  });
  const handlers = createExecutorHandlers({ csmAutoresearchAdapter: adapter });
  const descriptor = createExecutorDescriptors({ handlers, csmAutoresearchAdapter: adapter }).find(
    (item) => item.skill === "csm-autoresearch",
  );
  const native = "timeout-adapter-run";
  try {
    const result = await executeSkill(
      "csm-autoresearch",
      { context: context(native), input: { contract: contractFor(native), artifactRoot: root } },
      { handlers, descriptor },
    );
    assert.equal(calls.length, 1);
    assert.equal(result.status, "failed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("forged generated attestation and producer paths fail closed", async () => {
  const native = "forged-autoresearch-run";
  const provider = {
    ...registeredProvider(),
    mode: "generated",
    sandboxAttestation: { provider: "synthetic" },
    verifySandboxAttestation: () => false,
  };
  const adapter = createCsmAutoresearchAdapter({ providers: { generated: provider } });
  await assert.rejects(
    adapter.execute({
      context: context(native),
      input: { contract: contractFor(native, "generated") },
    }),
    /host-attested/,
  );

  const root = await mkdtemp(join(tmpdir(), "orchestrate-autoresearch-path-"));
  try {
    const outside = await mkdtemp(join(tmpdir(), "orchestrate-autoresearch-outside-"));
    const optimizeRun = async ({ contract }) => {
      const report = {
        format: "csm-autoresearch-report/1",
        runId: contract.runId,
        status: "completed",
        mode: "hill-climb",
        sourceMode: "registered",
        baseline: { metrics: {}, status: "ok" },
        trials: [],
        gates: { hardPassed: true, failed: [] },
        artifactRefs: [],
      };
      const paths = {
        ledger: join(root, "ledger.jsonl"),
        report: join(outside, "report.json"),
        manifest: join(root, "manifest.json"),
      };
      await writeFile(paths.ledger, "placeholder\n");
      await writeFile(paths.manifest, "{}");
      await writeFile(paths.report, JSON.stringify(report));
      return { report, manifest: {}, paths };
    };
    const pathAdapter = createCsmAutoresearchAdapter({
      providers: { registered: registeredProvider() },
      optimizeRun,
    });
    await assert.rejects(
      pathAdapter.execute({
        context: context(native),
        input: { contract: contractFor(native), artifactRoot: root },
      }),
      /contained/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
