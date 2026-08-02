import { randomUUID } from 'node:crypto';
import { writeFile, readFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { CMD_TIMEOUT_MS } from '../constants.mjs';

export async function run({ args, state, verb }) {
  if (verb !== 'screencast-start' && verb !== 'screencast-stop') {
    console.error(`Unknown verb: ${verb}. Expected screencast-start or screencast-stop`);
    process.exit(1);
  }

  const cmdDir = join(state.sessionDir, 'cmd');
  const outDir = join(cmdDir, 'out');

  await mkdir(outDir, { recursive: true });

  const uuid = randomUUID();
  const cmdPath = join(cmdDir, `${uuid}.json`);
  const outPath = join(outDir, `${uuid}.json`);
  const tmpCmdPath = cmdPath + '.tmp';

  if (verb === 'screencast-start') {
    if (args.length < 1) {
      console.error('Usage: screencast-start <name> [--small|--medium|--full]');
      process.exit(1);
    }
    const speedValue = args.indexOf('--speed') !== -1 ? args[args.indexOf('--speed') + 1] : null;
    const name = args.find(a => !a.startsWith('--') && a !== speedValue);
    let preset = 'medium';
    if (args.includes('--small')) preset = 'small';
    if (args.includes('--medium')) preset = 'medium';
    if (args.includes('--full')) preset = 'full';
    let speed = 'medium';
    if (args.includes('--speed')) {
      const si = args.indexOf('--speed');
      if (si !== -1 && args[si + 1]) {
        const v = args[si + 1];
        if (v === 'slow' || v === 'medium' || v === 'fast') speed = v;
      }
    }

    const cmd = {
      verb: 'screencast-start',
      params: { name, fps: 15, preset, speed },
      ts: new Date().toISOString()
    };

    await writeFile(tmpCmdPath, JSON.stringify(cmd), 'utf-8');
    await rename(tmpCmdPath, cmdPath);
  } else {
    const cmd = {
      verb: 'screencast-stop',
      params: {},
      ts: new Date().toISOString()
    };

    await writeFile(tmpCmdPath, JSON.stringify(cmd), 'utf-8');
    await rename(tmpCmdPath, cmdPath);
  }

  const start = Date.now();
  let result = null;

  while (Date.now() - start < CMD_TIMEOUT_MS) {
    try {
      const raw = await readFile(outPath, 'utf-8');
      result = JSON.parse(raw);
      break;
    } catch {
      await setTimeout(200);
    }
  }

  if (!result) {
    console.error('Daemon unavailable or timed out');
    process.exit(1);
  }

  if (result.ok) {
    if (verb === 'screencast-start') {
      if (result.result && result.result.already_recording) {
        console.error('Already recording');
        process.exit(1);
      }
      console.log('Recording started');
    } else {
      if (!result.result) {
        console.error('Not recording');
        process.exit(1);
      }
      console.log(JSON.stringify(result.result));
    }
  } else {
    if (result.error === 'already recording') {
      console.error('Already recording');
      process.exit(1);
    } else if (result.error === 'not recording') {
      console.error('Not recording');
      process.exit(1);
    } else {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }
  }
}
