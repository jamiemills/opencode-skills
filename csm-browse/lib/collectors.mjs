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
      .sort();
    while (rotated.length > MAX_ROTATED) {
      await unlink(join(sessionDir, rotated.shift())).catch(() => {});
    }
  } catch {}
}

export async function collectorsHook(client, sessionId, sessionDir) {
  await ensurePrivateDir(sessionDir);
  const mainPath = join(sessionDir, 'events.jsonl');
  let count = 0;
  let writeQueue = Promise.resolve();

  const enqueue = (entry) => {
    writeQueue = writeQueue.then(async () => {
      try {
        await secureAppend(mainPath, JSON.stringify(redactTelemetry(entry)) + '\n');
        count++;
        if (count >= EVENTS_JSONL_ROTATION) {
          count = 0;
          await rotate(sessionDir, mainPath);
        }
      } catch {}
    });
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
