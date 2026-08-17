import test from 'node:test';
import assert from 'node:assert/strict';
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const SCRIPT = join(import.meta.dirname, '..', 'scripts', 'upload.mjs');

async function makeSandbox(prefix) {
  return await mkdtemp(join(tmpdir(), prefix));
}

async function runNode(args, env) {
  const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const [code, signal] = await once(child, 'close');
  return { code, signal, stdout, stderr };
}

function baseEnv(sandbox, extra = {}) {
  return {
    ...process.env,
    HOME: join(sandbox, 'home'),
    TMPDIR: sandbox,
    PATH: `${join(sandbox, 'bin')}:${process.env.PATH}`,
    ...extra,
  };
}

async function makeCommandStubs(sandbox, body) {
  const bin = join(sandbox, 'bin');
  await mkdir(bin, { recursive: true });
  const script = `#!/usr/bin/env node\n${body}`;
  for (const command of ['git', 'gh']) {
    const path = join(bin, command);
    await writeFile(path, script, 'utf8');
    await chmod(path, 0o700);
  }
}

test('dry-run uses a private exclusive preview and cannot follow the legacy symlink', async () => {
  const sandbox = await makeSandbox('csm-upload-test-');
  try {
    await makeCommandStubs(sandbox, `
      const fs = require('node:fs');
      fs.appendFileSync(process.env.CSM_OPS_LOG, process.argv.slice(2).join(' ') + '\\n');
    `);
    const input = join(sandbox, 'input.png');
    const target = join(sandbox, 'target.txt');
    const legacy = join(sandbox, `demo-${new Date().toISOString().split('T')[0]}-symlink.preview.html`);
    await writeFile(input, 'synthetic', 'utf8');
    await writeFile(target, 'unchanged', 'utf8');
    await symlink(target, legacy);
    const ops = join(sandbox, 'ops.log');
    const result = await runNode([SCRIPT, '--label', 'symlink', '--github', 'nobody', '--repo', 'nowhere', '--dry-run', input], baseEnv(sandbox, { CSM_OPS_LOG: ops }));
    assert.equal(result.code, 0, result.stderr);
    assert.equal(await readFile(target, 'utf8'), 'unchanged');
    assert.equal(await readFile(ops, 'utf8').catch(() => ''), '');

    const match = result.stdout.match(/Local preview written to: (.+)/);
    assert.ok(match, result.stdout);
    const preview = match[1].trim();
    assert.notEqual(preview, legacy);
    const previewDir = join(preview, '..');
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

test('SIGTERM stops clone, commit, and push children and removes temporary clones', async () => {
  for (const phase of ['clone', 'commit', 'push']) {
    const sandbox = await makeSandbox(`csm-upload-signal-${phase}-`);
    try {
      await makeCommandStubs(sandbox, `
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
      `);
      const input = join(sandbox, 'input.png');
      const clonePath = join(sandbox, 'clone.path');
      await writeFile(input, 'synthetic', 'utf8');
      await mkdir(join(sandbox, 'home', '.agents'), { recursive: true });
      await writeFile(join(sandbox, 'home', '.agents', 'csm-upload.json'), '{"github":"nobody","pagesRepo":"nowhere"}', 'utf8');
      const env = baseEnv(sandbox, { CSM_STUB_PHASE: phase, CSM_CLONE_PATH: clonePath });
      const child = spawn(process.execPath, [SCRIPT, '--label', `signal-${phase}`, '--github', 'nobody', '--repo', 'nowhere', input], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr += chunk; });
      const marker = join(sandbox, `${phase}.ready`);
      for (let i = 0; i < 100 && !(await access(marker).then(() => true, () => false)); i++) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      await access(marker).catch(error => {
        child.kill('SIGKILL');
        throw new Error(`${phase} marker missing: ${stderr || error.message}`);
      });
      child.kill('SIGTERM');
      const [code] = await once(child, 'close');
      assert.equal(code, 143, `${phase} did not exit for SIGTERM`);
      const clone = await readFile(clonePath, 'utf8');
      await assert.rejects(access(clone));
      assert.equal((await readdir(sandbox)).some(name => name.startsWith('csm-pages-')), false);
      const pid = Number(await readFile(marker, 'utf8'));
      assert.throws(() => process.kill(pid, 0), /ESRCH/);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  }
});
