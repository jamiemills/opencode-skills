import { rename, unlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { EVENTS_JSONL_ROTATION } from './constants.mjs';
import { ensurePrivateDir, redactTelemetry, secureAppend } from './security.mjs';

const MAX_ROTATED = 3;

async function rotate(sessionDir, mainPath) {
  const ts = Date.now();
  const rotatedName = `events-${ts}.jsonl`;
  const rotatedPath = join(sessionDir, rotatedName);
  try { await rename(mainPath, rotatedPath); } catch {}

  try {
    const entries = await readdir(sessionDir);
    const rotated = entries
      .filter(e => e.startsWith('events-') && e.endsWith('.jsonl'))
      .toSorted();
    while (rotated.length > MAX_ROTATED) {
      await unlink(join(sessionDir, rotated.shift())).catch(() => {});
    }
  } catch {}
}

export async function collectorsHook(client, sessionId, sessionDir) {
  await ensurePrivateDir(sessionDir);
  const mainPath = join(sessionDir, 'events.jsonl');
  let count = 0;
  const buffer = [];
  let flushing = false;
  let writeQueue = Promise.resolve();

  // F-067-11a: bound the write path. Lines are buffered and flushed in
  // batches through a single serialized writer, so the promise chain stays
  // shallow even under bursts. The buffer itself is capped: past it, new
  // events are dropped instead of growing memory without limit. The cap sits
  // above EVENTS_JSONL_ROTATION so the documented "rotate after 2000 events"
  // contract still holds under normal load.
  const MAX_BUFFERED_LINES = EVENTS_JSONL_ROTATION * 2;
  const MAX_BATCH = 512;

  const flush = async () => {
    while (buffer.length > 0) {
      const batch = buffer.splice(0, MAX_BATCH);
      try {
        await secureAppend(mainPath, batch.join(''));
        count += batch.length;
        if (count >= EVENTS_JSONL_ROTATION) {
          count = 0;
          await rotate(sessionDir, mainPath);
        }
      } catch {}
    }
  };

  const enqueue = (entry) => {
    if (buffer.length >= MAX_BUFFERED_LINES) return;
    buffer.push(JSON.stringify(redactTelemetry(entry)) + '\n');
    if (!flushing) {
      flushing = true;
      writeQueue = writeQueue.then(flush).finally(() => { flushing = false; });
    }
  };

  const domains = ['Runtime', 'Log', 'Network', 'Performance'];
  for (const d of domains) {
    await client.send(`${d}.enable`, {}, sessionId);
  }

  client.on('Runtime.consoleAPICalled', (params) => {
    enqueue({
      ts: new Date().toISOString(),
      type: 'console',
        payload: redactTelemetry({
        type: params.type,
        args: params.args,
        stackTrace: params.stackTrace
        })
    });
  });

  client.on('Runtime.exceptionThrown', (params) => {
    enqueue({
      ts: new Date().toISOString(),
      type: 'exception',
      payload: redactTelemetry(params)
    });
  });

  client.on('Log.entryAdded', (params) => {
    enqueue({
      ts: new Date().toISOString(),
      type: 'log',
      payload: {
        source: params.entry.source,
        level: params.entry.level,
        text: redactTelemetry(params.entry.text)
      }
    });
  });

  client.on('Network.requestWillBeSent', (params) => {
    enqueue({
      ts: new Date().toISOString(),
      type: 'network',
      payload: {
        phase: 'request',
        requestId: params.requestId,
        url: redactTelemetry(params.request.url),
        type: params.type
      }
    });
  });

  client.on('Network.responseReceived', (params) => {
    enqueue({
      ts: new Date().toISOString(),
      type: 'network',
      payload: {
        phase: 'response',
        requestId: params.requestId,
        url: redactTelemetry(params.response.url),
        status: params.response.status,
        mimeType: params.response.mimeType
      }
    });
  });

  client.on('Network.loadingFinished', (params) => {
    enqueue({
      ts: new Date().toISOString(),
      type: 'network',
      payload: {
        phase: 'finished',
        requestId: params.requestId,
        encodedDataLength: params.encodedDataLength
      }
    });
  });

  client.on('Network.loadingFailed', (params) => {
    enqueue({
      ts: new Date().toISOString(),
      type: 'network',
      payload: {
        phase: 'failed',
        requestId: params.requestId,
        errorText: params.errorText
      }
    });
  });

  return {
    detach: async () => {
      for (const d of domains) {
        try { await client.send(`${d}.disable`, {}, sessionId); } catch {}
      }
    }
  };
}
