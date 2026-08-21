import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCommandBroker } from "../lib/scan/shared/command.mjs";
import { createRecordingRunner } from "./helpers/recording-runner.mjs";
import { makeGitRepo, cleanupGitRepo } from "./helpers/git-fixture.mjs";
import {
  enumerate,
  enumerateHiddenFiles,
  byExtension,
  sumSizes,
} from "../lib/scan/shared/enum.mjs";

function writeRel(root, rel, content) {
  const full = join(root, ...rel.split("/"));
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

test("enumerate filters caches/dist, keeps lockfile, sums real bytes", async () => {
  const root = mkdtempSync(join(tmpdir(), "csm-scan-enum-"));

  const contents = {
    "pkg/mod.py": "import mod\n",
    "pkg/main.py": "from . import mod\nprint('hi')\n",
    ".hypothesis/constants/deadbeef": "cache-bytes\n",
    "dist/out.js": "console.log('build')\n",
    "pkg/uv.lock": "[[lock]]\n",
  };

  for (const [rel, content] of Object.entries(contents)) {
    writeRel(root, rel, content);
  }

  try {
    const result = await enumerate(root);

    assert.ok(result.files.includes("pkg/mod.py"), "pkg/mod.py should be present");
    assert.ok(result.files.includes("pkg/main.py"), "pkg/main.py should be present");
    assert.ok(result.files.includes("pkg/uv.lock"), "pkg/uv.lock should be present");
    assert.ok(
      !result.files.some((f) => f.startsWith(".hypothesis/")),
      ".hypothesis cache should be excluded",
    );
    assert.ok(
      !result.files.some((f) => f.startsWith("dist/")),
      "dist build output should be excluded",
    );

    assert.equal(result.extCounts[".py"], 2, ".py count should be 2");

    const expectedBytes = ["pkg/mod.py", "pkg/main.py", "pkg/uv.lock"]
      .map((rel) => Buffer.byteLength(contents[rel]))
      .reduce((a, b) => a + b, 0);
    assert.equal(
      result.totalBytes,
      expectedBytes,
      "totalBytes must equal real byte sum of included files",
    );

    assert.equal(byExtension(result.files)[".py"], 2);
    assert.equal(
      sumSizes(root, result.files),
      expectedBytes,
      "sumSizes must match expected real byte total",
    );

    assert.equal(result.totalFiles, result.files.length);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("enumerate throws on non-1 rg failure", async () => {
  const root = mkdtempSync(join(tmpdir(), "csm-scan-enum-"));
  try {
    await assert.rejects(enumerate("/proc/1/nonexistent-scan-dir-xyz"), Error);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("enumerate reports both rg-scoped and git-tracked scopes on a real git repo", async () => {
  const dir = makeGitRepo({
    files: {
      "app.py": "x = 1\n",
      ".github/workflows/ci.yml": "name: ci\n",
      "tracked-but-ignored.toml": "[x]\n",
    },
    commits: [
      "feat: initial",
      { message: "chore: ignore", files: { ".gitignore": "tracked-but-ignored.toml\n" } },
    ],
  });
  try {
    writeFileSync(join(dir, "untracked.txt"), "hi\n");

    const result = await enumerate(dir);

    assert.ok(result.gitTracked, "git-tracked scope must be present");
    assert.equal(result.gitTracked.available, true);
    assert.equal(result.gitTracked.truncated, false);
    assert.ok(
      result.gitTracked.files.includes(".github/workflows/ci.yml"),
      "hidden dot-dir tracked files must be in the git-tracked scope",
    );
    assert.ok(
      result.gitTracked.files.includes("tracked-but-ignored.toml"),
      "gitignored-but-tracked files must be in the git-tracked scope",
    );
    assert.ok(
      result.gitTracked.files.includes(".gitignore"),
      "dot-file tracked files must be in the git-tracked scope",
    );
    assert.ok(
      !result.gitTracked.files.includes("untracked.txt"),
      "untracked files must not be in the git-tracked scope",
    );

    assert.ok(
      result.files.includes("untracked.txt"),
      "non-hidden non-ignored untracked files must be in the rg-scoped scope",
    );
    assert.ok(
      !result.files.includes(".github/workflows/ci.yml"),
      "hidden paths must be excluded from the rg-scoped scope",
    );
    assert.ok(
      !result.files.includes("tracked-but-ignored.toml"),
      "gitignored paths must be excluded from the rg-scoped scope",
    );

    assert.ok(
      result.gitTracked.totalFiles > result.totalFiles,
      `git-tracked (${result.gitTracked.totalFiles}) must exceed rg-scoped (${result.totalFiles}) when hidden tracked files exist`,
    );
    assert.equal(
      result.gitTracked.extCounts[".yml"],
      1,
      "git-tracked extension counts must include hidden-file extensions",
    );
  } finally {
    cleanupGitRepo(dir);
  }
});

test("enumerate falls back to rg-scoped only outside a git work tree", async () => {
  const { run } = createRecordingRunner((call) => {
    if (call.executable === "rg") return { status: 0, stdout: "mod.py\n", stderr: "" };
    return { status: 128, stdout: "", stderr: "fatal: not a git repository" };
  });
  const broker = createCommandBroker({ runner: { run } });
  const result = await enumerate("/repo", broker);

  assert.equal(result.gitTracked, null, "non-git repos must report no git-tracked scope");
  assert.equal(result.totalFiles, 1);
  assert.deepEqual(result.files, ["mod.py"]);
});

test("enumerate records git-tracked truncation without fabricating a count", async () => {
  const { run } = createRecordingRunner((call) => {
    if (call.executable === "rg") return { status: 0, stdout: "mod.py\n", stderr: "" };
    const error = new Error("git ls-files exceeded the output cap");
    error.code = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
    return error;
  });
  const broker = createCommandBroker({ runner: { run } });
  const result = await enumerate("/repo", broker);

  assert.ok(result.gitTracked, "a git-scope model must always be reported");
  assert.equal(result.gitTracked.available, false);
  assert.equal(result.gitTracked.truncated, true);
  assert.equal(result.gitTracked.totalFiles, 0);
  assert.equal(result.totalFiles, 1);
});

// R2: the hidden enumeration result carries a `failed` flag so a failed pass
// (rg error) is distinguishable from an honestly empty hidden file list.
test("enumerateHiddenFiles reports {files, failed} and never folds rg failure into an empty list", async () => {
  const { run: okRun } = createRecordingRunner((call) => {
    if (call.executable === "rg") return { status: 0, stdout: ".env\nsrc/mod.py\n", stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  });
  const okBroker = createCommandBroker({ runner: { run: okRun } });
  const okResult = await enumerateHiddenFiles("/repo", okBroker);

  assert.equal(okResult.failed, false, "a healthy pass must not be flagged");
  assert.deepEqual(okResult.files, [".env", "src/mod.py"]);

  const { run: noMatchRun } = createRecordingRunner((call) => {
    if (call.executable === "rg") return { status: 1, stdout: "", stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  });
  const noMatchResult = await enumerateHiddenFiles(
    "/repo",
    createCommandBroker({ runner: { run: noMatchRun } }),
  );
  assert.equal(noMatchResult.failed, false, "rg exit 1 (no matches) is a healthy empty pass");
  assert.deepEqual(noMatchResult.files, []);

  const { run: failRun } = createRecordingRunner((call) => {
    if (call.executable === "rg") return { status: 2, stdout: "", stderr: "rg crashed" };
    return { status: 0, stdout: "", stderr: "" };
  });
  const failResult = await enumerateHiddenFiles(
    "/repo",
    createCommandBroker({ runner: { run: failRun } }),
  );
  assert.equal(
    failResult.failed,
    true,
    "an rg failure must be surfaced, never folded into files: []",
  );
  assert.deepEqual(failResult.files, []);
});
