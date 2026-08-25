import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFile(path.join(ROOT, name), "utf8");

test("audit target is non-mutating and fails at high severity", async () => {
  const makefile = await read("Makefile");
  const auditTarget = /^audit:.*\n((?:\t.*\n?)*)/m.exec(makefile)?.[0] ?? "";
  assert.match(auditTarget, /^audit:.*non-mutating/m);
  assert.match(auditTarget, /pnpm audit --audit-level=high/);
  assert.doesNotMatch(auditTarget, /--fix|--fix-lockfile|install|update/);
  const checklist = await read("bootstrap/release-checklist.md");
  assert.match(checklist, /outages also fail and block release/i);
  assert.match(checklist, /lower severities are reported/i);
});

test("provenance prerequisites are manual, protected, least-privilege, and digest-bound", async () => {
  const workflow = await read(".github/workflows/release-provenance-check.yml");
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s+(push|pull_request):/m);
  assert.match(workflow, /environment:\s*\n\s+name: release/);
  assert.match(workflow, /contents:\s*read/);
  assert.doesNotMatch(workflow, /id-token:\s*write/);
  assert.match(workflow, /approved_artifact_digest/);
  assert.match(workflow, /sha256sum/);
  assert.match(workflow, /git status --porcelain/);
  assert.doesNotMatch(workflow, /npm\s+publish|pnpm\s+publish|yarn\s+publish/i);
});

test("provenance input is confined to the canonical staging tree", async () => {
  const workflow = await read(".github/workflows/release-provenance-check.yml");
  assert.match(workflow, /GITHUB_WORKSPACE/);
  assert.match(workflow, /\.release-staging/);
  assert.match(workflow, /isAbsolute\(input\)/);
  assert.match(workflow, /split.*includes\("\.\."\)/);
  assert.match(workflow, /lstatSync\(current\)\.isSymbolicLink\(\)/);
  assert.match(workflow, /artifactStat\.isFile\(\)/);
  assert.match(workflow, /relative\(staging, artifact\)/);
});

test("provenance validation binds strict digest and approved package structure", async () => {
  const workflow = await read(".github/workflows/release-provenance-check.yml");
  assert.match(workflow, /\^\[a-f0-9\]\{64\}\$/);
  assert.match(workflow, /tar.*-tzf/);
  assert.match(workflow, /tar.*-tvzf/);
  assert.match(workflow, /package\/package\.json/);
  assert.match(workflow, /@jamiemills\/csm-skills-bootstrap/);
  assert.match(workflow, /packageJson\.version !== "0\.1\.0"/);
  assert.match(workflow, /payload-index\.json/);
  assert.match(workflow, /must not contain symlink or hardlink/);
});

test("release checklist discloses residual Corepack and registry trust", async () => {
  const checklist = await read("bootstrap/release-checklist.md");
  assert.match(checklist, /Corepack/i);
  assert.match(checklist, /registry trust assumptions/i);
  assert.match(checklist, /does not establish Corepack or registry provenance/i);
  assert.match(checklist, /no publish command/i);
});

test("bootstrap package carries provenance metadata without a publish script", async () => {
  const pkg = JSON.parse(await read("bootstrap/package.json"));
  assert.deepEqual(pkg.repository, {
    type: "git",
    url: "git+https://github.com/jamiemills/opencode-skills.git",
    directory: "bootstrap",
  });
  assert.equal(pkg.publishConfig.access, "public");
  assert.equal(pkg.scripts, undefined);
});
