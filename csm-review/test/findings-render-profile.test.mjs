import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createRenderModel, validateRenderProfile } from "../../lib/render-model/index.mjs";
import { loadSchemaRegistry } from "../../lib/schema-runtime/index.mjs";
import producer from "../producer.json" with { type: "json" };
import {
  FINDINGS_FIELD_MAPPING,
  HUMAN_PROFILE,
  HUMAN_SOURCE_SCHEMA,
  LOGICAL_PROFILE,
  REDACTION_POLICY,
  RUNTIME_PROFILE,
  SOURCE_REF,
} from "../lib/human-profile.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const readFixture = async (name) =>
  JSON.parse(await readFile(join(root, "../tests/fixtures/review-json", name), "utf8"));
const runtime = await loadSchemaRegistry();

test("producer keeps logical profile separate from runtime profile identity", () => {
  assert.equal(producer.projectionProfile, LOGICAL_PROFILE);
  assert.equal(producer.projectionRuntimeProfile, RUNTIME_PROFILE.id);
  assert.notEqual(producer.projectionProfile, producer.projectionRuntimeProfile);
  assert.deepEqual(HUMAN_PROFILE.profile, RUNTIME_PROFILE);
  assert.deepEqual(HUMAN_PROFILE.sourceSchema, SOURCE_REF);
});

test("fixed human profile validates and creates an ordered model", async () => {
  const source = await readFixture("human-source-rich.json");
  assert.doesNotThrow(() =>
    validateRenderProfile(HUMAN_PROFILE, {
      sourceSchema: HUMAN_SOURCE_SCHEMA,
      schemaRegistry: runtime,
    }),
  );
  const result = createRenderModel({
    source,
    sourceSchema: HUMAN_SOURCE_SCHEMA,
    profile: HUMAN_PROFILE,
    sourceRef: SOURCE_REF,
    schemaRegistry: runtime,
  });

  assert.deepEqual(
    result.model.sections.map(({ id, items }) => [id, items.map((item) => item.path)]),
    [
      ["summary", ["/artifact/artifactId", "/verificationStatus/status", "/source/commitSha"]],
      ["findings", ["/findings"]],
      [
        "detail",
        [
          "/source/repository",
          "/artifact/createdAt",
          "/sortOrder/algorithm",
          "/sortOrder/stable",
          "/schema",
          "/schemaRevision",
        ],
      ],
      [
        "review-evidence",
        [
          "/verificationStatus/unresolved",
          "/redaction/redactedFields",
          "/redaction/status",
          "/redaction/rules",
        ],
      ],
      [
        "provenance",
        [
          "/artifact/runId",
          "/artifact/owner",
          "/artifact/digest",
          "/ownership/collisionPolicy",
          "/ownership/terminalPolicy",
          "/projection/authority",
          "/projection/formats",
        ],
      ],
    ],
  );
  assert.equal(result.model.sections[1].items[0].value.length, 2);
  assert.ok(
    result.model.sections.every((section) => section.items.every((item) => item.accessibleLabel)),
  );
  assert.ok(!result.bytes.includes("private rationale"));
  assert.ok(result.bytes.includes("[REDACTED]"));

  const reordered = structuredClone(source);
  reordered.findings = reordered.findings.map((row) =>
    Object.fromEntries(Object.entries(row).toReversed()),
  );
  assert.equal(
    result.bytes,
    createRenderModel({
      source: reordered,
      sourceSchema: HUMAN_SOURCE_SCHEMA,
      profile: HUMAN_PROFILE,
      sourceRef: SOURCE_REF,
      schemaRegistry: runtime,
    }).bytes,
  );
});

test("empty findings retain an explicit summary and findings model", async () => {
  const result = createRenderModel({
    source: await readFixture("human-source-empty.json"),
    sourceSchema: HUMAN_SOURCE_SCHEMA,
    profile: HUMAN_PROFILE,
    sourceRef: SOURCE_REF,
    schemaRegistry: runtime,
  });
  assert.equal(result.model.sections[0].items[1].value, "VERIFIED");
  assert.deepEqual(result.model.sections[1].items[0].value, []);
});

test("mapping matrix and nested redaction policy are explicit", () => {
  assert.ok(FINDINGS_FIELD_MAPPING.some((row) => row[0] === "explanation" && row[2] === "table"));
  for (const field of [
    "verification.command",
    "verification.result",
    "verification.redacted",
    "challenges.rationale",
    "challenges.challenger",
    "challenges.redacted",
    "dissents.rationale",
    "dissents.author",
    "dissents.redacted",
  ]) {
    assert.ok(FINDINGS_FIELD_MAPPING.some((row) => row[0] === field));
  }
  for (const field of [
    "verification.command",
    "verification.result",
    "challenges.rationale",
    "dissents.rationale",
  ]) {
    assert.equal(FINDINGS_FIELD_MAPPING.find((row) => row[0] === field)[2], "marker-only");
  }
  assert.deepEqual(REDACTION_POLICY.nested, {
    challengeRationale: "marker",
    dissentRationale: "marker",
    verificationCommand: "marker",
    verificationResult: "marker",
  });
});
