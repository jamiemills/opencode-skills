import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACTION_SHA = /^[0-9a-f]{40}$/;

function readPolicy() {
  return {
    workflow: fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8"),
    nodeVersion: fs.readFileSync(path.join(ROOT, ".node-version"), "utf8").trim(),
    manifest: JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")),
    lockfile: fs.readFileSync(path.join(ROOT, "pnpm-lock.yaml"), "utf8"),
  };
}

function policyIssues(policy) {
  const issues = [];
  const actionUses = [...policy.workflow.matchAll(/uses:\s+([^\s#]+)/g)].map((match) => match[1]);
  for (const action of actionUses) {
    const [, sha] = action.split("@");
    if (!sha || !ACTION_SHA.test(sha)) issues.push(`action is not pinned by full SHA: ${action}`);
  }
  if (policy.nodeVersion !== "22.23.2")
    issues.push("Node version is not the approved Node 22 patch");
  if (policy.manifest.devDependencies?.oxfmt !== "0.64.0") {
    issues.push("oxfmt must be exact-pinned to the lock-resolved version");
  }
  if (policy.manifest.packageManager !== "pnpm@10.34.5") {
    issues.push("packageManager must exact-pin pnpm@10.34.5");
  }
  if (!policy.lockfile.includes("oxfmt:\n        specifier: 0.64.0")) {
    issues.push("lockfile oxfmt specifier must match package.json");
  }
  if (!policy.workflow.includes("node-version-file: .node-version")) {
    issues.push("CI must consume the repository Node version file");
  }
  if (!policy.workflow.includes("corepack install --global pnpm@10.34.5")) {
    issues.push("CI must install the pinned pnpm version through Corepack");
  }
  if (!policy.workflow.includes("COREPACK_DEFAULT_TO_LATEST: 0")) {
    issues.push("CI must disable Corepack latest-version resolution");
  }
  return issues;
}

test("repository toolchain policy is immutable", () => {
  assert.deepEqual(policyIssues(readPolicy()), []);
});

test("toolchain policy rejects floating actions and version ranges", () => {
  const policy = readPolicy();
  const floating = {
    ...policy,
    workflow: policy.workflow.replace(/actions\/checkout@[0-9a-f]{40}/g, "actions/checkout@v4"),
    manifest: {
      ...policy.manifest,
      devDependencies: { ...policy.manifest.devDependencies, oxfmt: "^0.64.0" },
    },
  };
  const issues = policyIssues(floating);
  assert.ok(issues.some((issue) => issue.includes("full SHA")));
  assert.ok(issues.some((issue) => issue.includes("oxfmt")));
});
