"use strict";

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { extractRepository } from "../lib/ddd/extract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRepo = join(here, "fixtures", "repos", "sample-repo");

function runGit(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", cwd, ...args], { shell: false }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${error.message}: ${stderr}`));
      else resolve(stdout);
    });
  });
}

async function makeGitFixture() {
  const root = mkdtempSync(join(tmpdir(), "csm-ddd-git-"));
  const commit = async (files) => {
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(join(root, name, ".."), { recursive: true });
      writeFileSync(join(root, name), content);
    }
    await runGit(root, ["add", "."]);
    await runGit(root, [
      "-c",
      "user.name=Dev One",
      "-c",
      "user.email=dev1@example.com",
      "commit",
      "-m",
      "wip",
    ]);
  };
  await runGit(root, ["init"]);
  await commit({ "src/a.mjs": "export const a = 1;\n" });
  await commit({ "src/b.mjs": "export const b = 2;\n" });
  await commit({ "src/a.mjs": "export const a = 3;\n", "src/b.mjs": "export const b = 4;\n" });
  return root;
}

test("static extraction reports observed statuses on the sample fixture", async () => {
  const result = await extractRepository({ root: fixtureRepo });
  assert.equal(result.caps.truncatedByFiles, false);
  assert.equal(result.caps.truncatedByBytes, false);
  const inventoryClaim = result.claims.find((c) => c.subject === "repository-inventory");
  assert.equal(inventoryClaim.status, "observed");
  const names = result.inventory.declarations.map((d) => d.name);
  assert.ok(names.includes("planWork"));
  assert.ok(names.includes("scan"));
  assert.ok(result.inventory.commands.some((cmd) => cmd.name === "plan"));
  assert.ok(result.inventory.events.some((e) => e.key === "work.planned"));
  assert.ok(result.inventory.consumers.some((c) => c.key === "../planning/index.mjs"));
  assert.ok(result.inventory.ownershipHints.some((o) => o.owners === 2));
  assert.equal(result.norms.loaded, true);
  assert.equal(result.norms.authentic, true);
});

test("redaction keeps planted secrets, emails, and absolute paths out of artifacts", async () => {
  const result = await extractRepository({ root: fixtureRepo });
  const serialized = JSON.stringify({
    claims: result.claims,
    evidence: result.evidence,
    inventory: result.inventory,
  });
  assert.doesNotMatch(serialized, /sk-fakefakefakefake123456/);
  assert.doesNotMatch(serialized, /\/home\/dev/);
  assert.doesNotMatch(serialized, /dev@example\.com/);
});

test("caps are disclosed as unverified coverage, never absence", async () => {
  const result = await extractRepository({
    root: fixtureRepo,
    limits: { maxFiles: 2, maxBytes: 100000 },
  });
  const inventoryClaim = result.claims.find((c) => c.subject === "repository-inventory");
  assert.equal(inventoryClaim.status, "unverified");
  assert.match(inventoryClaim.note, /coverage capped at maxFiles=2/);
});

const gitRoots = [];
after(() => {
  for (const root of gitRoots) rmSync(root, { recursive: true, force: true });
});

test("bounded git evidence yields co-change pairs and aggregate authorship only", async () => {
  const root = await makeGitFixture();
  gitRoots.push(root);
  const first = await extractRepository({ root });
  assert.equal(first.git.available, true);
  assert.equal(first.git.commitCount, 3);
  assert.equal(first.git.authorship.authors, 1);
  const pair = first.git.coChangePairs.find((p) => p.a === "src/a.mjs" && p.b === "src/b.mjs");
  assert.ok(pair, "expected src/a.mjs+src/b.mjs co-change pair");
  assert.equal(pair.count, 1);
  const serialized = JSON.stringify(first.git);
  assert.doesNotMatch(serialized, /Dev One|dev1@example\.com/);

  const second = await extractRepository({ root });
  assert.deepEqual(second.git.coChangePairs, first.git.coChangePairs);
  const idsA = result_ids(first);
  const idsB = result_ids(second);
  assert.deepEqual(idsA, idsB, "evidence IDs must be stable across identical runs");
});

function result_ids(extraction) {
  return extraction.evidence.map((e) => e.id).toSorted();
}

test("non-git targets report unavailable history without fabricating it", async () => {
  const bare = mkdtempSync(join(tmpdir(), "csm-ddd-nogit-"));
  gitRoots.push(bare);
  writeFileSync(join(bare, "only.txt"), "x\n");
  const result = await extractRepository({ root: bare });
  assert.equal(result.git.available, false);
  assert.equal(result.git.reason, "not-a-git-repository");
});
