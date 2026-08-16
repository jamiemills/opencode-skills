// Drives lib/daemon-core.mjs's startQueueLoop in a child process: the loop
// polls forever and never returns, so it cannot be awaited in-process without
// hanging the node:test runner. Run as:
//   node queue-runner.mjs <sessionDir> <resultFile>
// Writes a JSON result (inside <sessionDir> so nothing escapes the test root)
// and exits.
//
// The queue's success verb is screencast-start/stop; with no active recording
// a screencast-stop deterministically resolves to {ok:false, error:'not
// recording'} without touching ffmpeg or CDP, so it is the lightweight
// vehicle for queue mechanics. Per-command out-files are keyed by the command
// uuid, and processing ORDER is observed via fs.watch rename events on out/
// (inotify preserves event order), replacing the goto handler removed by
// T012/F-066.
import { mkdir, writeFile, readFile, utimes, readdir } from 'node:fs/promises';
import { watch } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const [, , sessionDirArg, resultFileArg] = process.argv;
if (!sessionDirArg || !resultFileArg) process.exit(3);

const { startQueueLoop } = await import('../../../lib/daemon-core.mjs');

const cmdDir = join(sessionDirArg, 'cmd');
const runningDir = join(cmdDir, 'running');
const outDir = join(cmdDir, 'out');
await mkdir(runningDir, { recursive: true });
await mkdir(outDir, { recursive: true });

const STALE = '1111111111111-aaaaaaaa-0000-0000-0000-000000000001.json';
const FIRST = '9999999999999-bbbbbbbb-0000-0000-0000-000000000002.json'; // filename sorts LAST
const SECOND = '0000000000000-cccccccc-0000-0000-0000-000000000003.json'; // filename sorts FIRST
const BROKEN = '1234567890123-dddddddd-0000-0000-0000-000000000004.json';

// Out-file appearance order for FIRST/SECOND, observed via rename events.
const processedOrder = [];
const watcher = watch(outDir, (event, filename) => {
  if (event === 'rename' && (filename === FIRST || filename === SECOND)) {
    if (!processedOrder.includes(filename)) processedOrder.push(filename);
  }
});

const client = {
  async send() { return {}; },
  on() {},
  off() {},
};

// A running/ claim left by a daemon that died mid-execution (older than
// CMD_TIMEOUT_MS) must be turned into an error out-file at loop start.
await writeFile(join(runningDir, STALE), JSON.stringify({ verb: 'screencast-stop', params: {} }));
const old = new Date(Date.now() - 60000);
await utimes(join(runningDir, STALE), old, old);

// Two screencast-stop commands whose FILENAME order opposes their payload
// `ts` order: only ts-ordered processing completes FIRST before SECOND
// (observed as the out-file rename order above).
await writeFile(join(cmdDir, FIRST), JSON.stringify({ verb: 'screencast-stop', ts: '2026-01-01T00:00:00.001Z', params: {} }));
await writeFile(join(cmdDir, SECOND), JSON.stringify({ verb: 'screencast-stop', ts: '2026-01-01T00:00:02.000Z', params: {} }));
// A malformed command file: must produce an error out-file and be unlinked.
await writeFile(join(cmdDir, BROKEN), 'not-json{{{');

startQueueLoop(client, 'sess', sessionDirArg).catch(() => {});

async function readJson(p) {
  try { return JSON.parse(await readFile(p, 'utf-8')); } catch { return undefined; }
}

let result = {};
const deadline = Date.now() + 15000;
for (;;) {
  const staleOut = await readJson(join(outDir, STALE));
  const firstOut = await readJson(join(outDir, FIRST));
  const secondOut = await readJson(join(outDir, SECOND));
  const brokenOut = await readJson(join(outDir, BROKEN));
  if (staleOut && firstOut && secondOut && brokenOut) {
    const entries = await readdir(cmdDir);
    const runningEntries = await readdir(runningDir);
    result = {
      processedOrder,
      first: FIRST,
      second: SECOND,
      staleOut,
      firstOut,
      secondOut,
      brokenOut,
      cmdJsonLeft: entries.filter((e) => e.endsWith('.json')).length,
      runningLeft: runningEntries.length,
      dirsSurvive: entries.includes('running') && entries.includes('out'),
    };
    break;
  }
  if (Date.now() > deadline) break;
  await sleep(50);
}

watcher.close();
await writeFile(resultFileArg, JSON.stringify(result, null, 2));
process.exit(0);
