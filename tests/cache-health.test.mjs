import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { aggregateReport, parseSessionRows, renderReport } from "../scripts/cache-health.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = (name) => join(root, "tests", "fixtures", "cache-health", name);
const execFileAsync = promisify(execFile);
const cacheHealthScript = join(root, "scripts", "cache-health.mjs");

async function runMain(args = [], { output = "", fail = false } = {}) {
  const sandbox = await mkdtemp(join(root, "tests", ".cache-health-main-"));
  const bin = join(sandbox, "bin");
  const log = join(sandbox, "args.log");
  await mkdir(join(sandbox, ".git"), { recursive: true });
  await mkdir(join(sandbox, ".agents"), { recursive: true });
  await writeFile(join(sandbox, ".agents", "token-efficiency.json"), '{"enabled":true}\n');
  await mkdir(bin);
  const fake = join(bin, "opencode");
  const body = fail
    ? `#!/usr/bin/env node\nprocess.stderr.write("db unavailable\\n"); process.exit(7);\n`
    : `#!/usr/bin/env node\nconst fs = require("node:fs"); fs.writeFileSync(${JSON.stringify(log)}, process.argv.slice(2).join("\\n")); process.stdout.write(${JSON.stringify(output)});\n`;
  await writeFile(fake, body);
  await chmod(fake, 0o755);
  try {
    const result = await execFileAsync(process.execPath, [cacheHealthScript, ...args], {
      cwd: sandbox,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
    });
    return { ...result, sqlArgs: await readFile(log, "utf8") };
  } catch (error) {
    error.sqlArgs = existsSync(log) ? await readFile(log, "utf8") : "";
    return error;
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

test("parseSessionRows parses the sample fixture into typed rows", async () => {
  const rows = parseSessionRows(await readFile(fixture("sample.tsv"), "utf8"));
  assert.equal(rows.length, 6);
  const [s1, s4] = [rows[0], rows[3]];
  assert.equal(s1.slug, "sunny-cactus");
  assert.equal(s1.agent, "general");
  assert.equal(s1.input, 20683);
  assert.equal(s1.cacheRead, 246400);
  assert.equal(s1.cacheWrite, 0);
  assert.equal(s1.cost, 0.00473858);
  assert.equal(s1.timeCreated, 1787224866048);
  assert.equal(s4.slug, "quiet-eagle");
  assert.equal(s4.input, 5000);
  assert.equal(s4.cacheRead, 0, "missing cache.read must coalesce to 0");
});

test("parseSessionRows skips a header line and empty lines", async () => {
  const rows = parseSessionRows(await readFile(fixture("with-header.tsv"), "utf8"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].slug, "misty-otter");
  assert.equal(parseSessionRows("").length, 0);
  assert.equal(parseSessionRows("\n\n").length, 0);
});

test("aggregateReport computes per-session hit ratios, marking zero denominators n/a", async () => {
  const rows = parseSessionRows(await readFile(fixture("sample.tsv"), "utf8"));
  const report = aggregateReport(rows);
  assert.equal(report.sessionCount, 6);
  assert.equal(report.skipped, 1);
  assert.equal(report.sessions.length, 6);
  const bySlug = new Map(report.sessions.map((s) => [s.slug, s]));
  assert.equal(bySlug.get("sunny-cactus").hitRatio, 246400 / (246400 + 20683));
  assert.equal(bySlug.get("lucky-eagle").hitRatio, 2993664 / (2993664 + 79664));
  assert.equal(bySlug.get("swift-planet").hitRatio, 90000 / (90000 + 10000));
  assert.equal(bySlug.get("quick-tiger").hitRatio, 40000 / (40000 + 20000 + 5000));
  assert.equal(
    bySlug.get("quiet-eagle").hitRatio,
    0,
    "a coalesced cache.read of 0 yields a 0.0% hit ratio",
  );
  assert.equal(bySlug.get("flat-line").hitRatio, null, "zero denominator must be null (n/a)");
});

test("aggregateReport sorts sessions newest-first and groups by UTC day", async () => {
  const rows = parseSessionRows(await readFile(fixture("sample.tsv"), "utf8"));
  const report = aggregateReport(rows);
  assert.deepEqual(
    report.sessions.map((s) => s.slug),
    ["sunny-cactus", "lucky-eagle", "flat-line", "quiet-eagle", "swift-planet", "quick-tiger"],
  );
  assert.deepEqual(
    report.days.map((d) => d.date),
    ["2026-08-20", "2026-08-19"],
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

test("renderReport emits the plain-text per-session and per-day report", async () => {
  const rows = parseSessionRows(await readFile(fixture("sample.tsv"), "utf8"));
  const report = aggregateReport(rows);
  const text = renderReport(report, { windowLabel: "last 30 days" });
  assert.match(text, /cache-health: model=deepseek-v4-flash cache hit report/);
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

test("renderReport makes the fixed model scope explicit", () => {
  const text = renderReport(aggregateReport([]));
  assert.match(text, /^cache-health: model=deepseek-v4-flash cache hit report/);
});

test("CLI main constructs the bounded SQL and renders queried rows", async () => {
  const result = await runMain(["--days", "7"], {
    output: "id\tsunny-cactus\tagent\t1787224866048\t10\t20\t0\t0.5\n",
  });
  assert.equal(result.stderr, "");
  assert.match(result.sqlArgs, /from session where model LIKE '%deepseek-v4-flash%'/);
  assert.match(result.sqlArgs, /time_created >= \d+/);
  assert.match(result.sqlArgs, /order by time_created desc/);
  assert.match(result.stdout, /window: last 7 days \(cutoff \d{4}-\d{2}-\d{2} UTC\)/);
  assert.match(result.stdout, /sunny-cactus/);
});

test("CLI main reports subprocess failures with a nonzero exit", async () => {
  const result = await runMain([], { fail: true });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /cache-health: opencode db query failed: db unavailable/);
});
