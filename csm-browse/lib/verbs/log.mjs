import { readFileSync, existsSync, createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

async function readEvents(sessionDir) {
  const events = [];
  const files = [];

  const mainPath = join(sessionDir, 'events.jsonl');
  if (existsSync(mainPath)) {
    files.push(mainPath);
  }

  try {
    const entries = await readdir(sessionDir);
    entries
      .filter(e => e.startsWith('events-') && e.endsWith('.jsonl'))
      .sort()
      .forEach(e => files.push(join(sessionDir, e)));
  } catch {}

  for (const file of files) {
    const rl = createInterface({
      input: createReadStream(file),
      crlfDelay: Infinity
    });
    for await (const line of rl) {
      if (line.trim()) {
        try {
          events.push(JSON.parse(line));
        } catch {}
      }
    }
  }

  return events;
}

async function hasAnyEventsFile(sessionDir) {
  if (existsSync(join(sessionDir, 'events.jsonl'))) return true;
  try {
    const entries = await readdir(sessionDir);
    return entries.some(e => e.startsWith('events-') && e.endsWith('.jsonl'));
  } catch {
    return false;
  }
}

function isDaemonAlive(sessionDir) {
  const pidFile = join(sessionDir, 'daemon.pid');
  if (!existsSync(pidFile)) return false;
  try {
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseNumericArg(args, flag) {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) {
    const val = parseInt(args[idx + 1], 10);
    if (!isNaN(val)) return val;
  }
  return null;
}

function parseStringArg(args, flag) {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return null;
}

function subConsole(args, sessionDir) {
  const tail = parseNumericArg(args, '--tail');

  return readEvents(sessionDir).then(events => {
    if (events.length === 0) {
      const exists = hasAnyEventsFile(sessionDir);
      if (!exists) {
        console.error('no events file — capture not started');
        process.exit(2);
        return;
      }
    }

    if (!isDaemonAlive(sessionDir)) {
      console.error('daemon down — capture gap');
    }

    let filtered = events.filter(e =>
      e.type === 'console' || e.type === 'exception' || e.type === 'log'
    );

    if (tail !== null && tail > 0) {
      filtered = filtered.slice(-tail);
    }

    process.stdout.write(JSON.stringify(filtered, null, 2) + '\n');
  });
}

function subNetwork(args, sessionDir) {
  const tail = parseNumericArg(args, '--tail');
  const filterStr = parseStringArg(args, '--filter');

  return readEvents(sessionDir).then(events => {
    if (events.length === 0) {
      const exists = hasAnyEventsFile(sessionDir);
      if (!exists) {
        console.error('no events file — capture not started');
        process.exit(2);
        return;
      }
    }

    if (!isDaemonAlive(sessionDir)) {
      console.error('daemon down — capture gap');
    }

    let filtered = events.filter(e => e.type === 'network');

    if (filterStr) {
      const re = new RegExp(filterStr, 'i');
      filtered = filtered.filter(e =>
        e.payload && e.payload.url && re.test(e.payload.url)
      );
    }

    if (tail !== null && tail > 0) {
      filtered = filtered.slice(-tail);
    }

    process.stdout.write(JSON.stringify(filtered, null, 2) + '\n');
  });
}

async function subPerformance(state) {
  const CRI = await import('chrome-remote-interface');
  const client = await CRI.default({ target: state.wsUrl });

  try {
    const { targetInfos } = await client.send('Target.getTargets');
    const pages = targetInfos.filter(t => t.type === 'page');
    if (pages.length === 0) throw new Error('No page target found');

    const { sessionId } = await client.send('Target.attachToTarget', {
      targetId: pages[0].targetId,
      flatten: true
    });

    await client.send('Performance.enable', {}, sessionId);
    const result = await client.send('Performance.getMetrics', {}, sessionId);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  } finally {
    try { await client.close(); } catch {}
  }
}

async function subCookies(state) {
  const CRI = await import('chrome-remote-interface');
  const client = await CRI.default({ target: state.wsUrl });

  let sessionId;
  try {
    const { targetInfos } = await client.send('Target.getTargets');
    const pages = targetInfos.filter(t => t.type === 'page');
    if (pages.length === 0) throw new Error('No page target found');

    const currentUrl = pages[0].url;

    const attachResult = await client.send('Target.attachToTarget', {
      targetId: pages[0].targetId,
      flatten: true
    });
    sessionId = attachResult.sessionId;

    const result = await client.send('Network.getCookies', {
      urls: currentUrl ? [currentUrl] : []
    }, sessionId);

    process.stdout.write(JSON.stringify(result.cookies, null, 2) + '\n');
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  } finally {
    try { await client.close(); } catch {}
  }
}

export async function run({ args, state }) {
  if (args.length === 0) {
    console.error('Usage: log <console|network|performance|cookies> [options]');
    process.exit(1);
  }

  const subVerb = args[0];
  const rest = args.slice(1);

  switch (subVerb) {
    case 'console':
      await subConsole(rest, state.sessionDir);
      break;
    case 'network':
      await subNetwork(rest, state.sessionDir);
      break;
    case 'performance':
      await subPerformance(state);
      break;
    case 'cookies':
      await subCookies(state);
      break;
    default:
      console.error(`Unknown sub-verb: ${subVerb}`);
      process.exit(1);
  }
}
