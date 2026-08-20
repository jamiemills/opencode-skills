// T010 / F-032 — direct unit tests for lib/scan/report/verbose-trace.mjs
// (CLI-only module, previously zero direct tests; F-051 gives every trace a
// per-run-unique name so concurrent scans can never clobber a shared path).

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';

import { openVerboseTrace, createVerboseReporter } from '../lib/scan/report/verbose-trace.mjs';

test('openVerboseTrace writes a per-run-unique trace next to --out when its directory exists', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'csm-scan-trace-'));
  try {
    const trace = openVerboseTrace(join(dir, 'NORMS.md'));
    assert.equal(basename(trace.path).startsWith('.csm-scan-debug-'), true,
      `trace name must be per-run-unique: ${trace.path}`);
    assert.match(basename(trace.path), /\.log$/, 'trace name must end in .log');
    assert.equal(trace.path, join(dir, basename(trace.path)), 'the trace must sit next to --out');
    assert.equal(typeof trace.stream.write, 'function');
    trace.stream.destroy();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('openVerboseTrace falls back to the OS temp directory with a unique name when the out dir is missing', async () => {
  const missing = join(tmpdir(), `csm-scan-trace-missing-${process.pid}-${Date.now()}`);
  const trace = openVerboseTrace(join(missing, 'NORMS.md'));
  try {
    assert.equal(trace.path, join(tmpdir(), basename(trace.path)), 'the trace must fall back to the OS temp directory');
    assert.equal(basename(trace.path).startsWith('.csm-scan-debug-'), true,
      `fallback trace name must stay per-run-unique: ${trace.path}`);
    trace.stream.destroy();
  } finally {
    await rm(trace.path, { force: true });
  }
});

function baseReporter() {
  const calls = [];
  const base = { calls };
  for (const method of ['info', 'progress', 'observation', 'note', 'inferred', 'coverage', 'error', 'warning']) {
    base[method] = (line) => { calls.push(`${method}:${line}`); };
  }
  base.phase = (line) => { calls.push(`phase:${line}`); };
  return base;
}

test('createVerboseReporter fans every reporter method through the trace and base', () => {
  const base = baseReporter();
  const traceLines = [];
  const debug = { stream: { write: (chunk) => { traceLines.push(String(chunk)); return true; } } };
  const reporter = createVerboseReporter(base, debug);

  reporter.info('one');
  reporter.warning('two');
  reporter.phase('render');
  reporter.observation('three');
  reporter.coverage('cover');
  reporter.note('note');
  reporter.inferred('infer');
  reporter.progress('prog');
  reporter.error('err');
  reporter.traceEnd();

  assert.deepEqual(base.calls, [
    'info:one', 'warning:two', 'phase:render', 'observation:three', 'coverage:cover',
    'note:note', 'inferred:infer', 'progress:prog', 'error:err',
  ]);
  assert.ok(traceLines.some((line) => line.includes('info: one')));
  assert.ok(traceLines.some((line) => line.includes('warning: two')));
  assert.ok(traceLines.some((line) => line.includes('observation: three')));
  assert.ok(traceLines.some((line) => line.includes('stage-end "pipeline-start"')));
  assert.ok(traceLines.some((line) => line.includes('stage-begin "render"')));
  assert.ok(traceLines.some((line) => line.includes('stage-end "render"')));
  assert.equal(traceLines[traceLines.length - 1].includes('pipeline-end'), true);
  for (const line of traceLines) {
    assert.match(line, /^\d{4}-\d{2}-\d{2}T.*\+\d+ms /, `trace line must carry an ISO timestamp and elapsed ms: ${line}`);
  }
});
