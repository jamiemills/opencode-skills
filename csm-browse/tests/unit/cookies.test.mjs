import test from 'node:test';
import assert from 'node:assert/strict';
import { dismissCookies } from '../../lib/cookies.mjs';

const ACCEPT_TEXTS = [
  'accept all', 'accept', 'agree', 'allow all', 'allow',
  'ok', 'yes', 'i accept', 'agree & proceed', 'continue',
];

// Stub CDP client: an EventEmitter-ish recorder. Runtime.evaluate replies are
// routed by the shape of the generated expression so every consent pattern
// sees the response its real branch expects.
function makeClient(opts = {}) {
  const calls = [];
  const handlers = new Map();
  const client = {
    calls,
    on(ev, fn) { if (!handlers.has(ev)) handlers.set(ev, []); handlers.get(ev).push(fn); },
    off(ev, fn) {
      const list = handlers.get(ev) || [];
      const i = list.indexOf(fn);
      if (i !== -1) list.splice(i, 1);
    },
    emit(ev, params) { for (const fn of [...(handlers.get(ev) || [])]) fn(params); },
    listenerCount(ev) { return (handlers.get(ev) || []).length; },
    async send(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      if (method === 'Runtime.evaluate') {
        const e = params.expression;
        if (e.includes('iframe[src*="sourcepoint"]')) return { result: { value: 'not found' } };
        if (e.includes('var out=[]')) return { result: { value: opts.walls ?? [] } };
        if (e.includes("querySelectorAll('button,a,[role=\"button\"]')")) {
          return { result: { value: opts.wallClick ?? 'no match' } };
        }
        if (e.includes('texts=[')) return { result: { value: opts.clickResult ?? 'no match' } };
        return { result: { value: 'removed' } };
      }
      if (method === 'Runtime.enable' && opts.emitContext) {
        queueMicrotask(() => client.emit('Runtime.executionContextCreated', {
          context: { id: 42, auxData: { frameId: 'frame-wall' } },
        }));
      }
      if (method === 'Page.getFrameTree') {
        return { frameTree: { frame: { id: 'frame-wall', url: opts.wallUrl ?? 'https://sp-prod.example.net/index.html' }, childFrames: [] } };
      }
      return {};
    },
  };
  return client;
}

const evaluates = (client) => client.calls.filter((c) => c.method === 'Runtime.evaluate');

test('all OneTrust selectors are evaluated and sessionId is passed through', async () => {
  const client = makeClient();
  await dismissCookies(client, 'sess-x');
  const selectors = ['#onetrust-banner-sdk', '#onetrust-consent-sdk', '.onetrust-pc-dark-filter', '.ot-sdk-container'];
  for (const sel of selectors) {
    assert.ok(
      evaluates(client).some((c) => c.params.expression.includes(`document.querySelector('${sel}')`)),
      `missing OneTrust evaluate for ${sel}`
    );
  }
  for (const call of evaluates(client)) {
    assert.equal(call.sessionId, 'sess-x');
  }
});

test('sourcepoint iframe-hiding pattern is emitted', async () => {
  const client = makeClient();
  await dismissCookies(client, 's');
  assert.ok(evaluates(client).some((c) =>
    c.params.expression.includes('iframe[src*="sourcepoint"]') &&
    c.params.expression.includes('iframe[src*="privacy-mgmt"]')));
});

test('generic click pattern embeds every accept text', async () => {
  const client = makeClient();
  await dismissCookies(client, 's');
  const generic = evaluates(client).find((c) => c.params.expression.includes('texts=[') && c.params.expression.includes('button,[role="button"],a.button'));
  assert.ok(generic, 'generic accept-click evaluate missing');
  for (const t of ACCEPT_TEXTS) {
    assert.ok(generic.params.expression.includes(`"${t}"`), `accept text "${t}" not embedded`);
  }
});

test('fixed privacy-overlay removal pattern is emitted', async () => {
  const client = makeClient();
  await dismissCookies(client, 's');
  assert.ok(evaluates(client).some((c) =>
    c.params.expression.includes('position===' + '\'fixed\'') && c.params.expression.includes('privacy')));
});

test('no consent wall found: returns early, no context work, no wall removal', async () => {
  const client = makeClient({ walls: [] });
  await dismissCookies(client, 's');
  const evals = evaluates(client);
  // 4 onetrust + 1 sourcepoint + 1 generic click + 1 overlay + 1 wall detect
  assert.equal(evals.length, 8);
  assert.ok(!client.calls.some((c) => c.method === 'Runtime.enable'));
  assert.ok(!evals.some((c) => c.params.expression.includes('removed=' + 'n')), 'wall-removal ran without a wall');
  assert.ok(!client.calls.some((c) => c.method === 'Page.getFrameTree'));
});

test('no matching accept text: single generic attempt, no dismissal value', async () => {
  const client = makeClient({ clickResult: 'no match' });
  await dismissCookies(client, 's');
  const generic = evaluates(client).filter((c) => c.params.expression.includes('button,[role="button"],a.button'));
  assert.equal(generic.length, 1);
});

test('consent wall path: frame context click + scroll-unlock removal', async () => {
  const client = makeClient({ walls: ['https://cmpv2.example.org/wall'], emitContext: true, wallClick: 'clicked' });
  await dismissCookies(client, 'sess-w');
  assert.ok(client.calls.some((c) => c.method === 'Runtime.enable'));
  assert.ok(client.calls.some((c) => c.method === 'Page.enable'));
  const ctxEval = evaluates(client).find((c) => c.params.contextId !== undefined);
  assert.ok(ctxEval, 'in-context accept click evaluate missing');
  assert.equal(ctxEval.params.contextId, 42);
  assert.equal(ctxEval.sessionId, 'sess-w');
  const removal = evaluates(client).find((c) => c.params.expression.includes("'removed='+n"));
  assert.ok(removal, 'wall-iframe removal pattern missing');
  assert.ok(removal.params.expression.includes('overflow'));
  // listener registered during the pattern is removed afterwards
  assert.equal(client.listenerCount('Runtime.executionContextCreated'), 0);
});
