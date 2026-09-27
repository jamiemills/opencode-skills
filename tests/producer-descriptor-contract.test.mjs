import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FORMAT = "csm-producer-descriptor/1";

function descriptors() {
  const out = [];
  for (const d of readdirSync(ROOT, { withFileTypes: true })) {
    if (!d.isDirectory() || !d.name.startsWith("csm-")) continue;
    for (const f of readdirSync(resolve(ROOT, d.name))) {
      if (f === "producer.json" || f.endsWith("-producer.json")) {
        out.push({ dir: d.name, rel: `${d.name}/${f}` });
      }
    }
  }
  return out;
}

test("every producer descriptor carries the format header", () => {
  const ds = descriptors();
  assert.ok(ds.length >= 8, `expected >=8 descriptors, saw ${ds.length}`);
  for (const { rel } of ds) {
    const j = JSON.parse(readFileSync(resolve(ROOT, rel), "utf8"));
    assert.equal(j.format, FORMAT, `${rel} missing/mismatched format header`);
  }
});

test("each descriptor names its producer directory and a schema id", () => {
  for (const { dir, rel } of descriptors()) {
    const j = JSON.parse(readFileSync(resolve(ROOT, rel), "utf8"));
    assert.equal(j.producer, dir, `${rel} producer must equal its directory`);
    const schemas = Array.isArray(j.schemas) ? j.schemas : [j.schema];
    assert.ok(schemas.length > 0, `${rel} declares no schema`);
    if (typeof j.schema === "string" && typeof j.schemaRevision === "number")
      assert.equal(
        Number(j.schema.split("/")[1]),
        j.schemaRevision,
        `${rel} schema id suffix must equal schemaRevision`,
      );
    for (const s of schemas) assert.match(s, /^csm-[a-z0-9-]+\/\d+$/, `${rel} bad schema id ${s}`);
  }
});

test("each descriptor agrees with its owning SKILL (schema stem present)", () => {
  for (const { dir, rel } of descriptors()) {
    const j = JSON.parse(readFileSync(resolve(ROOT, rel), "utf8"));
    const skill = readFileSync(resolve(ROOT, dir, "SKILL.md"), "utf8");
    const ids = (Array.isArray(j.schemas) ? j.schemas : [j.schema]).map((s) => s.split("/")[0]);
    assert.ok(
      ids.some((id) => skill.includes(id)),
      `${dir}/SKILL.md does not reference any descriptor schema (${ids.join(", ")})`,
    );
  }
});

test("scan path and review revision are reconciled", () => {
  const scan = JSON.parse(readFileSync(resolve(ROOT, "csm-scan/norms-producer.json"), "utf8"));
  assert.equal(scan.canonicalPath, "NORMS.json");
  assert.equal(scan.schema, "csm-norms/1");
  const review = JSON.parse(readFileSync(resolve(ROOT, "csm-review/producer.json"), "utf8"));
  assert.equal(review.schema, "csm-review-findings/2");
  assert.equal(review.schemaRevision, 2);
  assert.ok(review.frozenRevisions.includes("csm-review-findings/1"));
});
