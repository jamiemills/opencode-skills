import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { EXIT_CODES, runProtocol } from './engine.mjs';
import { loadReportSchema, validateSchema } from './report-schema.mjs';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const sha256 = data => createHash('sha256').update(data).digest('hex');
const capable = { hasNpx: true, hasFileWrite: true, knowsDestination: true, supportsStaging: true, supportsLock: true, supportsRollback: true, knowsReload: true };
const capableInput = overrides => ({ capabilities: capable, trustRootApproved: true, ...overrides });
const loadIndex = async () => JSON.parse(await readFile(join(root, 'bootstrap/payload-index.json'), 'utf8'));
const destinationFault = mode => {
  let finalized = 0;
  return {
    copyFile: async (source, target, fileMode) => {
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await copyFile(source, target);
      finalized += 1;
      if (finalized >= 5) {
        if (mode === 'tamper') await writeFile(target, 'corrupted finalize bytes');
        else throw new Error('injected finalize failure');
      }
    }
  };
};

test('transport failure mid-copy interrupts, cleans staging, and leaves the destination unchanged', async () => {
  const sandbox = await mkdtemp('/tmp/csm-protocol-'); await chmod(sandbox, 0o700);
  try {
    const destination = join(sandbox, 'skills');
    await mkdir(destination, { mode: 0o700 });
    await writeFile(join(destination, 'user-file.txt'), 'pre-existing\n', { mode: 0o644 });
    let copied = 0;
    const transport = {
      copyFile: async (source, target, mode) => {
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        if (copied >= 3) {
          await writeFile(target, 'partial bytes');
          throw new Error('injected transport failure');
        }
        await copyFile(source, target);
        copied += 1;
      }
    };
    const result = await runProtocol(capableInput({ destination, sandbox, transport }));
    assert.equal(result.exitCode, EXIT_CODES.E_INTERRUPTED);
    assert.deepEqual(result.report.refusal, { code: 'E_INTERRUPTED', state: 'MATERIALIZE' });
    assert.equal(result.report.destination, null);
    const schema = await loadReportSchema();
    assert.deepEqual(validateSchema(result.report, schema), []);
    assert.deepEqual(await readdir(destination), ['user-file.txt']);
    assert.equal(await readFile(join(destination, 'user-file.txt'), 'utf8'), 'pre-existing\n');
    assert.deepEqual((await readdir(sandbox)).sort(), ['skills']);
  } finally { await rm(sandbox, { recursive: true, force: true }); }
});

test('tampered staged file fails hash verification and the destination is never finalized', async () => {
  const sandbox = await mkdtemp('/tmp/csm-protocol-'); await chmod(sandbox, 0o700);
  try {
    const destination = join(sandbox, 'skills');
    const transport = {
      copyFile: async (source, target, mode) => {
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await copyFile(source, target);
        if (basename(target) === 'SKILL.md' && target.includes(join('staging', 'csm-plan'))) {
          await writeFile(target, `${await readFile(target)}tampered`);
        }
      }
    };
    const result = await runProtocol(capableInput({ destination, sandbox, transport }));
    assert.equal(result.exitCode, EXIT_CODES.E_HASH_MISMATCH);
    assert.deepEqual(result.report.refusal, { code: 'E_HASH_MISMATCH', state: 'VERIFY' });
    const schema = await loadReportSchema();
    assert.deepEqual(validateSchema(result.report, schema), []);
    assert.deepEqual(result.report.filesPlaced, []);
    assert.deepEqual(result.report.hashVerification, { algorithm: 'sha256', verified: 0, total: 0 });
    assert.deepEqual((await readdir(sandbox)).sort(), []);
  } finally { await rm(sandbox, { recursive: true, force: true }); }
});

test('placed hash mismatch on an unmanaged destination removes every newly written file', async () => {
  const sandbox = await mkdtemp('/tmp/csm-protocol-'); await chmod(sandbox, 0o700);
  try {
    const destination = join(sandbox, 'skills');
    const result = await runProtocol(capableInput({ destination, sandbox, finalizeTransport: destinationFault('tamper') }));
    assert.equal(result.exitCode, EXIT_CODES.E_HASH_MISMATCH);
    assert.deepEqual(result.report.refusal, { code: 'E_HASH_MISMATCH', state: 'VERIFY' });
    const schema = await loadReportSchema();
    assert.deepEqual(validateSchema(result.report, schema), []);
    assert.deepEqual((await readdir(destination)).sort(), []);
    assert.deepEqual((await readdir(sandbox)).sort(), ['skills']);
  } finally { await rm(sandbox, { recursive: true, force: true }); }
});

test('finalize transport failure on an unmanaged destination interrupts with zero net mutation', async () => {
  const sandbox = await mkdtemp('/tmp/csm-protocol-'); await chmod(sandbox, 0o700);
  try {
    const destination = join(sandbox, 'skills');
    const result = await runProtocol(capableInput({ destination, sandbox, finalizeTransport: destinationFault('throw') }));
    assert.equal(result.exitCode, EXIT_CODES.E_INTERRUPTED);
    assert.deepEqual(result.report.refusal, { code: 'E_INTERRUPTED', state: 'MATERIALIZE' });
    const schema = await loadReportSchema();
    assert.deepEqual(validateSchema(result.report, schema), []);
    assert.deepEqual((await readdir(destination)).sort(), []);
  } finally { await rm(sandbox, { recursive: true, force: true }); }
});

test('finalize failure on an unmanaged destination preserves identical pre-existing files', async () => {
  const sandbox = await mkdtemp('/tmp/csm-protocol-'); await chmod(sandbox, 0o700);
  try {
    const destination = join(sandbox, 'skills');
    const index = await loadIndex();
    const planEntry = index.classes.skills.find(entry => entry.path === 'payload/skills/csm-plan/SKILL.md');
    await mkdir(join(destination, 'csm-plan'), { recursive: true, mode: 0o700 });
    const identical = await readFile(join(root, 'bootstrap/package/payload/skills/csm-plan/SKILL.md'));
    await writeFile(join(destination, 'csm-plan', 'SKILL.md'), identical, { mode: 0o644 });
    const result = await runProtocol(capableInput({ destination, sandbox, finalizeTransport: destinationFault('throw') }));
    assert.equal(result.exitCode, EXIT_CODES.E_INTERRUPTED);
    assert.deepEqual(result.report.refusal, { code: 'E_INTERRUPTED', state: 'MATERIALIZE' });
    assert.equal(sha256(await readFile(join(destination, 'csm-plan', 'SKILL.md'))), planEntry.sha256);
    assert.deepEqual((await readdir(destination)).sort(), ['csm-plan']);
  } finally { await rm(sandbox, { recursive: true, force: true }); }
});

test('placed hash mismatch on a managed destination restores the prior install from backup', async () => {
  const sandbox = await mkdtemp('/tmp/csm-protocol-'); await chmod(sandbox, 0o700);
  try {
    const destination = join(sandbox, 'skills');
    const first = await runProtocol(capableInput({ destination, sandbox }));
    assert.equal(first.exitCode, 0);
    const index = await loadIndex();
    const planEntry = index.classes.skills.find(entry => entry.path === 'payload/skills/csm-plan/SKILL.md');
    const managedFile = join(destination, 'csm-plan', 'SKILL.md');
    const beforeFault = await readFile(managedFile);
    assert.equal(sha256(beforeFault), planEntry.sha256);
    const result = await runProtocol(capableInput({ destination, sandbox, finalizeTransport: destinationFault('tamper') }));
    assert.equal(result.exitCode, EXIT_CODES.E_HASH_MISMATCH);
    assert.deepEqual(result.report.refusal, { code: 'E_HASH_MISMATCH', state: 'VERIFY' });
    const schema = await loadReportSchema();
    assert.deepEqual(validateSchema(result.report, schema), []);
    assert.equal(sha256(await readFile(managedFile)), planEntry.sha256);
    assert.equal(sha256(await readFile(join(sandbox, 'backup', 'csm-plan', 'SKILL.md'))), planEntry.sha256);
    assert.equal(result.report.limitations.includes('restore-failed'), false);
  } finally { await rm(sandbox, { recursive: true, force: true }); }
});
