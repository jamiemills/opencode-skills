import { test } from "node:test";
import assert from "node:assert/strict";

import { analyzeCommitStyle, scan } from "../lib/scan/deep/git.mjs";
import { makeGitRepo, cleanupGitRepo, runGit } from "./helpers/git-fixture.mjs";

test("empty log yields unknown", () => {
  assert.equal(analyzeCommitStyle([]), "unknown");
});

test("whitespace-only log yields unknown", () => {
  assert.equal(analyzeCommitStyle(["", "\t", "   "]), "unknown");
});

test("conventional subjects report a conventional-dominant split with counts", () => {
  const subjects = [
    "a1b2c3d feat: add thing",
    "e4f5a6b fix: repair bug",
    "docs: update readme",
    "refactor(api): tidy handler",
    "chore: bump deps",
    "ci: run gate",
  ];
  assert.equal(
    analyzeCommitStyle(subjects),
    "Conventional-style prefixes dominate: 6 of 6 commits (chore 1, ci 1, docs 1, feat 1, fix 1, refactor 1); task-identified prefixes 0",
  );
});

test("legacy conventional subjects mentioning task words stay conventional", () => {
  const subjects = [
    "feat: add plan for T007 work",
    "fix: repair csm-scan path",
    "docs: explain CSM loop",
  ];
  assert.equal(
    analyzeCommitStyle(subjects),
    "Conventional-style prefixes dominate: 3 of 3 commits (docs 1, feat 1, fix 1); task-identified prefixes 0",
  );
});

test("task-identifier prefixes report a task-dominant split per bucket", () => {
  const expectations = [
    ["T005: work item", "T### 1"],
    ["T005-topic: work item", "T### 1"],
    ["P2C: work item", "P# 1"],
    ["CSM: work item", "CSM 1"],
    ["CSM plan: work item", "CSM 1"],
    ["REPAIR: work item", "REPAIR 1"],
    ["plan: work item", "plan 1"],
    ["csm-scan: work item", "csm-scan 1"],
    ["csm-browse: work item", "csm-browse 1"],
  ];
  for (const [prefix, bucketCount] of expectations) {
    assert.equal(
      analyzeCommitStyle([`${prefix} work item`]),
      `Task-identified prefixes dominate: 1 of 1 commits (${bucketCount}); conventional-style prefixes 0`,
      `expected ${prefix} to be task-identified`,
    );
  }
});

test("task-identifier mixed-case prefixes classify into lowercase buckets", () => {
  assert.equal(
    analyzeCommitStyle(["Plan: amend dimension", "Csm-Scan: extend vocab"]),
    "Task-identified prefixes dominate: 2 of 2 commits (csm-scan 1, plan 1); conventional-style prefixes 0",
  );
});

test("task-prefixed log keeps the task label when it dominates", () => {
  const subjects = ["T005: extend vocabulary", "T007: write unit test", "P2C: activate pipeline"];
  assert.equal(
    analyzeCommitStyle(subjects),
    "Task-identified prefixes dominate: 3 of 3 commits (T### 2, P# 1); conventional-style prefixes 0",
  );
});

test("hybrid of conventional and task styles yields a balanced split", () => {
  const subjects = ["feat: a", "fix: b", "T005: c", "T007: d", "plain-ish", "free text"];
  assert.equal(
    analyzeCommitStyle(subjects),
    "Conventional-style and task-identified prefixes balanced: 2 of 6 commits (feat 1, fix 1); task-identified prefixes 2 (T### 2)",
  );
});

test("plain subjects report no conventional or task prefixes", () => {
  const subjects = ["just a change", "another plain subject", "so free-form", "no colon here"];
  assert.equal(
    analyzeCommitStyle(subjects),
    "No conventional-style or task-identified prefixes: 4 commits (plain 4)",
  );
});

test("F3-09 discloses foreign ticket prefixes as generic tickets", () => {
  assert.equal(
    analyzeCommitStyle(["ABC-123: ship change"]),
    "Task-identified prefixes dominate: 1 of 1 commits (ticket 1); conventional-style prefixes 0",
  );
});

test("emoji subjects report no conventional or task prefixes", () => {
  assert.equal(
    analyzeCommitStyle(["✨ sparkles", "🔥 hot", "✨ more"]),
    "No conventional-style or task-identified prefixes: 3 commits (emoji 3)",
  );
});

test("semantic-like prefixes report no conventional or task prefixes", () => {
  assert.equal(
    analyzeCommitStyle(["FIX: uppercase type", "FEAT: mixed case", "REVERT: uppercase"]),
    "No conventional-style or task-identified prefixes: 3 commits (semantic 3)",
  );
});

test("split facts are deterministic for equal multisets in any input order", () => {
  const entries = [
    "feat: a",
    "feat: b",
    "fix: c",
    "T005: d",
    "T007: e",
    "P2C: f",
    "plain-ish",
    "free text",
  ];
  const first = analyzeCommitStyle(entries);
  const shuffled = analyzeCommitStyle([...entries].toReversed());
  assert.equal(first, shuffled, "reversing input order must not change the split fact");
});

test("emitted facts are aggregate-only and never carry raw subjects", () => {
  const subjects = ["T007: implement classifier", "feat: add thing", "plan: freeze output"];
  const label = analyzeCommitStyle(subjects);
  for (const subject of subjects) {
    assert.ok(!label.includes(subject), `label must not leak raw subject: ${label}`);
  }
  assert.ok(!label.includes("T007"), "label must not leak the task identifier");
});

const commitFiles = (index) => ({ [`docs/note-${index}.txt`]: `content ${index}\n` });

test("git fixture with 200+ conventional-dominant commits reports the split over the -200 window", async () => {
  const commits = [];
  for (let index = 0; index < 40; index++) {
    commits.push({ message: `fix: legacy fix ${index}`, files: commitFiles(index) });
  }
  for (let index = 0; index < 90; index++) {
    commits.push({ message: `feat: add feature ${index}`, files: commitFiles(index + 40) });
  }
  for (let index = 0; index < 60; index++) {
    commits.push({ message: `fix: repair bug ${index}`, files: commitFiles(index + 130) });
  }
  for (let index = 0; index < 30; index++) {
    commits.push({ message: `docs: update guide ${index}`, files: commitFiles(index + 190) });
  }
  for (let index = 0; index < 8; index++) {
    commits.push({ message: `CSM: run loop ${index}`, files: commitFiles(index + 220) });
  }
  for (let index = 0; index < 6; index++) {
    commits.push({ message: `P2C: drive pipeline ${index}`, files: commitFiles(index + 228) });
  }
  for (let index = 0; index < 6; index++) {
    commits.push({ message: `T007: tighten gate ${index}`, files: commitFiles(index + 234) });
  }

  const dir = makeGitRepo({ files: { "readme.md": "fixture\n" }, commits });
  try {
    const result = await scan(dir, {});
    assert.ok(result.findings.isGit, "fixture must be a git repository");
    assert.equal(
      result.findings.commitStyle,
      "Conventional-style prefixes dominate: 180 of 200 commits (feat 90, fix 60, docs 30); task-identified prefixes 20 (CSM 8, P# 6, T### 6)",
    );
  } finally {
    cleanupGitRepo(dir);
  }
});

test("git fixture with remediation branches reports the remediation depth structure without identities", async () => {
  const dir = makeGitRepo({
    files: { "readme.md": "fixture\n" },
    commits: ["feat: initial scaffold"],
  });
  try {
    runGit(dir, ["branch", "remediation/2026-08-01/PROJ-123/attempt-1"]);
    runGit(dir, ["branch", "remediation/2026-07-15/SVC-9/attempt-2"]);
    runGit(dir, ["branch", "feature/user-auth"]);

    const result = await scan(dir, {});
    assert.ok(
      result.findings.branchPattern.includes("remediation/<date>/<id>/attempt-N"),
      `branch fact must report the remediation structure: ${result.findings.branchPattern}`,
    );
    assert.ok(
      result.findings.branchPattern.includes("feature/*"),
      `branch fact must keep sibling prefixes: ${result.findings.branchPattern}`,
    );
    assert.ok(!result.findings.branchPattern.includes("PROJ-123"), "must not leak a branch id");
    assert.ok(!result.findings.branchPattern.includes("SVC-9"), "must not leak a branch id");
    assert.ok(!result.findings.branchPattern.includes("2026-08-01"), "must not leak a branch date");
    assert.ok(
      !result.findings.branchPattern.includes("attempt-1"),
      "must not leak an attempt number",
    );
  } finally {
    cleanupGitRepo(dir);
  }
});

test("F3-01 excludes the remote HEAD symref from branch facts", async () => {
  const dir = makeGitRepo({ files: { "readme.md": "fixture\n" }, commits: ["feat: initial"] });
  try {
    const result = await scan(
      dir,
      {},
      {
        async execute(id) {
          const stdout =
            {
              "git:log-oneline-200": "abc1234 feat: initial\n",
              "git:branch-list":
                "* main\n  remotes/origin/HEAD -> origin/main\n  remotes/origin/feature/demo\n",
              "git:symbolic-ref-origin-head": "refs/remotes/origin/main\n",
              "git:rev-parse-abbrev-head": "main\n",
              "git:config-remote-origin-url": "https://example.test/repo.git\n",
              "git:shortlog-summary": "  1\tAuthor\n",
            }[id] ?? "";
          return { ok: true, stdout, stderr: "" };
        },
      },
    );
    assert.equal(result.findings.branchPattern, "feature/*");
  } finally {
    cleanupGitRepo(dir);
  }
});
