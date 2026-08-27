import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const SHIM = path.join(REPO, "scripts/hooks/pre-commit");
const REAL_CONFIG = path.join(REPO, ".lefthook.yml");
const LFK_BIN = path.join(REPO, "node_modules/.bin/lefthook");
const OXL_BIN = path.join(REPO, "node_modules/.bin/oxlint");

const LEGACY = ["S", "Y", "N", "C"].join("");

const MISSING = ![LFK_BIN, OXL_BIN, SHIM].every((p) => fs.existsSync(p));
if (MISSING) {
  console.warn(
    "WARNING: lefthook/oxlint not installed under repo node_modules — skipping pre-commit integration tests",
  );
}
const SKIP = MISSING
  ? "repo node_modules missing lefthook/oxlint; cannot run lefthook integration tests"
  : false;

const FIXTURE_CONFIG = `assert_lefthook_installed: true
output: [execution, failure, summary]

pre-commit:
  piped: true
  jobs:
    - name: unstaged-guard
      run: |
        unstaged=$(git diff --name-status --)
        if [ -n "$unstaged" ]; then
          echo "pre-commit: tracked working-tree changes must be staged before running commit gates:"
          echo "$unstaged"
          echo "pre-commit: stage or discard those changes, or bypass with git commit --no-verify."
          exit 1
        fi
      fail_text: "tracked working-tree changes must be staged (bypass: git commit --no-verify)"
    - name: check-suite
      run: node scripts/check-suite.mjs
      fail_text: "conformance gate failed (node scripts/check-suite.mjs)"
    - name: mjs-syntax
      glob: "*.mjs"
      run: printf '%s\\n' {staged_files} | xargs -n1 -P8 node --check
      fail_text: "staged .mjs syntax check failed"
    - name: oxlint
      glob: "*.{js,mjs,cjs,ts,tsx,mts,cts}"
      run: ${OXL_BIN} --deny-warnings --no-error-on-unmatched-pattern {staged_files}
      fail_text: "oxlint found problems in staged files (errors and warnings both fail)"`;

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function write(root, name, content) {
  fs.writeFileSync(path.join(root, name), content);
}

function combined(result) {
  return `${result.stdout}${result.stderr}`;
}

// F-003 un-stub: the temp repo is a complete corpus copy (repo minus
// .git/node_modules) so the hook's check-suite job runs the REAL gate against
// the same corpus the live gate validates. `.oxlintrc.json` stays as copied
// (the real config keeps the full staged set lint-clean). The heavy test/lib
// trees check-suite never reads are dropped (the README layout tree needs the
// dirs to exist, so empty placeholders are recreated) — this keeps the baseline
// commit's staged-mjs syntax pass fast without changing what the gate validates.
function copyRepo(dest) {
  const tracked = new Set(
    spawnSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8" })
      .stdout.split("\n")
      .filter(Boolean),
  );
  fs.cpSync(REPO, dest, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(REPO, src);
      if (rel === ".git" || rel === "node_modules") return false;
      if (rel.startsWith(`.git${path.sep}`) || rel.startsWith(`node_modules${path.sep}`))
        return false;
      if (rel === "") return true; // keep the root itself
      const relPosix = rel.split(path.sep).join("/");
      if (tracked.has(relPosix)) return true;
      for (const t of tracked) {
        if (t.startsWith(`${relPosix}/`)) return true;
      }
      return false;
    },
  });
  fs.symlinkSync(path.join(REPO, "node_modules"), path.join(dest, "node_modules"), "dir");
  for (const rel of ["tests", "csm-browse/tests", "csm-scan/test", "csm-upload/tests"]) {
    fs.rmSync(path.join(dest, rel), { recursive: true, force: true });
  }
  for (const rel of ["tests", "csm-browse/tests", "csm-scan/test"]) {
    fs.mkdirSync(path.join(dest, rel), { recursive: true });
  }
  // The fixture prunes most tests, but the research corpus validates local
  // citation targets while the hook runs. Preserve the tracked sources cited
  // by those corpus entries without copying the full test suite.
  for (const rel of [
    "tests/plan-json-resume.test.mjs",
    "tests/bdd-build-replay.test.mjs",
    "tests/make-tests-build-replay.test.mjs",
    "tests/build-json-control.test.mjs",
    "tests/browse-upload-json-contract.test.mjs",
    "tests/consumer-replay-matrix.test.mjs",
  ]) {
    const source = path.join(REPO, rel);
    const target = path.join(dest, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  const dependencyPolicy = path.join(REPO, "scripts/lib/dependency-policy.mjs");
  if (fs.existsSync(dependencyPolicy)) {
    fs.copyFileSync(dependencyPolicy, path.join(dest, "scripts/lib/dependency-policy.mjs"));
  }
  const skillManifest = path.join(REPO, "bootstrap/skill-manifest.json");
  if (fs.existsSync(skillManifest)) {
    fs.mkdirSync(path.join(dest, "bootstrap"), { recursive: true });
    fs.copyFileSync(skillManifest, path.join(dest, "bootstrap/skill-manifest.json"));
  }
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pre-commit-lh-"));
  copyRepo(root);
  write(root, "good.mjs", "export const base = 1;\n");
  write(root, "tracked.txt", "tracked\n");
  fs.copyFileSync(SHIM, path.join(root, "scripts/hooks/pre-commit"));
  fs.chmodSync(path.join(root, "scripts/hooks/pre-commit"), 0o755);
  write(root, ".lefthook.yml", FIXTURE_CONFIG);
  git(root, "init", "-q");
  git(root, "config", "user.name", "Hook Test");
  git(root, "config", "user.email", "hook-test@example.invalid");
  git(root, "config", "core.hooksPath", "scripts/hooks");
  git(root, "add", ".");
  const baseline = commit(root, "baseline");
  assert.equal(baseline.status, 0, `baseline commit failed: ${combined(baseline)}`);
  return root;
}

function commit(root, message, ...args) {
  return spawnSync("git", ["commit", "-m", message, ...args], {
    cwd: root,
    encoding: "utf8",
    env: hookEnv(),
  });
}

function hookEnv() {
  const env = { ...process.env, LEFTHOOK_BIN: LFK_BIN };
  delete env.LEFTHOOK;
  return env;
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test("(a) repo .lefthook.yml validates and the hook shim is in place", { skip: SKIP }, (t) => {
  const real = fs.readFileSync(REAL_CONFIG, "utf8");
  assert.ok(fs.existsSync(REAL_CONFIG), "repo .lefthook.yml exists");
  assert.match(real, /piped:\s*true/);
  for (const job of [
    "unstaged-guard",
    "oxfmt",
    "check-suite",
    "mjs-syntax",
    "oxlint",
    "csm-browse-check",
  ]) {
    assert.match(real, new RegExp(`name: ${job}`), `repo config has job ${job}`);
  }
  assert.match(real, /--deny-warnings/, "repo oxlint job uses --deny-warnings");

  const validated = spawnSync(LFK_BIN, ["validate"], { cwd: REPO, encoding: "utf8" });
  assert.equal(validated.status, 0, `lefthook validate failed: ${combined(validated)}`);

  const st = fs.statSync(SHIM);
  assert.ok(st.isFile(), "shim is a file");
  assert.ok(st.mode & 0o111, "shim is executable");
  const content = fs.readFileSync(SHIM, "utf8");
  assert.ok(content.startsWith("#!/bin/sh\n"), "shim starts with #!/bin/sh");
  assert.match(content, /LEFTHOOK/, "shim contains the LEFTHOOK fingerprint");
  assert.match(content, /LEFTHOOK_BIN/, "shim honors LEFTHOOK_BIN env");
  assert.match(content, /LEFTHOOK=0/, "shim honors LEFTHOOK=0 to skip");
  t.diagnostic("repo config + shim OK");
});

test("(b) clean / staged-only / staged-deletion / untracked commits pass", { skip: SKIP }, (t) => {
  const root = setup();
  t.after(() => cleanup(root));

  const cases = [
    {
      name: "clean",
      mutate: () => {},
      args: ["--allow-empty"],
      expectGate: false,
    },
    {
      name: "staged-only",
      mutate: () => {
        write(root, "good.mjs", "export const base = 2;\n");
        git(root, "add", "good.mjs");
      },
      expectGate: true,
    },
    {
      name: "untracked-file",
      mutate: () => {
        write(root, "untracked.mjs", "export const stray = true;\n");
        write(root, "good.mjs", "export const base = 3;\n");
        git(root, "add", "good.mjs");
      },
      expectGate: true,
    },
    {
      name: "staged-deletion",
      mutate: () => {
        git(root, "rm", "-q", "good.mjs");
      },
      expectGate: true,
    },
  ];

  for (const c of cases) {
    c.mutate();
    const r = commit(root, `b:${c.name}`, ...(c.args || []));
    assert.equal(r.status, 0, `${c.name} commit failed: ${combined(r)}`);
    const out = combined(r);
    assert.doesNotMatch(out, /🥊/, `${c.name}: no job failures`);
    assert.doesNotMatch(out, new RegExp(LEGACY), `${c.name}: no legacy hook output`);
    if (c.expectGate) {
      assert.match(out, /check-suite: OK/, `${c.name}: real gate ran`);
    }
    git(root, "reset", "-q", "--hard", "HEAD");
  }
  fs.rmSync(path.join(root, "untracked.mjs"), { force: true });
  t.diagnostic("clean/staged/deletion/untracked all committed");
});

test("(c) unstaged or mixed tracked changes are blocked before any gate", { skip: SKIP }, (t) => {
  const root = setup();
  t.after(() => cleanup(root));

  const guardRe = /tracked working-tree changes must be staged/;

  const mixed = [
    {
      name: "staged file + unstaged tracked modification",
      mutate: () => {
        write(root, "good.mjs", "export const base = 20;\n");
        git(root, "add", "good.mjs");
        write(root, "tracked.txt", "dirty\n");
      },
    },
    {
      name: "staged file + unstaged tracked deletion",
      mutate: () => {
        write(root, "good.mjs", "export const base = 21;\n");
        git(root, "add", "good.mjs");
        fs.unlinkSync(path.join(root, "tracked.txt"));
      },
    },
  ];

  for (const c of mixed) {
    c.mutate();
    const r = commit(root, `c:${c.name}`);
    assert.notEqual(r.status, 0, `${c.name}: commit must fail`);
    const out = combined(r);
    assert.match(out, guardRe, `${c.name}: guard message`);
    assert.doesNotMatch(out, /check-suite: OK/, `${c.name}: no gate output (piped guard-first)`);
    git(root, "reset", "-q", "--hard", "HEAD");
  }

  write(root, "tracked.txt", "only unstaged\n");
  const unstaged = commit(root, "c:unstaged-only");
  assert.notEqual(unstaged.status, 0, "unstaged-only commit must fail");
  const out = combined(unstaged);
  assert.match(out, /no changes added to commit|nothing to commit/, "git refuses the empty index");
  assert.doesNotMatch(out, /check-suite: OK/, "unstaged-only: no gate output");
  git(root, "reset", "-q", "--hard", "HEAD");
  t.diagnostic("guard blocks mixed/unstaged before gates");
});

test(
  "(d) staged oxlint-error .mjs blocks; the same UNTRACKED error does not",
  { skip: SKIP },
  (t) => {
    const root = setup();
    t.after(() => cleanup(root));

    const badPath = path.join(root, "bad.mjs");
    write(root, "bad.mjs", "const x = ;\n");

    const oxl = spawnSync(
      OXL_BIN,
      ["--deny-warnings", "--no-error-on-unmatched-pattern", badPath],
      {
        encoding: "utf8",
      },
    );
    assert.notEqual(oxl.status, 0, `fixture must fail a real oxlint invocation: ${combined(oxl)}`);
    t.diagnostic(`fixture oxlint: exit ${oxl.status} (${combined(oxl).trim()})`);

    git(root, "add", "bad.mjs");
    const blocked = commit(root, "d:staged-bad");
    assert.notEqual(blocked.status, 0, "staged oxlint-error .mjs must block the commit");
    assert.match(combined(blocked), /Unexpected token|SyntaxError|syntax check failed/);
    git(root, "reset", "-q", "HEAD");

    write(root, "good.mjs", "export const base = 30;\n");
    git(root, "add", "good.mjs");
    const passed = commit(root, "d:untracked-bad");
    assert.equal(passed.status, 0, `untracked bad.mjs must not block: ${combined(passed)}`);
    assert.match(combined(passed), /check-suite: OK/);
    assert.match(git(root, "status", "--short"), /\?\? bad\.mjs/, "bad.mjs stays untracked");
    t.diagnostic("staged error blocks; untracked error ignored by {staged_files} globs");
  },
);

test("(e) an oxlint warning blocks under --deny-warnings", { skip: SKIP }, (t) => {
  const root = setup();
  t.after(() => cleanup(root));

  const warnPath = path.join(root, "warn.mjs");
  write(root, "warn.mjs", "const unusedVar = 1;\n");

  const plain = spawnSync(OXL_BIN, ["--no-error-on-unmatched-pattern", warnPath], {
    encoding: "utf8",
  });
  assert.equal(plain.status, 0, `plain oxlint must pass the fixture: ${combined(plain)}`);
  const deny = spawnSync(
    OXL_BIN,
    ["--deny-warnings", "--no-error-on-unmatched-pattern", warnPath],
    {
      encoding: "utf8",
    },
  );
  assert.notEqual(
    deny.status,
    0,
    `oxlint --deny-warnings must fail the fixture: ${combined(deny)}`,
  );
  t.diagnostic("warning fixture: plain oxlint exit 0, --deny-warnings exit non-zero");

  git(root, "add", "warn.mjs");
  const r = commit(root, "e:warn");
  assert.notEqual(r.status, 0, "staged warning must block the commit");
  assert.match(combined(r), /oxlint|unusedVar/, "blocked by oxlint");
  git(root, "reset", "-q", "--hard", "HEAD");
  t.diagnostic("--deny-warnings escalates staged warnings to failures");
});

test(
  "(e2) a suspicious-category warning (no-shadow) blocks via the committed .oxlintrc.json",
  { skip: SKIP },
  (t) => {
    const root = setup();
    t.after(() => cleanup(root));

    const shadowPath = path.join(root, "shadow.mjs");
    write(
      root,
      "shadow.mjs",
      "function outer() {\n  const x = 1;\n  function inner() {\n    const x = 2;\n    return x;\n  }\n  return inner() + x;\n}\nexport { outer };\n",
    );

    const plain = spawnSync(OXL_BIN, ["--no-error-on-unmatched-pattern", shadowPath], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(
      plain.status,
      0,
      `plain oxlint must pass the fixture without config: ${combined(plain)}`,
    );
    const withCfg = spawnSync(
      OXL_BIN,
      ["--deny-warnings", "--no-error-on-unmatched-pattern", shadowPath],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    assert.notEqual(
      withCfg.status,
      0,
      `oxlint with fixture .oxlintrc.json (suspicious) must flag the shadow: ${combined(withCfg)}`,
    );
    assert.match(
      combined(withCfg),
      /no-shadow/,
      "flagged by the suspicious-category no-shadow rule",
    );
    t.diagnostic("no-shadow fixture: default oxlint exit 0; with suspicious config exit non-zero");

    git(root, "add", "shadow.mjs");
    const r = commit(root, "e2:shadow");
    assert.notEqual(
      r.status,
      0,
      "staged no-shadow warning must block the commit via config discovery",
    );
    assert.match(combined(r), /no-shadow/, "blocked by the suspicious no-shadow rule");
    git(root, "reset", "-q", "--hard", "HEAD");
    t.diagnostic("committed .oxlintrc.json categories apply to the hook via config discovery");
  },
);

test("(f) git commit --no-verify bypasses the hook", { skip: SKIP }, (t) => {
  const root = setup();
  t.after(() => cleanup(root));

  write(root, "good.mjs", "export const base = 40;\n");
  git(root, "add", "good.mjs");
  write(root, "tracked.txt", "dirty\n");

  const r = commit(root, "f:bypass", "--no-verify");
  assert.equal(r.status, 0, combined(r));
  const out = combined(r);
  assert.doesNotMatch(out, /check-suite: OK/, "no gate output on bypass");
  assert.doesNotMatch(out, /tracked working-tree changes must be staged/, "no guard on bypass");
  t.diagnostic("--no-verify skips the lefthook shim entirely");
});

test("(g) a clean commit leaves git status clean and the commit exists", { skip: SKIP }, (t) => {
  const root = setup();
  t.after(() => cleanup(root));

  const before = git(root, "rev-parse", "HEAD").trim();
  write(root, "good.mjs", "export const base = 50;\n");
  git(root, "add", "good.mjs");

  const r = commit(root, "g:clean");
  assert.equal(r.status, 0, combined(r));
  assert.match(combined(r), /check-suite: OK/);
  assert.equal(git(root, "status", "--short"), "", "status clean after commit");
  const after = git(root, "rev-parse", "HEAD").trim();
  assert.notEqual(after, before, "a new commit was created");
  t.diagnostic("clean commit created with clean status");
});
