import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createRecordingRunner } from "./helpers/recording-runner.mjs";
import { rgIgnoreArgs } from "../lib/scan/shared/ignore.mjs";
import {
  CommandError,
  COMMAND_LIMITS,
  buildCommandEnv,
  createCommandBroker,
  commandBroker,
  defaultRunner,
} from "../lib/scan/shared/command.mjs";
import { scan as scanGit } from "../lib/scan/deep/git.mjs";

function expectedRgGlobArgs() {
  return rgIgnoreArgs().flatMap((entry) => {
    const i = entry.indexOf(" ");
    return [entry.slice(0, i), entry.slice(i + 1)];
  });
}

function readSource(rel) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

test("T208 command broker rejects any executable or argv outside registered command IDs", async () => {
  const broker = createCommandBroker({
    runner: { run: async () => ({ status: 0, stdout: "", stderr: "" }) },
  });
  for (const id of ["does:not-exist", "", "rg", "git", "rg --files", undefined, null, 42]) {
    await assert.rejects(broker.execute(id), (error) => {
      assert.ok(error instanceof CommandError, `id ${String(id)} must raise a typed CommandError`);
      assert.equal(error.code, "UNKNOWN_COMMAND", `id ${String(id)} must fail as UNKNOWN_COMMAND`);
      return true;
    });
  }
});

test("T208 registered commands record exact fixed argv arrays and controlled command IDs", async () => {
  const { calls, run } = createRecordingRunner(() => ({ status: 0, stdout: "", stderr: "" }));
  const broker = createCommandBroker({ runner: { run } });

  const rgFiles = await broker.execute("rg:files", { cwd: "/repo" });
  const gitToplevel = await broker.execute("git:rev-parse-toplevel", { cwd: "/repo" });
  const gitAbbrev = await broker.execute("git:rev-parse-abbrev-head", { cwd: "/repo" });
  const gitLog = await broker.execute("git:log-oneline-50", { cwd: "/repo" });
  const gitLog200 = await broker.execute("git:log-oneline-200", { cwd: "/repo" });
  const gitLsFiles = await broker.execute("git:ls-files", { cwd: "/repo" });
  const gitBranch = await broker.execute("git:branch-list", { cwd: "/repo" });
  const gitHead = await broker.execute("git:symbolic-ref-origin-head", { cwd: "/repo" });
  const gitRemote = await broker.execute("git:config-remote-origin-url", { cwd: "/repo" });
  const gitShortlog = await broker.execute("git:shortlog-summary", { cwd: "/repo" });
  const rgJson = await broker.execute("rg:json", { cwd: "/repo", pattern: "def" });

  assert.ok(
    [gitToplevel, gitAbbrev, gitLog, gitLog200, gitLsFiles, gitBranch, gitHead, gitRemote].every(
      (result) => result.ok === true,
    ),
    "every registered command completes successfully",
  );
  assert.equal(rgFiles.ok, true);
  assert.equal(rgJson.ok, true);
  assert.equal(gitShortlog.ok, true);

  const expectedArgv = [
    ["--files", ...expectedRgGlobArgs()],
    ["rev-parse", "--show-toplevel"],
    ["rev-parse", "--abbrev-ref", "HEAD"],
    ["log", "--oneline", "-50"],
    ["log", "--oneline", "-200"],
    ["ls-files"],
    ["branch", "-a"],
    ["symbolic-ref", "refs/remotes/origin/HEAD"],
    ["config", "--get", "remote.origin.url"],
    ["shortlog", "-s", "-n", "HEAD"],
    ["--json", ...expectedRgGlobArgs(), "--", "def"],
  ];
  assert.deepEqual(
    calls.map((call) => call.argv),
    expectedArgv,
  );
  assert.deepEqual(
    calls.map((call) => call.executable),
    ["rg", "git", "git", "git", "git", "git", "git", "git", "git", "git", "rg"],
  );
  assert.ok(
    calls.every((call) => call.executable === "rg" || call.executable === "git"),
    "controlled PATH must record only the allowed command families",
  );
  assert.ok(
    calls.every((call) => call.shell === false),
    "shell mode is always disabled",
  );
  assert.deepEqual(calls[0].stdio, ["ignore", "pipe", "pipe"]);
  assert.equal(calls[0].timeout, COMMAND_LIMITS.rgFilesTimeoutMs);
  assert.deepEqual(calls[0].outputPolicy, {
    maxBytes: COMMAND_LIMITS.rgFilesMaxBytes,
    encoding: "utf8",
  });
  assert.equal(calls[1].timeout, COMMAND_LIMITS.gitTimeoutMs);
  assert.deepEqual(calls[1].outputPolicy, {
    maxBytes: COMMAND_LIMITS.gitMaxBytes,
    encoding: "utf8",
  });
});

test("T208 commands run with a reduced deterministic environment", async () => {
  const reduced = buildCommandEnv({
    PATH: "/usr/bin:/bin",
    HOME: "/home/tester",
    TOKEN: "secret",
    FOO: "bar",
  });
  assert.deepEqual(reduced, {
    LC_ALL: "C",
    LANG: "C",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "false",
    SSH_ASKPASS: "false",
    GIT_PAGER: "cat",
    PAGER: "cat",
    NO_COLOR: "1",
    PATH: "/usr/bin:/bin",
  });

  const { calls, run } = createRecordingRunner(() => ({ status: 0, stdout: "", stderr: "" }));
  const broker = createCommandBroker({ runner: { run } });
  await broker.execute("git:log-oneline-50", { cwd: "/repo" });

  assert.deepEqual(calls[0].env, buildCommandEnv(process.env));
  assert.equal(calls[0].env.GIT_OPTIONAL_LOCKS, "0");
  assert.equal(calls[0].env.LC_ALL, "C");
  assert.equal(calls[0].env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(calls[0].env.GIT_PAGER, "cat");
  assert.equal(calls[0].env.PAGER, "cat");
  assert.equal(calls[0].env.NO_COLOR, "1");
  assert.equal(calls[0].env.HOME, undefined, "host HOME must not leak into the child environment");
  assert.equal(
    calls[0].env.TOKEN,
    undefined,
    "host tokens must not leak into the child environment",
  );
});

test("T208 rg exit 1 after a completed search means no match; git non-zero means no value", async () => {
  const { calls, run } = createRecordingRunner([
    { status: 1, stdout: "", stderr: "" },
    { status: 128, stdout: "", stderr: "fatal: not a repository" },
    { status: 0, stdout: "pkg/main.py\n", stderr: "" },
  ]);
  const broker = createCommandBroker({ runner: { run } });

  const noMatch = await broker.execute("rg:files", { cwd: "/repo" });
  assert.equal(noMatch.status, 1);
  assert.equal(noMatch.ok, false);
  assert.equal(noMatch.noMatch, true);
  assert.equal(noMatch.stdout, "");

  const gitNoValue = await broker.execute("git:branch-list", { cwd: "/repo" });
  assert.equal(gitNoValue.status, 128);
  assert.equal(gitNoValue.ok, false);
  assert.equal(gitNoValue.noMatch, true);

  const found = await broker.execute("rg:files", { cwd: "/repo" });
  assert.equal(found.status, 0);
  assert.equal(found.ok, true);
  assert.equal(found.noMatch, false);
  assert.equal(found.stdout, "pkg/main.py\n");
  assert.equal(calls.length, 3);
});

test("T208 non-no-match rg failures and runner failures become sanitized typed errors", async () => {
  const { run: failRg } = createRecordingRunner([
    { status: 2, stdout: "", stderr: "error: /private/etc/repo" },
  ]);
  await assert.rejects(
    createCommandBroker({ runner: { run: failRg } }).execute("rg:files", { cwd: "/repo" }),
    (error) => {
      assert.ok(error instanceof CommandError);
      assert.equal(error.code, "RG_FAILURE");
      assert.ok(
        !error.message.includes("/private/etc"),
        "raw stderr must never leak into error messages",
      );
      return true;
    },
  );

  const { run: throwRunner } = createRecordingRunner([new Error("configured failure")]);
  await assert.rejects(
    createCommandBroker({ runner: { run: throwRunner } }).execute("git:log-oneline-50", {
      cwd: "/repo",
    }),
    (error) => {
      assert.ok(error instanceof CommandError);
      assert.equal(error.code, "RUN_FAILURE");
      assert.ok(
        !error.message.includes("configured failure"),
        "raw runner messages must never leak",
      );
      return true;
    },
  );
});

test("T208 rg:json accepts only bounded literal patterns", async () => {
  const { run } = createRecordingRunner(() => ({ status: 0, stdout: "", stderr: "" }));
  const broker = createCommandBroker({ runner: { run } });

  const result = await broker.execute("rg:json", { cwd: "/repo", pattern: "todo" });
  assert.equal(result.ok, true);

  for (const pattern of ["a b", "-flag", "a;rm -rf /", "a`b", "a$b", "", "a".repeat(257)]) {
    await assert.rejects(broker.execute("rg:json", { cwd: "/repo", pattern }), (error) => {
      assert.ok(error instanceof CommandError);
      assert.equal(
        error.code,
        "INVALID_PATTERN",
        `pattern ${JSON.stringify(pattern.slice(0, 8))} must be rejected`,
      );
      return true;
    });
  }
});

test("T208 default runner enforces caps and sanitizes OS errors", async () => {
  await assert.rejects(
    commandBroker.execute("rg:files", { cwd: "/definitely-nonexistent-csm-scan-dir-xyz" }),
    (error) => {
      assert.ok(error instanceof CommandError);
      assert.equal(error.code, "ENOENT");
      assert.ok(
        !error.message.includes("/definitely-nonexistent"),
        "paths must never leak into error messages",
      );
      return true;
    },
  );
});

test("T208 migrated callers own no child-process capability outside the broker", () => {
  assert.match(
    readSource("lib/scan/shared/command.mjs"),
    /import \{ execFile \} from 'node:child_process';/,
  );
  for (const rel of ["lib/scan/shared/enum.mjs", "lib/scan/survey.mjs", "lib/scan/deep/git.mjs"]) {
    const source = readSource(rel);
    assert.ok(!source.includes("node:child_process"), `${rel} must not import node:child_process`);
    assert.ok(!source.includes("execFile"), `${rel} must not reference execFile`);
    assert.ok(!source.includes("execSync"), `${rel} must not reference execSync`);
  }
});

test("T208 git scan issues only registered read-only commands through the broker", async () => {
  const dir = mkdtempSync(join(tmpdir(), "csm-scan-git-"));
  try {
    runGit(dir, ["init", "-q"]);
    runGit(dir, ["config", "user.name", "Alice Example"]);
    runGit(dir, ["config", "user.email", "alice@example.com"]);
    writeFileSync(join(dir, "a.txt"), "hello\n");
    runGit(dir, ["add", "a.txt"]);
    runGit(dir, ["commit", "-q", "-m", "feat: initial"]);
    runGit(dir, ["config", "user.name", "Bob Other"]);
    runGit(dir, ["config", "user.email", "bob@example.com"]);
    writeFileSync(join(dir, "b.txt"), "world\n");
    runGit(dir, ["add", "b.txt"]);
    runGit(dir, ["commit", "-q", "-m", "fix: second"]);
    runGit(dir, ["remote", "add", "origin", "https://alice:secret@github.com/acme/demo.git"]);

    const calls = [];
    const broker = createCommandBroker({
      runner: {
        async run(executable, argv, options) {
          calls.push({ executable, argv: [...argv] });
          return defaultRunner.run(executable, argv, options);
        },
      },
    });

    const findings = (await scanGit(dir, {}, broker)).findings;

    assert.deepEqual(
      calls.map((call) => call.executable),
      ["git", "git", "git", "git", "git", "git"],
    );
    assert.deepEqual(
      calls.map((call) => call.argv.join(" ")),
      [
        "log --oneline -200",
        "branch -a",
        "symbolic-ref refs/remotes/origin/HEAD",
        "rev-parse --abbrev-ref HEAD",
        "config --get remote.origin.url",
        "shortlog -s -n HEAD",
      ],
    );

    assert.equal(findings.isGit, true);
    assert.equal(typeof findings.contributorCount, "number");
    assert.ok(findings.contributorCount >= 1, `contributorCount=${findings.contributorCount}`);
    // F-077: the vestigial topContributors field was removed entirely — git
    // findings carry aggregate counts only, never identities.
    assert.equal(
      findings.topContributors,
      undefined,
      "topContributors must not exist: git findings carry no identities",
    );

    const serialized = JSON.stringify(findings);
    assert.ok(!serialized.includes("Alice"), "no contributor name may leak");
    assert.ok(!serialized.includes("Bob"), "no contributor name may leak");
    assert.ok(!serialized.includes("alice@example.com"), "no contributor email may leak");
    assert.ok(!serialized.includes("bob@example.com"), "no contributor email may leak");
    assert.ok(!serialized.includes("@"), "no identity/email forms may leak");

    assert.equal(findings.remote, "github.com/acme/demo");
    assert.ok(!findings.remote.includes("secret"));
    assert.ok(!findings.remote.includes("https://"));
    assert.ok(!findings.remote.includes(".git"));
    assert.ok(!findings.remote.startsWith("/"), "remote must not be an absolute path");

    runGit(dir, ["remote", "set-url", "origin", "git@github.com:acme/demo.git"]);
    assert.equal((await scanGit(dir, {}, broker)).findings.remote, "github.com/acme/demo");

    runGit(dir, ["remote", "set-url", "origin", "/home/someone/repo.git"]);
    assert.equal(
      (await scanGit(dir, {}, broker)).findings.remote,
      "N/A",
      "local absolute-path remotes must be dropped, never rendered",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function runGit(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}
