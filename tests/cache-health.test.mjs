import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { aggregateReport, parseSessionRows, renderReport } from '../scripts/cache-health.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = (name) => join(root, 'tests', 'fixtures', 'cache-health', name);

test('parseSessionRows parses the sample fixture into typed rows', async () => {
  const rows = parseSessionRows(await readFile(fixture('sample.tsv'), 'utf8'));
  assert.equal(rows.length, 6);
  const [s1, s4] = [rows[0], rows[3]];
  assert.equal(s1.slug, 'sunny-cactus');
  assert.equal(s1.agent, 'general');
  assert.equal(s1.input, 20683);
  assert.equal(s1.cacheRead, 246400);
  assert.equal(s1.cacheWrite, 0);
  assert.equal(s1.cost, 0.00473858);
  assert.equal(s1.timeCreated, 1787224866048);
  assert.equal(s4.slug, 'quiet-eagle');
  assert.equal(s4.input, 5000);
  assert.equal(s4.cacheRead, 0, 'missing cache.read must coalesce to 0');
});

test('parseSessionRows skips a header line and empty lines', async () => {
  const rows = parseSessionRows(await readFile(fixture('with-header.tsv'), 'utf8'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].slug, 'misty-otter');
  assert.equal(parseSessionRows('').length, 0);
  assert.equal(parseSessionRows('\n\n').length, 0);
});

test('aggregateReport computes per-session hit ratios, marking zero denominators n/a', async () => {
  const rows = parseSessionRows(await readFile(fixture('sample.tsv'), 'utf8'));
  const report = aggregateReport(rows);
  assert.equal(report.sessionCount, 6);
  assert.equal(report.skipped, 1);
  assert.equal(report.sessions.length, 6);
  const bySlug = new Map(report.sessions.map((s) => [s.slug, s]));
  assert.equal(bySlug.get('sunny-cactus').hitRatio, 246400 / (246400 + 20683));
  assert.equal(bySlug.get('lucky-eagle').hitRatio, 2993664 / (2993664 + 79664));
  assert.equal(bySlug.get('swift-planet').hitRatio, 90000 / (90000 + 10000));
  assert.equal(bySlug.get('quick-tiger').hitRatio, 40000 / (40000 + 20000 + 5000));
  assert.equal(bySlug.get('quiet-eagle').hitRatio, 0, 'a coalesced cache.read of 0 yields a 0.0% hit ratio');
  assert.equal(bySlug.get('flat-line').hitRatio, null, 'zero denominator must be null (n/a)');
});

test('aggregateReport sorts sessions newest-first and groups by UTC day', async () => {
  const rows = parseSessionRows(await readFile(fixture('sample.tsv'), 'utf8'));
  const report = aggregateReport(rows);
  assert.deepEqual(
    report.sessions.map((s) => s.slug),
    ['sunny-cactus', 'lucky-eagle', 'flat-line', 'quiet-eagle', 'swift-planet', 'quick-tiger'],
  );
  assert.deepEqual(
    report.days.map((d) => d.date),
    ['2026-08-20', '2026-08-19'],
  );
  const [day20, day19] = report.days;
  assert.equal(day20.sessionCount, 4);
  assert.equal(day20.input, 105347);
  assert.equal(day20.cacheRead, 3240064);
  assert.equal(day20.cacheWrite, 0);
  assert.equal(day20.cost, 0.0418343992);
  assert.equal(day20.skipped, 1);
  assert.equal(day20.hitRatio, 3240064 / (3240064 + 105347));
  assert.equal(day19.sessionCount, 2);
  assert.equal(day19.input, 30000);
  assert.equal(day19.cacheRead, 130000);
  assert.equal(day19.cacheWrite, 5000);
  assert.equal(day19.cost, 0.005);
  assert.equal(day19.skipped, 0);
  assert.equal(day19.hitRatio, 130000 / (130000 + 30000 + 5000));
});

test('renderReport emits the plain-text per-session and per-day report', async () => {
  const rows = parseSessionRows(await readFile(fixture('sample.tsv'), 'utf8'));
  const report = aggregateReport(rows);
  const text = renderReport(report, { windowLabel: 'last 30 days' });
  assert.match(text, /cache-health: deepseek-v4-flash cache hit report/);
  assert.match(text, /window: last 30 days · sessions: 6 · zero-denominator skipped: 1/);
  assert.match(text, /per-session \(newest first\):/);
  assert.match(text, /sunny-cactus/);
  assert.match(text, /flat-line/);
  assert.match(text, /92\.3%/);
  assert.match(text, /97\.4%/);
  assert.match(text, /n\/a/);
  assert.match(text, /per-day summary \(UTC\):/);
  assert.match(text, /2026-08-20/);
  assert.match(text, /2026-08-19/);
  assert.match(text, /96\.9%/);
  assert.match(text, /78\.8%/);
});
