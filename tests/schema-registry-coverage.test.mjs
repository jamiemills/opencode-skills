import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { classifySchemaDiff } from "../lib/compatibility-runtime/index.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => JSON.parse(readFileSync(resolve(ROOT, rel), "utf8"));

test("every registered schema path exists with a matching $id and revision", () => {
  const registry = read("schemas/registry.json");
  assert.ok(registry.entries.length > 0);
  for (const entry of registry.entries) {
    const schema = read(entry.schemaPath);
    assert.equal(schema.$id, entry.id, `${entry.schemaPath} declares $id ${schema.$id}`);
    assert.equal(entry.revision, Number(entry.id.split("/").pop()), `${entry.id} revision`);
  }
});

test("every registered revision has a same-revision matrix entry", () => {
  const registry = read("schemas/registry.json");
  const matrix = read("schemas/compatibility-matrix.json");
  const covered = new Set(
    matrix.entries.map((e) => `${e.schema}:${e.producerRevision}->${e.consumerRevision}`),
  );
  const missing = [];
  for (const entry of registry.entries) {
    const base = entry.id.replace(/\/\d+$/, "");
    if (!covered.has(`${base}:${entry.revision}->${entry.revision}`))
      missing.push(`${base}:${entry.revision}->${entry.revision}`);
  }
  assert.deepEqual(missing, [], `missing same-revision entries: ${missing.join(", ")}`);
});

// A cross-revision pair must be present UNLESS the revision change is breaking;
// a breaking change without an adapter stays unregistered so negotiation fails
// closed (the matrix's schemaDiffPolicy: breaking => explicit-adapter-required).
test("every non-breaking cross-revision base has a matrix entry", () => {
  const registry = read("schemas/registry.json");
  const matrix = read("schemas/compatibility-matrix.json");
  const schemaById = new Map(registry.entries.map((e) => [e.id, read(e.schemaPath)]));
  const covered = new Set(
    matrix.entries.map((e) => `${e.schema}:${e.producerRevision}->${e.consumerRevision}`),
  );
  const bases = {};
  for (const entry of registry.entries) {
    const base = entry.id.replace(/\/\d+$/, "");
    (bases[base] ??= new Set()).add(entry.revision);
  }
  const missing = [];
  for (const [base, revisions] of Object.entries(bases)) {
    const sorted = [...revisions].toSorted((a, b) => a - b);
    if (sorted.length < 2) continue;
    const max = sorted[sorted.length - 1];
    if (covered.has(`${base}:1->${max}`)) continue;
    const diff = classifySchemaDiff(schemaById.get(`${base}/1`), schemaById.get(`${base}/${max}`));
    if (diff !== "breaking") missing.push(`${base}:1->${max} (${diff}, no entry)`);
  }
  assert.deepEqual(
    missing,
    [],
    `missing non-breaking cross-revision entries: ${missing.join(", ")}`,
  );
});
