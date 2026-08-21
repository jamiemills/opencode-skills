// T010 / F-034 + F-038 — collect registered test names from real runner
// executions instead of source-text regexing or byte-hash locks.
//
// Spawns `node --test --test-reporter=tap` on the given test files and returns
// every registered top-level test name with its pass/fail/skip disposition.
// This gives behavioral teeth to "the named tests are still registered and
// never skipped" without parsing the test files' own text or hashing them.
//
// The nested run must not inherit NODE_TEST_CONTEXT (Node refuses a recursive
// runner run otherwise) — same pattern as the AC20 gate in
// expansion-final-acceptance.test.mjs.

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const cache = new Map();

export async function collectTestNames(files) {
  const key = files.join("\0");
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(
    process.execPath,
    ["--test", "--test-concurrency=1", "--test-reporter=tap", ...files],
    { cwd: TEST_ROOT, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  const code = await new Promise((resolve) => {
    child.on("error", () => resolve(-1));
    child.on("close", resolve);
  });

  const names = [];
  const failures = [];
  const skips = [];
  for (const line of stdout.split("\n")) {
    const match = line.match(/^(ok|not ok) \d+ - (.+?)(?: #.*)?$/);
    if (match === null) continue;
    const name = match[2];
    if (match[1] === "not ok") failures.push(name);
    else if (/#\s*skip\b/i.test(line)) skips.push(name);
    else names.push(name);
  }

  const result = Object.freeze({ names, failures, skips, code, stderr });
  cache.set(key, result);
  return result;
}
