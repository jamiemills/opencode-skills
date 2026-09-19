"use strict";

// G2 repair verification: the revision-aware capabilities loader and the
// dual-accept request intake keep /1 and /2 both working while /3 (capabilities)
// and /2 (request) validate under their own declared revision, and unknown
// revisions fail closed.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { test } from "node:test";
import {
  createSchemaValidator,
  digest,
  loadSchemaRegistry,
  parseJson,
} from "../lib/schema-runtime/index.mjs";
import { validateCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import { intakeArtifact } from "../csm-orchestrate/lib/intake.mjs";



const REQUEST_V1 = {
  schema: "csm-orchestrate-request/1",
  schemaRevision: 1,
  requestId: "request-dualrev-1",
  runId: "run-20260919t162000z-0d9ac36d1373",
  kind: "research",
  prompt: "Dual-revision request intake.",
  goalSlug: "dualrev-intake",
};
const REQUEST_V2 = {
  ...REQUEST_V1,
  schema: "csm-orchestrate-request/2",
  schemaRevision: 2,
  decision: { mode: "shadow" },
};

test("request/2 is registered and validates; request/1 stays valid", async () => {
  const registry = await loadSchemaRegistry();
  const entry = registry.resolve("csm-orchestrate-request", 2);
  assert.equal(entry.schemaPath, "csm-orchestrate/schemas/csm-orchestrate-request.v2.schema.json");
  assert.equal(entry.immutable, true);
  const v2 = parseJson(await readFile(new URL(`../${entry.schemaPath}`, import.meta.url), "utf8"));
  const v1 = parseJson(
    await readFile(
      new URL("../csm-orchestrate/schemas/csm-orchestrate-request.schema.json", import.meta.url),
      "utf8",
    ),
  );
  const validator = createSchemaValidator({ schemas: [v1, v2] });
  assert.equal(validator.validate("csm-orchestrate-request/2", REQUEST_V2).valid, true);
  assert.equal(validator.validate("csm-orchestrate-request/1", REQUEST_V1).valid, true);
  assert.equal(validator.validate("csm-orchestrate-request/2", REQUEST_V1).valid, false);
});

test("intake accepts both request revisions and rejects an unknown marker", async () => {
  assert.equal((await intakeArtifact(REQUEST_V1)).kind, "request");
  assert.equal((await intakeArtifact(REQUEST_V2)).kind, "request");
  await assert.rejects(
    intakeArtifact({ ...REQUEST_V1, schema: "csm-orchestrate-request/9" }),
    /unsupported schema marker/,
  );
});

test("capabilities loader accepts /2 and /3 and fails closed on unknown revisions", async () => {
  const current = parseJson(
    await readFile(new URL("../csm-orchestrate/capabilities.json", import.meta.url), "utf8"),
  );
  assert.equal(current.schema, "csm-orchestrate-capabilities/3");
  await validateCapabilities(current, { verifySources: false });

  const frozen = structuredClone(current);
  frozen.schema = "csm-orchestrate-capabilities/2";
  frozen.version = 2;
  delete frozen.schemaRevision;
  for (const entry of frozen.skills ?? []) delete entry.decision;
  frozen.contentDigest = digest(frozen.skills);
  await validateCapabilities(frozen, { verifySources: false });

  for (const schema of [
    "csm-orchestrate-capabilities/1",
    "csm-orchestrate-capabilities/4",
    undefined,
  ]) {
    await assert.rejects(
      validateCapabilities({ ...current, schema }, { verifySources: false }),
      /unsupported schema revision/,
    );
  }
});
