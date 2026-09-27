import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyCiGreen, verifyCompletion, verifyGitClean } from "../scripts/verify-completion.mjs";

const plan = { schema: "csm-plan/1", planId: "p1", tasks: [{ taskId: "T001" }, { ordinal: 2 }] };
const base = () => ({
  schema: "csm-completion-verdict/1",
  schemaRevision: 1,
  planId: "p1",
  verdict: "complete",
  reviewers: [
    { id: "r1", verdict: "complete", evidence: "ran the battery" },
    { id: "r2", verdict: "complete", evidence: "re-ran the signal" },
  ],
  tasks: [
    { id: "T001", verdict: "complete", evidence: "committed" },
    { id: "2", verdict: "blocked-deps", evidence: "dep blocked" },
  ],
});

test("a complete multi-reviewer verdict with per-task evidence passes", () => {
  assert.deepEqual(verifyCompletion({ plan, verdict: base() }), {
    schema: "csm-completion-verdict/1",
    ok: true,
    reason: "ok",
    tasks: 2,
  });
});

test("an invalid verdict shape is refused by the schema", () => {
  const v = base();
  v.reviewers = [{ id: "r1", verdict: "complete", evidence: "x" }];
  assert.equal(verifyCompletion({ plan, verdict: v }).ok, false);
});

test("fewer than two independent reviewers is refused", () => {
  const v = base();
  v.reviewers = [
    { id: "same", verdict: "complete", evidence: "a" },
    { id: "same", verdict: "complete", evidence: "b" },
  ];
  assert.equal(verifyCompletion({ plan, verdict: v }).reason, "reviewers-not-independent");
});

test("a non-complete reviewer or verdict is refused", () => {
  const a = base();
  a.reviewers[1].verdict = "incomplete";
  assert.equal(verifyCompletion({ plan, verdict: a }).reason, "reviewer-incomplete");
  const b = base();
  b.verdict = "incomplete";
  assert.equal(verifyCompletion({ plan, verdict: b }).reason, "verdict-incomplete");
});

test("a plan task with no terminal verdict is refused", () => {
  const v = base();
  v.tasks = [{ id: "T001", verdict: "complete", evidence: "committed" }];
  const result = verifyCompletion({ plan, verdict: v });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["2"]);
});

test("a complete task with empty evidence is refused", () => {
  const v = base();
  v.tasks[0] = { id: "T001", verdict: "complete", evidence: "  " };
  assert.deepEqual(verifyCompletion({ plan, verdict: v }).missing, ["T001(no-evidence)"]);
});

test("plan/verdict id mismatch is refused", () => {
  const v = base();
  v.planId = "other";
  assert.equal(verifyCompletion({ plan, verdict: v }).reason, "plan-id-mismatch");
});

test("git-clean passes on an empty porcelain and fails when dirty", () => {
  const clean = verifyGitClean({ run: () => ({ status: 0, stdout: "" }) });
  assert.equal(clean.ok, true);
  const dirty = verifyGitClean({ run: () => ({ status: 0, stdout: " M scripts/x.mjs\n" }) });
  assert.equal(dirty.reason, "git-dirty");
  assert.equal(
    verifyGitClean({ run: () => ({ status: 1, stdout: "" }) }).reason,
    "git-unavailable",
  );
});

test("ci-green resolves HEAD and requires a completed success run for the sha", () => {
  const green = verifyCiGreen({
    sha: "HEAD",
    run: (cmd, _args) => {
      if (cmd === "git") return { status: 0, stdout: "abc123def\n" };
      return {
        status: 0,
        stdout: JSON.stringify([
          { headSha: "abc123def", status: "completed", conclusion: "success" },
          { headSha: "old", status: "completed", conclusion: "failure" },
        ]),
      };
    },
  });
  assert.equal(green.ok, true);
  const notGreen = verifyCiGreen({
    sha: "abc123def",
    run: (cmd) =>
      cmd === "gh"
        ? {
            status: 0,
            stdout: JSON.stringify([
              { headSha: "abc123def", status: "in_progress", conclusion: "" },
            ]),
          }
        : { status: 0, stdout: "abc123def\n" },
  });
  assert.equal(notGreen.reason, "ci-not-green");
  const unavailable = verifyCiGreen({ sha: "abc", run: () => ({ status: 1, stdout: "" }) });
  assert.equal(unavailable.reason, "ci-unavailable");
});
