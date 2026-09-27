import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BIN = join(ROOT, "bootstrap/package/bin/csm-skills-bootstrap.js");

test("the shipped bootstrap bin's keyring is a non-production test fixture", async () => {
  const src = await readFile(BIN, "utf8");
  assert.match(src, /"environment":"test-fixture-only"/);
  assert.match(src, /"production_use":false/);
});

test("signature trust is reported as non-production unless the keyring is production", async () => {
  const src = await readFile(BIN, "utf8");
  // The trust decision must consult production_use, not just `signed`.
  assert.match(src, /const productionKeyring = keyring\.production_use === true/);
  assert.match(src, /"signature-verified-nonproduction"/);
  assert.match(src, /productionTrust: signed && productionKeyring/);
});

test("the bin fails closed on a missing envelope", async () => {
  await assert.rejects(
    () =>
      execFileAsync(process.execPath, [
        BIN,
        "verify",
        join(ROOT, "bootstrap/fixtures/does-not-exist.json"),
      ]),
    (error) => {
      const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
      return error.code === 1 && /"ok":\s*false/.test(output);
    },
  );
});
