import test from "node:test";
import assert from "node:assert/strict";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";

const SCRIPT = join(import.meta.dirname, "..", "scripts", "upload.mjs");
const execFileAsync = promisify(execFile);

async function makeSandbox(prefix) {
  return await mkdtemp(join(tmpdir(), prefix));
}

async function runNode(args, env) {
  const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const [code, signal] = await once(child, "close");
  return { code, signal, stdout, stderr };
}

function baseEnv(sandbox, extra = {}) {
  return {
    ...process.env,
    HOME: join(sandbox, "home"),
    TMPDIR: sandbox,
    PATH: `${join(sandbox, "bin")}:${process.env.PATH}`,
    ...extra,
  };
}

async function makeCommandStubs(sandbox, body) {
  const bin = join(sandbox, "bin");
  await mkdir(bin, { recursive: true });
  const script = `#!/usr/bin/env node\n${body}`;
  for (const command of ["git", "gh"]) {
    const path = join(bin, command);
    await writeFile(path, script, "utf8");
    await chmod(path, 0o700);
  }
}

test("dry-run uses a private exclusive preview and cannot follow the legacy symlink", async () => {
  const sandbox = await makeSandbox("csm-upload-test-");
  try {
    await makeCommandStubs(
      sandbox,
      `
      const fs = require('node:fs');
      fs.appendFileSync(process.env.CSM_OPS_LOG, process.argv.slice(2).join(' ') + '\\n');
    `,
    );
    const input = join(sandbox, "input.png");
    const target = join(sandbox, "target.txt");
    const legacy = join(
      sandbox,
      `demo-${new Date().toISOString().split("T")[0]}-symlink.preview.html`,
    );
    await writeFile(input, "synthetic", "utf8");
    await writeFile(target, "unchanged", "utf8");
    await symlink(target, legacy);
    const ops = join(sandbox, "ops.log");
    const result = await runNode(
      [
        SCRIPT,
        "--label",
        "symlink",
        "--github",
        "nobody",
        "--repo",
        "nowhere",
        "--dry-run",
        "--ack-unscanned-binary",
        input,
      ],
      baseEnv(sandbox, { CSM_OPS_LOG: ops }),
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(await readFile(target, "utf8"), "unchanged");
    assert.equal(await readFile(ops, "utf8").catch(() => ""), "");

    const match = result.stdout.match(/Local preview written to: (.+)/);
    assert.ok(match, result.stdout);
    const preview = match[1].trim();
    assert.notEqual(preview, legacy);
    const previewDir = join(preview, "..");
    const dirMode = (await stat(previewDir)).mode & 0o777;
    const fileMode = (await stat(preview)).mode & 0o777;
    assert.equal(dirMode, 0o700);
    assert.equal(fileMode, 0o600);
    assert.match(basename(previewDir), /^csm-upload-preview-/);
    await rm(previewDir, { recursive: true, force: true });
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("SIGTERM stops clone, commit, and push children and removes temporary clones", async () => {
  for (const phase of ["clone", "commit", "push"]) {
    const sandbox = await makeSandbox(`csm-upload-signal-${phase}-`);
    try {
      await makeCommandStubs(
        sandbox,
        `
        const fs = require('node:fs');
        const path = require('node:path');
        const args = process.argv.slice(2);
        const phase = process.env.CSM_STUB_PHASE;
         const operation = args.includes('clone') ? 'clone' : args.includes('remote') ? 'remote' : args.includes('status') ? 'status' : args.includes('commit') ? 'commit' : args.includes('push') ? 'push' : 'other';
        const mark = name => fs.writeFileSync(path.join(process.env.TMPDIR, name), String(process.pid));
        if (operation === 'clone') {
          const destination = args.at(-1);
          fs.mkdirSync(path.join(destination, '.git'), { recursive: true });
          fs.writeFileSync(process.env.CSM_CLONE_PATH, destination);
          if (phase === 'clone') mark('clone.ready');
         } else if (operation === 'remote') {
           process.stdout.write('https://github.com/nobody/nowhere.git\\n');
         } else if (operation === 'status') {
          process.stdout.write(' M synthetic\\n');
        } else if (operation === phase) {
          mark(phase + '.ready');
        }
        if ((operation === 'clone' && phase === 'clone') || operation === phase) setInterval(() => {}, 1000);
      `,
      );
      const input = join(sandbox, "input.png");
      const clonePath = join(sandbox, "clone.path");
      await writeFile(input, "synthetic", "utf8");
      await mkdir(join(sandbox, "home", ".agents"), { recursive: true });
      await writeFile(
        join(sandbox, "home", ".agents", "csm-upload.json"),
        '{"github":"nobody","pagesRepo":"nowhere"}',
        "utf8",
      );
      const env = baseEnv(sandbox, { CSM_STUB_PHASE: phase, CSM_CLONE_PATH: clonePath });
      const child = spawn(
        process.execPath,
        [
          SCRIPT,
          "--label",
          `signal-${phase}`,
          "--github",
          "nobody",
          "--repo",
          "nowhere",
          "--confirm-permanent",
          "--ack-unscanned-binary",
          input,
        ],
        { env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      const marker = join(sandbox, `${phase}.ready`);
      for (
        let i = 0;
        i < 100 &&
        !(await access(marker).then(
          () => true,
          () => false,
        ));
        i++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await access(marker).catch((error) => {
        child.kill("SIGKILL");
        throw new Error(`${phase} marker missing: ${stderr || error.message}`);
      });
      child.kill("SIGTERM");
      const [code] = await once(child, "close");
      assert.equal(code, 143, `${phase} did not exit for SIGTERM`);
      const clone = await readFile(clonePath, "utf8");
      await assert.rejects(access(clone));
      assert.equal(
        (await readdir(sandbox)).some((name) => name.startsWith("csm-pages-")),
        false,
      );
      const pid = Number(await readFile(marker, "utf8"));
      assert.throws(() => process.kill(pid, 0), /ESRCH/);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  }
});

test("F-048: rejects an invalid github value (userinfo injection)", async () => {
  const sandbox = await makeSandbox("csm-upload-reject-gh-");
  try {
    const input = join(sandbox, "input.png");
    await writeFile(input, "synthetic", "utf8");
    await mkdir(join(sandbox, "home", ".agents"), { recursive: true });
    await writeFile(
      join(sandbox, "home", ".agents", "csm-upload.json"),
      '{"github":"nobody","pagesRepo":"nowhere"}',
      "utf8",
    );
    const result = await runNode(
      [
        SCRIPT,
        "--label",
        "bad",
        "--github",
        "nobody@evil.com",
        "--repo",
        "nowhere",
        "--ack-unscanned-binary",
        input,
      ],
      baseEnv(sandbox),
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Invalid GitHub username/);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("F-048: rejects an invalid pagesRepo value", async () => {
  const sandbox = await makeSandbox("csm-upload-reject-repo-");
  try {
    const input = join(sandbox, "input.png");
    await writeFile(input, "synthetic", "utf8");
    await mkdir(join(sandbox, "home", ".agents"), { recursive: true });
    await writeFile(
      join(sandbox, "home", ".agents", "csm-upload.json"),
      '{"github":"nobody","pagesRepo":"nowhere"}',
      "utf8",
    );
    const result = await runNode(
      [
        SCRIPT,
        "--label",
        "bad",
        "--github",
        "nobody",
        "--repo",
        "bad/repo",
        "--ack-unscanned-binary",
        input,
      ],
      baseEnv(sandbox),
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Invalid pages repository name/);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("F-064: uploaded svg is never embedded as an <img> (link bucket only)", async () => {
  const sandbox = await makeSandbox("csm-upload-svg-");
  try {
    await makeCommandStubs(sandbox, `process.exit(0);`);
    const inputPng = join(sandbox, "shot.png");
    const inputSvg = join(sandbox, "asset.svg");
    await writeFile(inputPng, "synthetic", "utf8");
    await writeFile(inputSvg, '<svg xmlns="http://www.w3.org/2000/svg"></svg>', "utf8");
    const result = await runNode(
      [
        SCRIPT,
        "--label",
        "svgtest",
        "--github",
        "nobody",
        "--repo",
        "nowhere",
        "--dry-run",
        "--ack-unscanned-binary",
        inputPng,
        inputSvg,
      ],
      baseEnv(sandbox),
    );
    assert.equal(result.code, 0, result.stderr);
    const match = result.stdout.match(/Local preview written to: (.+)/);
    assert.ok(match, result.stdout);
    const preview = match[1].trim();
    const html = await readFile(preview, "utf8");
    assert.match(html, /<img src="shot\.png"/);
    assert.doesNotMatch(html, /<img[^>]*asset\.svg/);
    assert.match(html, /<a href="asset\.svg">/);
    await rm(join(preview, ".."), { recursive: true, force: true });
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("F-068: redirected Git remote is refused before publication (no network)", async () => {
  const sandbox = await makeSandbox("csm-upload-push-");
  try {
    const bin = join(sandbox, "bin");
    await mkdir(bin, { recursive: true });
    const ghStub = join(bin, "gh");
    await writeFile(ghStub, '#!/usr/bin/env node\nprocess.stdout.write("nobody\\n");\n', "utf8");
    await chmod(ghStub, 0o700);

    const remotesBase = join(sandbox, "remotes");
    const bareRepo = join(remotesBase, "nobody", "nowhere.git");
    await mkdir(dirname(bareRepo), { recursive: true });
    const env = baseEnv(sandbox, {
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      CSM_UPLOAD_GIT_CONFIG: join(sandbox, "isolated.gitconfig"),
    });
    await execFileAsync("git", ["init", "--bare", bareRepo], { env });

    const gitconfig = `[user]\n\tname = csm-upload test\n\temail = upload@test.local\n[url "file://${remotesBase}/"]\n\tinsteadOf = https://github.com/\n`;
    await mkdir(join(sandbox, "home"), { recursive: true });
    await writeFile(join(sandbox, "isolated.gitconfig"), gitconfig, "utf8");

    const input = join(sandbox, "input.png");
    await writeFile(input, "synthetic", "utf8");

    const result = await runNode(
      [
        SCRIPT,
        "--label",
        "happy",
        "--github",
        "nobody",
        "--repo",
        "nowhere",
        "--confirm-permanent",
        "--ack-unscanned-binary",
        input,
      ],
      env,
    );
    assert.equal(result.code, 1, result.stderr);
    assert.match(result.stderr, /redirected Git remote/);

    const configDir = join(sandbox, "home", ".agents");
    const configFile = join(configDir, "csm-upload.json");
    assert.equal((await stat(configDir)).mode & 0o777, 0o700, "config dir must be 0700");
    assert.equal((await stat(configFile)).mode & 0o777, 0o600, "config file must be 0600");
    assert.equal(JSON.parse(await readFile(configFile, "utf8")).github, "nobody");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("F8-07: malformed config without overrides aborts before any write, preserving the original bytes", async () => {
  const sandbox = await makeSandbox("csm-upload-malformed-abort-");
  try {
    await makeCommandStubs(
      sandbox,
      `
      const fs = require('node:fs');
      fs.appendFileSync(process.env.CSM_OPS_LOG, process.argv.slice(2).join(' ') + '\\n');
      process.stdout.write('nobody\\n');
    `,
    );
    const input = join(sandbox, "input.png");
    await writeFile(input, "synthetic", "utf8");
    const configDir = join(sandbox, "home", ".agents");
    const configFile = join(configDir, "csm-upload.json");
    const malformed = "{ definitely not json";
    await mkdir(configDir, { recursive: true });
    await writeFile(configFile, malformed, "utf8");
    const ops = join(sandbox, "ops.log");
    const result = await runNode(
      [SCRIPT, "--label", "malformed", "--ack-unscanned-binary", input],
      baseEnv(sandbox, { CSM_OPS_LOG: ops }),
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /csm-upload\.json/);
    assert.match(result.stderr, /unreadable or malformed/);
    assert.match(result.stderr, /--github\/--repo/);
    assert.equal(await readFile(configFile, "utf8"), malformed);
    assert.equal(await readFile(ops, "utf8").catch(() => ""), "");
    assert.equal(
      (await readdir(sandbox)).some((name) => name.startsWith("csm-pages-")),
      false,
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("F8-07: malformed config with --repo override proceeds with warning and never clobbers the file", async () => {
  const sandbox = await makeSandbox("csm-upload-malformed-override-");
  try {
    const bin = join(sandbox, "bin");
    await mkdir(bin, { recursive: true });
    const ghStub = join(bin, "gh");
    await writeFile(ghStub, '#!/usr/bin/env node\nprocess.stdout.write("nobody\\n");\n', "utf8");
    await chmod(ghStub, 0o700);
    const gitStub = join(bin, "git");
    await writeFile(
      gitStub,
      "#!/usr/bin/env node\nif (process.argv.includes('remote')) process.stdout.write('https://github.com/nobody/nowhere.git\\n');\nprocess.exit(0);\n",
      "utf8",
    );
    await chmod(gitStub, 0o700);

    const input = join(sandbox, "input.png");
    await writeFile(input, "synthetic", "utf8");
    const configDir = join(sandbox, "home", ".agents");
    const configFile = join(configDir, "csm-upload.json");
    const malformed = "{ definitely not json";
    await mkdir(configDir, { recursive: true });
    await writeFile(configFile, malformed, "utf8");

    const result = await runNode(
      [
        SCRIPT,
        "--label",
        "override",
        "--repo",
        "nowhere",
        "--confirm-permanent",
        "--ack-unscanned-binary",
        input,
      ],
      baseEnv(sandbox),
    );
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /csm-upload\.json/);
    assert.match(result.stderr, /unreadable or malformed/);
    assert.equal(await readFile(configFile, "utf8"), malformed);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("F8-07: parseable non-object configs are rejected without clobbering", async () => {
  for (const value of ["[]", "null", '"wrong"', '{"github":42}']) {
    const sandbox = await makeSandbox("csm-upload-invalid-shape-");
    try {
      await makeCommandStubs(sandbox, "process.stdout.write('nobody\\n');");
      const input = join(sandbox, "input.png");
      await writeFile(input, "synthetic", "utf8");
      const configDir = join(sandbox, "home", ".agents");
      const configFile = join(configDir, "csm-upload.json");
      await mkdir(configDir, { recursive: true });
      await writeFile(configFile, value, "utf8");

      const result = await runNode(
        [SCRIPT, "--label", "invalid-shape", "--ack-unscanned-binary", input],
        baseEnv(sandbox),
      );
      assert.equal(result.code, 1, `${value}: ${result.stderr}`);
      assert.match(result.stderr, /INVALID_CONFIG|unreadable or malformed/);
      assert.equal(await readFile(configFile, "utf8"), value);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  }
});

test("publication requires explicit permanence confirmation", async () => {
  const sandbox = await makeSandbox("csm-upload-confirm-");
  try {
    await makeCommandStubs(sandbox, "process.stdout.write('nobody\\n');");
    const input = join(sandbox, "shot.png");
    await writeFile(input, "synthetic", "utf8");
    const result = await runNode(
      [
        SCRIPT,
        "--label",
        "confirm",
        "--github",
        "nobody",
        "--repo",
        "nowhere",
        "--ack-unscanned-binary",
        input,
      ],
      baseEnv(sandbox),
    );
    assert.equal(result.code, 0);
    assert.match(result.stderr, /--confirm-permanent/);
    assert.match(result.stdout, /pushed=false deployed=unverified verified=unverified/);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("sensitive artifact names are refused before Git activity", async () => {
  const sandbox = await makeSandbox("csm-upload-sensitive-");
  try {
    const input = join(sandbox, "session-token.env");
    await writeFile(input, "synthetic", "utf8");
    const result = await runNode(
      [
        SCRIPT,
        "--label",
        "sensitive",
        "--github",
        "nobody",
        "--repo",
        "nowhere",
        "--confirm-permanent",
        "--ack-unscanned-binary",
        input,
      ],
      baseEnv(sandbox),
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Sensitive artifact refused/);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("supported text with credentials or absolute paths is refused before preview", async () => {
  const sandbox = await makeSandbox("csm-upload-content-");
  try {
    await makeCommandStubs(
      sandbox,
      `
      const fs = require('node:fs');
      if (process.argv.includes('push')) fs.writeFileSync(process.env.CSM_PUSH_MARKER, 'published');
      `,
    );
    const input = join(sandbox, "notes.md");
    await writeFile(input, "token=synthetic-secret\n/home/alice/private", "utf8");
    const result = await runNode(
      [
        SCRIPT,
        "--label",
        "content",
        "--github",
        "nobody",
        "--repo",
        "nowhere",
        "--confirm-permanent",
        "--ack-unscanned-binary",
        input,
      ],
      baseEnv(sandbox, { CSM_PUSH_MARKER: join(sandbox, "push.marker") }),
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Content scan refused/);
    assert.doesNotMatch(result.stderr, /synthetic-secret|alice/);
    assert.doesNotMatch(result.stdout, /synthetic-secret|alice/);
    await assert.rejects(access(join(sandbox, "push.marker")));
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("supported text scanning rejects quoted keys and non-POSIX absolute paths", async () => {
  for (const content of [
    '{"api_key": "synthetic-secret"}',
    "C:\\\\Users\\alice\\private",
    "\\\\server\\share\\private",
    "file:///home/alice/private",
  ]) {
    const sandbox = await makeSandbox("csm-upload-content-shapes-");
    try {
      const input = join(sandbox, "notes.txt");
      await writeFile(input, content, "utf8");
      const result = await runNode(
        [
          SCRIPT,
          "--label",
          "content-shapes",
          "--github",
          "nobody",
          "--repo",
          "nowhere",
          "--dry-run",
          "--ack-unscanned-binary",
          input,
        ],
        baseEnv(sandbox),
      );
      assert.equal(result.code, 1);
      assert.match(result.stderr, /Content scan refused/);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  }
});

test("description credentials and absolute paths are refused before index generation", async () => {
  for (const description of [
    "access_token=synthetic-secret",
    "private notes: /home/alice/project",
    '{"api_key": "synthetic-secret"}',
    "private notes: C:\\\\Users\\alice\\project",
    "private notes: \\\\server\\share\\project",
    "private notes: file:///home/alice/project",
  ]) {
    const sandbox = await makeSandbox("csm-upload-description-");
    try {
      await makeCommandStubs(sandbox, "process.exit(0);");
      const input = join(sandbox, "shot.png");
      await writeFile(input, "synthetic", "utf8");
      const result = await runNode(
        [
          SCRIPT,
          "--label",
          "description",
          "--desc",
          description,
          "--github",
          "nobody",
          "--repo",
          "nowhere",
          "--dry-run",
          input,
        ],
        baseEnv(sandbox),
      );
      assert.equal(result.code, 1);
      assert.match(result.stderr, /Description scan refused/);
      assert.doesNotMatch(result.stderr, /synthetic-secret|alice/);
      assert.doesNotMatch(result.stdout, /Local preview written/);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  }
});

test("SVG active content and oversized supported text are refused", async () => {
  const sandbox = await makeSandbox("csm-upload-content-limits-");
  try {
    const svg = join(sandbox, "asset.svg");
    await writeFile(svg, '<svg onload="alert(1)"></svg>', "utf8");
    const svgResult = await runNode(
      [
        SCRIPT,
        "--label",
        "svg",
        "--github",
        "nobody",
        "--repo",
        "nowhere",
        "--dry-run",
        "--ack-unscanned-binary",
        svg,
      ],
      baseEnv(sandbox),
    );
    assert.equal(svgResult.code, 1);
    assert.match(svgResult.stderr, /Content scan refused/);

    const metadata = join(sandbox, "metadata.json");
    await writeFile(metadata, "x".repeat(1024 * 1024 + 1), "utf8");
    const metadataResult = await runNode(
      [
        SCRIPT,
        "--label",
        "metadata",
        "--github",
        "nobody",
        "--repo",
        "nowhere",
        "--dry-run",
        "--ack-unscanned-binary",
        metadata,
      ],
      baseEnv(sandbox),
    );
    assert.equal(metadataResult.code, 1);
    assert.match(metadataResult.stderr, /supported text limit/);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("source symlinks are refused even when the target is readable", async () => {
  const sandbox = await makeSandbox("csm-upload-source-symlink-");
  try {
    const target = join(sandbox, "target.bin");
    const input = join(sandbox, "upload.bin");
    await writeFile(target, Buffer.from([1, 2, 3]));
    await symlink(target, input);
    const result = await runNode(
      [
        SCRIPT,
        "--label",
        "symlink-source",
        "--github",
        "nobody",
        "--repo",
        "nowhere",
        "--dry-run",
        "--ack-unscanned-binary",
        input,
      ],
      baseEnv(sandbox),
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /symlinks are not allowed/);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("binary publication requires explicit unscanned-content acknowledgment", async () => {
  const sandbox = await makeSandbox("csm-upload-binary-policy-");
  try {
    const input = join(sandbox, "evidence.bin");
    await writeFile(input, Buffer.from([0, 1, 2, 3]));
    const refused = await runNode(
      [SCRIPT, "--label", "binary", "--github", "nobody", "--repo", "nowhere", "--dry-run", input],
      baseEnv(sandbox),
    );
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /binary content is unscanned/);

    const acknowledged = await runNode(
      [
        SCRIPT,
        "--label",
        "binary",
        "--github",
        "nobody",
        "--repo",
        "nowhere",
        "--dry-run",
        "--ack-unscanned-binary",
        input,
      ],
      baseEnv(sandbox),
    );
    assert.equal(acknowledged.code, 0, acknowledged.stderr);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("aggregate file-count limit is enforced before preview", async () => {
  const sandbox = await makeSandbox("csm-upload-count-limit-");
  try {
    const inputs = [];
    for (let i = 0; i < 33; i++) {
      const input = join(sandbox, `evidence-${i}.bin`);
      await writeFile(input, Buffer.from([i]));
      inputs.push(input);
    }
    const result = await runNode(
      [
        SCRIPT,
        "--label",
        "count",
        "--github",
        "nobody",
        "--repo",
        "nowhere",
        "--dry-run",
        "--ack-unscanned-binary",
        ...inputs,
      ],
      baseEnv(sandbox),
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /at most 32 input files/);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("configured pushurl is refused and push is never attempted", async () => {
  const sandbox = await makeSandbox("csm-upload-pushurl-");
  try {
    await makeCommandStubs(
      sandbox,
      `
      const fs = require('node:fs');
      const path = require('node:path');
      const args = process.argv.slice(2);
      if (process.argv[1].endsWith('/gh')) process.stdout.write('nobody\\n');
      if (args.includes('clone')) { fs.mkdirSync(path.join(args.at(-1), '.git'), { recursive: true }); }
      if (args.includes('remote') && args.includes('get-url')) process.stdout.write('https://github.com/nobody/nowhere.git\\n');
      if (args.includes('config')) process.stdout.write('remote.origin.pushurl https://github.com/nobody/other.git\\n');
      if (args.includes('status')) process.stdout.write(' M synthetic\\n');
      if (args.includes('push')) fs.writeFileSync(process.env.CSM_PUSH_MARKER, 'pushed');
      `,
    );
    const input = join(sandbox, "evidence.txt");
    await writeFile(input, "synthetic", "utf8");
    const result = await runNode(
      [
        SCRIPT,
        "--label",
        "pushurl",
        "--github",
        "nobody",
        "--repo",
        "nowhere",
        "--confirm-permanent",
        input,
      ],
      baseEnv(sandbox, { CSM_PUSH_MARKER: join(sandbox, "push.marker") }),
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /pushurl or URL rewrite/);
    await assert.rejects(access(join(sandbox, "push.marker")));
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("a destination config change after validation refuses publication before push", async () => {
  const sandbox = await makeSandbox("csm-upload-config-race-");
  try {
    await makeCommandStubs(
      sandbox,
      `
      const fs = require('node:fs');
      const path = require('node:path');
      const args = process.argv.slice(2);
      if (process.argv[1].endsWith('/gh')) process.stdout.write('nobody\\n');
      if (args.includes('clone')) fs.mkdirSync(path.join(args.at(-1), '.git'), { recursive: true });
      if (args.includes('remote') && args.includes('get-url')) process.stdout.write('https://github.com/nobody/nowhere.git\\n');
      if (args.includes('config')) {
        const marker = process.env.CSM_CONFIG_CHECKS;
        const count = Number(fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : 0) + 1;
        fs.writeFileSync(marker, String(count));
        if (count > 1) process.stdout.write('remote.origin.pushurl https://github.com/nobody/attacker.git\\n');
      }
      if (args.includes('status')) process.stdout.write(' M synthetic\\n');
      if (args.includes('push')) fs.writeFileSync(process.env.CSM_PUSH_MARKER, 'pushed');
      `,
    );
    const input = join(sandbox, "evidence.txt");
    await writeFile(input, "synthetic", "utf8");
    const result = await runNode(
      [
        SCRIPT,
        "--label",
        "config-race",
        "--github",
        "nobody",
        "--repo",
        "nowhere",
        "--confirm-permanent",
        input,
      ],
      baseEnv(sandbox, {
        CSM_CONFIG_CHECKS: join(sandbox, "config-checks"),
        CSM_PUSH_MARKER: join(sandbox, "push.marker"),
      }),
    );
    assert.equal(result.code, 1, result.stderr);
    assert.match(result.stderr, /pushurl or URL rewrite/);
    await assert.rejects(access(join(sandbox, "push.marker")));
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
