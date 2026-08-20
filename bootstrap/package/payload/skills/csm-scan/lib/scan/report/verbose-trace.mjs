// F-075 --verbose diagnostic trace: an UNREDACTED, local-only trace file for
// debugging scan runs. Registered as a filesystem special reader in
// test/baselines/expansion/capabilities.json — this trace write is
// deliberate: redaction would destroy the diagnostic value, so it lives
// here, outside the sanitized reporter boundary, writing ONLY to the trace
// file (mode 0600, `.csm-scan-debug.log` next to --out, tmpdir fallback),
// never to stdout or stderr.
import { createWriteStream, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';

const TRACE_PREFIX = '.csm-scan-debug';

// F-051: per-run-unique trace name so two concurrent scans can never clobber
// the shared `.csm-scan-debug.log` path. The `.gitignore` entry for the prefix
// keeps an unredacted trace out of `git add .`. A monotonic counter disambiguates
// two opens in the same millisecond; pid + time36 disambiguate across processes.
let traceCounter = 0;

function traceFileName() {
  const stamp = `${process.pid}-${Date.now().toString(36)}-${traceCounter}`;
  traceCounter += 1;
  return `${TRACE_PREFIX}-${stamp}.log`;
}

export function openVerboseTrace(outPath) {
  const candidates = [];
  try {
    if (statSync(dirname(outPath)).isDirectory()) {
      candidates.push(join(dirname(outPath), traceFileName()));
    }
  } catch {}
  candidates.push(join(tmpdir(), traceFileName()));
  const path = candidates[0];
  const stream = createWriteStream(path, { flags: 'wx', mode: 0o600 });
  stream.on('error', () => {});
  return { path, stream };
}

// Fans every reporter call out to the trace file. phase() calls mark
// pipeline stage boundaries; each boundary records the elapsed
// performance.now() duration of the stage that just ended.
export function createVerboseReporter(base, debug) {
  const t0 = performance.now();
  let stage = 'pipeline-start';
  let stageStart = t0;
  const trace = (text) => {
    debug.stream.write(`${new Date().toISOString()} +${Math.round(performance.now() - t0)}ms ${text}\n`);
  };
  const boundary = (label) => {
    const now = performance.now();
    trace(`stage-end ${JSON.stringify(stage)} durationMs=${Math.round(now - stageStart)}`);
    stage = label;
    stageStart = now;
    trace(`stage-begin ${JSON.stringify(stage)}`);
  };
  const wrap = (method) => (line) => {
    trace(`${method}: ${line}`);
    return base[method](line);
  };
  const reporter = {};
  for (const method of ['info', 'progress', 'observation', 'note', 'inferred', 'coverage', 'error', 'warning']) {
    reporter[method] = wrap(method);
  }
  reporter.phase = (line) => {
    boundary(line);
    return base.phase(line);
  };
  reporter.traceEnd = () => {
    const now = performance.now();
    trace(`stage-end ${JSON.stringify(stage)} durationMs=${Math.round(now - stageStart)}`);
    trace('pipeline-end');
  };
  return reporter;
}
