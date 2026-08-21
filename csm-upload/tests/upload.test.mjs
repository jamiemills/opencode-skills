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
      [SCRIPT, "--label", "symlink", "--github", "nobody", "--repo", "nowhere", "--dry-run", input],
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
        const operation = args.includes('clone') ? 'clone' : args.includes('status') ? 'status' : args.includes('commit') ? 'commit' : args.includes('push') ? 'push' : 'other';
        const mark = name => fs.writeFileSync(path.join(process.env.TMPDIR, name), String(process.pid));
        if (operation === 'clone') {
          const destination = args.at(-1);
          fs.mkdirSync(path.join(destination, '.git'), { recursive: true });
          fs.writeFileSync(process.env.CSM_CLONE_PATH, destination);
          if (phase === 'clone') mark('clone.ready');
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
        [SCRIPT, "--label", `signal-${phase}`, "--github", "nobody", "--repo", "nowhere", input],
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
      [SCRIPT, "--label", "bad", "--github", "nobody@evil.com", "--repo", "nowhere", input],
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
      [SCRIPT, "--label", "bad", "--github", "nobody", "--repo", "bad/repo", input],
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

test("F-068: real-remote happy-path upload against a local bare stub remote (url.insteadOf, no network)", async () => {
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
    const env = baseEnv(sandbox, { GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" });
    await execFileAsync("git", ["init", "--bare", bareRepo], { env });

    const gitconfig = `[user]\n\tname = csm-upload test\n\temail = upload@test.local\n[url "file://${remotesBase}/"]\n\tinsteadOf = https://github.com/\n`;
    await mkdir(join(sandbox, "home"), { recursive: true });
    await writeFile(join(sandbox, "home", ".gitconfig"), gitconfig, "utf8");

    const input = join(sandbox, "input.png");
    await writeFile(input, "synthetic", "utf8");

    const result = await runNode(
      [SCRIPT, "--label", "happy", "--github", "nobody", "--repo", "nowhere", input],
      env,
    );
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Pushed/);

    const configDir = join(sandbox, "home", ".agents");
    const configFile = join(configDir, "csm-upload.json");
    assert.equal((await stat(configDir)).mode & 0o777, 0o700, "config dir must be 0700");
    assert.equal((await stat(configFile)).mode & 0o777, 0o600, "config file must be 0600");
    assert.equal(JSON.parse(await readFile(configFile, "utf8")).github, "nobody");

    const checkout = join(sandbox, "checkout");
    await execFileAsync("git", ["clone", bareRepo, checkout], { env });
    const demo = `demo-${new Date().toISOString().split("T")[0]}-happy`;
    const html = await readFile(join(checkout, demo, "index.html"), "utf8");
    assert.match(html, /<img src="input\.png"/);
    assert.ok((await stat(join(checkout, demo, "input.png"))).isFile());
    assert.match(result.stdout, new RegExp(`https://nobody\\.github\\.io/nowhere/${demo}/`));
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
