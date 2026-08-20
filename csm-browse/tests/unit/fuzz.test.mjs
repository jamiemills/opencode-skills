import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSessionsRoot, removeRoot } from './helpers/env.mjs';

// F-042: dependency-free, seeded, bounded fuzz harness over the gate's
// request-line parser. Properties:
//   1. checkRequestLine NEVER throws on any string — every line is either
//      parsed (ok:true) or cleanly rejected (ok:false).
//   2. An accepted non-static line MUST embed the exact expected token
//      (re-parsed from the gate's own target string) — no wrong-token accept.
//   3. The harness is deterministic: a fixed seed reproduces the same input
//      sequence, so any failure is reproducible without flaky randomness.
const root = await freshSessionsRoot('csm-browse-fuzz-');
const { checkRequestLine } = await import('../../scripts/cdp-gate.mjs');

after(async () => {
  await removeRoot(root);
});

const TOKEN = 'tok-Axxxxxxxxxxxxxxxxxxxxxxxxxxx'.slice(0, 32);

// Mulberry32 PRNG — seeded, deterministic, dependency-free.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo));
}

function pick(rng, arr) {
  return arr[randInt(rng, 0, arr.length)];
}

const METHODS = ['GET', 'POST', 'PUT', 'OPTIONS', 'PRI', 'HEAD', 'PATCH', 'get', 'GeT', 'X', 'CONNECT', ''];
const PATHS = [
  '/json/version', '/json/protocol', '/json/list', '/json/new', '/json/close/1',
  '/devtools/browser/abc', '/devtools/page/xyz', '/devtools/page/xyz?ws=1',
  '/', '/%2e%2e/', '/a/b/c', '//json/version', '/json/version/extra',
  'http://127.0.0.1:9222/json/version', '/devtools/browser/abc%20def',
];
const WHITESPACE = [' ', '  ', '\t', ' \t ', '\r', '\n', '\r\n', '  \t  ', ' \r\n '];
const SUFFIXES = ['HTTP/1.1', 'HTTP/1.0', 'HTTP/2.0', 'HTTP/1.1\x00', '', 'HTTP', 'HTTPS/1.1', 'SPDY/3.1', 'x', 'HTTP/1.1\r\nHost: x'];
const TOKEN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const JUNK = ['%00', '%0a', '%0d', '\x00', '\x7f', '\u00ff', '\u4f60', '\\', '|', '&', '=', '?', '#', '..', '/', '\\', '`', '{}', '[]', '"', "'", '~'];

function randomToken(rng, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += TOKEN_CHARS[randInt(rng, 0, TOKEN_CHARS.length)];
  return s;
}

function randomLine(rng) {
  const method = pick(rng, METHODS);
  let target = pick(rng, PATHS);
  if (rng() < 0.4) {
    const pos = randInt(rng, 0, target.length + 1);
    target = target.slice(0, pos) + pick(rng, JUNK) + target.slice(pos);
  }
  if (rng() < 0.5) {
    const tk = randomToken(rng, randInt(rng, 0, 64));
    const name = rng() < 0.66 ? 'token' : 'Token';
    target += `${rng() < 0.5 ? '?' : '&'}${name}=${tk}`;
  }
  let line = method + pick(rng, WHITESPACE) + target + pick(rng, WHITESPACE) + pick(rng, SUFFIXES);
  if (rng() < 0.2) line += pick(rng, JUNK);
  return line.slice(0, 2048);
}

function assertProperty(line, token) {
  let verdict;
  try {
    verdict = checkRequestLine(line, token);
  } catch (err) {
    assert.fail(`checkRequestLine THREW on ${JSON.stringify(line)}: ${err.message}`);
  }
  assert.ok(verdict && typeof verdict === 'object', `non-object verdict for ${JSON.stringify(line)}`);
  assert.equal(typeof verdict.ok, 'boolean', `ok not boolean for ${JSON.stringify(line)}`);
  if (verdict.ok === true) {
    assert.equal(typeof verdict.target, 'string', `ok:true without a target for ${JSON.stringify(line)}`);
    let pathname = '';
    try { pathname = new URL(verdict.target, 'http://localhost').pathname; } catch {}
    const isStaticProtocol = verdict.static === true && pathname === '/json/protocol';
    if (!isStaticProtocol) {
      let embedded = null;
      try { embedded = new URL(verdict.target, 'http://localhost').searchParams.get('token'); } catch {}
      assert.equal(embedded, token, `accepted a non-static line without the exact token: ${JSON.stringify(line)}`);
    }
  }
}

test('fuzz: seeded random request-lines never throw and never mis-accept', () => {
  const rng = mulberry32(0xC0FFEE);
  for (let i = 0; i < 4000; i++) {
    assertProperty(randomLine(rng), TOKEN);
  }
});

test('fuzz: bounded mutation pass over record inputs', () => {
  const SEEDS = [
    '', 'BOGUS', 'GET /x', 'GET /x HTTP/1.1\x00', 'not a url', '\u0000\u0000',
    'GET /json/protocol HTTP/1.1',
    'GET /json/protocol?token=WRONG HTTP/1.1',
    `GET /json/protocol?token=${TOKEN} HTTP/1.1`,
    `GET /json/version?token=${TOKEN} HTTP/1.1`,
    `GET /devtools/browser/abc?token=${TOKEN} HTTP/1.1`,
    'GET /json/version?token=a HTTP/1.1',
    `POST /json/version?token=${TOKEN} HTTP/1.1`,
  ];
  const rng = mulberry32(0xDEADBEEF);
  let line = '';
  for (let i = 0; i < 2000; i++) {
    const seed = pick(rng, SEEDS);
    const op = pick(rng, ['insert', 'delete', 'dup', 'splice', 'trim', 'ctrl', 'reverse']);
    if (op === 'insert') {
      const pos = randInt(rng, 0, seed.length + 1);
      line = seed.slice(0, pos) + pick(rng, JUNK) + seed.slice(pos);
    } else if (op === 'delete') {
      const pos = seed.length ? randInt(rng, 0, seed.length) : 0;
      line = seed.slice(0, pos) + seed.slice(pos + 1);
    } else if (op === 'dup') {
      const pos = seed.length ? randInt(rng, 0, seed.length) : 0;
      line = seed.slice(0, pos) + seed + seed.slice(pos);
    } else if (op === 'splice') {
      const other = pick(rng, SEEDS);
      const pos = Math.min(seed.length, other.length ? randInt(rng, 0, other.length) : 0);
      line = seed.slice(0, pos) + other.slice(pos);
    } else if (op === 'trim') {
      const n = seed.length ? randInt(rng, 0, seed.length + 1) : 0;
      line = seed.slice(0, n);
    } else if (op === 'ctrl') {
      line = seed + pick(rng, ['\x00', '\n', '\r', '\r\n', '\t', '\x1f', '\x7f']);
    } else {
      const pos = seed.length ? randInt(rng, 0, seed.length) : 0;
      const end = pos + randInt(rng, 0, Math.max(1, seed.length - pos + 1));
      line = seed.slice(0, pos) + seed.slice(pos, end).split('').toReversed().join('') + seed.slice(end);
    }
    line = line.slice(0, 2048);
    assertProperty(line, TOKEN);
  }
});

test('fuzz: known-valid and known-rejected lines keep their exact verdicts', () => {
  assert.equal(checkRequestLine(`GET /json/version?token=${TOKEN} HTTP/1.1`, TOKEN).ok, true);
  assert.equal(checkRequestLine(`GET /devtools/browser/abc?token=${TOKEN} HTTP/1.1`, TOKEN).ok, true);
  assert.equal(checkRequestLine('GET /json/protocol HTTP/1.1', TOKEN).ok, true);
  assert.equal(checkRequestLine('GET /json/version HTTP/1.1', TOKEN).ok, false);
  assert.equal(checkRequestLine(`GET /json/version?token=wrong HTTP/1.1`, TOKEN).ok, false);
  assert.equal(checkRequestLine('', TOKEN).ok, false);
  assert.equal(checkRequestLine('\u0000\u0000', TOKEN).ok, false);
});

test('fuzz: the harness is deterministic for a fixed seed', () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  for (let i = 0; i < 500; i++) {
    assert.equal(randomLine(a), randomLine(b), `generator diverged at iteration ${i}`);
  }
  assert.equal(a(), b());
});
