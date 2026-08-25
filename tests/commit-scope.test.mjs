import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const SKILLS = ["csm-bdd-tdd", "csm-grill", "csm-plan", "csm-build"];

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "commit-scope-"));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  git(root, ["config", "user.name", "commit-scope-test"]);
  fs.writeFileSync(path.join(root, "seed.txt"), "seed\n");
  git(root, ["add", "seed.txt"]);
  git(root, ["commit", "-q", "-m", "seed"]);
  return root;
}

function authorizedCommit({ authorized, root, ownedPaths, runGit = git }) {
  if (!authorized) return { attempted: false };
  const stagedBefore = runGit(root, ["diff", "--cached", "--name-only"])
    .split("\n")
    .filter(Boolean);
  const unexpected = stagedBefore.filter((file) => !ownedPaths.includes(file));
  assert.deepEqual(unexpected, ["unrelated.txt"], "fixture must contain unrelated staged work");
  runGit(root, ["commit", "--only", "-m", "synthetic owned commit", "--", ...ownedPaths]);
  return { attempted: true };
}

test("all committing skills require explicit authorization and path-scoped commits", () => {
  for (const skill of SKILLS) {
    const content = fs.readFileSync(path.join(ROOT, skill, "SKILL.md"), "utf8");
    assert.match(
      content,
      /explicit(?:ly)? authori[sz]e/,
      `${skill}: explicit authorization wording`,
    );
    assert.match(
      content,
      /(?:otherwise|without authorization),? do not invoke Git commit/i,
      `${skill}: unauthorized refusal`,
    );
    assert.match(content, /git commit --only -- <[^>]+>/, `${skill}: path-scoped command`);
    assert.match(
      content,
      /unrelated staged (?:paths|work)/i,
      `${skill}: unrelated staging protection`,
    );
    assert.doesNotMatch(content, /Unless the user explicitly requested no commit/);
  }
});

test("unauthorized commit is not attempted", () => {
  const calls = [];
  const result = authorizedCommit({
    authorized: false,
    root: "/synthetic-repo",
    ownedPaths: ["owned.txt"],
    runGit: (...args) => calls.push(args),
  });
  assert.deepEqual(result, { attempted: false });
  assert.deepEqual(calls, []);
});

test("authorized path-scoped commit excludes unrelated staged paths", () => {
  const root = makeRepo();
  try {
    fs.writeFileSync(path.join(root, "owned.txt"), "owned\n");
    fs.writeFileSync(path.join(root, "unrelated.txt"), "user change\n");
    git(root, ["add", "owned.txt", "unrelated.txt"]);

    const result = authorizedCommit({ authorized: true, root, ownedPaths: ["owned.txt"] });
    assert.deepEqual(result, { attempted: true });
    assert.deepEqual(
      git(root, ["show", "--format=", "--name-only", "HEAD"]).split("\n").filter(Boolean),
      ["owned.txt"],
    );
    assert.equal(git(root, ["diff", "--cached", "--name-only"]), "unrelated.txt");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
