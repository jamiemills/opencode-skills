"use strict";

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createSchemaValidator, digest, parseJson } from "../../../lib/schema-runtime/index.mjs";

export const SUPPORTED_SKILLS = Object.freeze([
  "csm-autoresearch",
  "csm-bdd-tdd",
  "csm-browse",
  "csm-build",
  "csm-ddd",
  "csm-deep-research",
  "csm-grill",
  "csm-make-tests",
  "csm-plan",
  "csm-review",
  "csm-review-python",
  "csm-scan",
  "csm-upload",
]);

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = (message) => {
  throw new TypeError(`invalid capability manifest: ${message}`);
};

export async function validateCapabilities(manifest, { verifySources = true } = {}) {
  const schema = parseJson(
    await readFile(new URL("../schemas/capabilities.schema.json", import.meta.url), "utf8"),
  );
  const checked = createSchemaValidator({ schemas: [schema] }).validate(
    "csm-orchestrate-capabilities/1",
    manifest,
  );
  if (!checked.valid)
    fail(checked.errors.map((error) => error.instancePath || error.message).join("; "));
  if (
    manifest.skills
      .map(({ skill }) => skill)
      .some((skill, index, list) => list.indexOf(skill) !== index)
  )
    fail("duplicate skill");
  if (
    manifest.skills
      .map(({ skill }) => skill)
      .toSorted()
      .join("\n") !== [...SUPPORTED_SKILLS].toSorted().join("\n")
  )
    fail("supported skill set mismatch");
  if (manifest.contentDigest !== digest(manifest.skills)) fail("content digest mismatch");
  for (const capability of manifest.skills) {
    const skillPath = new URL(`../../${capability.source.skillPath}`, import.meta.url);
    if (verifySources && sha256(await readFile(skillPath)) !== capability.digest)
      fail(`${capability.skill} source digest mismatch`);
    if (capability.source.entrypoint || capability.source.libraryDigest) {
      if (!capability.source.entrypoint || !capability.source.libraryDigest)
        fail(`${capability.skill} executable authenticity is incomplete`);
      const entrypoint = new URL(`../../${capability.source.entrypoint}`, import.meta.url);
      if (sha256(await readFile(entrypoint)) !== capability.source.libraryDigest)
        fail(`${capability.skill} executable digest mismatch`);
    }
    if (verifySources && capability.source.producerPath) {
      const producer = parseJson(
        await readFile(new URL(`../../${capability.source.producerPath}`, import.meta.url), "utf8"),
      );
      if (producer.producer !== capability.skill)
        fail(`${capability.skill} producer identity mismatch`);
      if (producer.terminal !== "immutable")
        fail(`${capability.skill} producer terminal policy mismatch`);
    }
    if (
      capability.effects.includes("read-only") &&
      capability.effects.length !== 1 &&
      capability.approvalClass === "none"
    )
      fail(`${capability.skill} contradictory read-only effects`);
    if (
      capability.effects.some((effect) => effect !== "read-only") &&
      capability.approvalClass === "none"
    )
      fail(`${capability.skill} side effect lacks approval`);
    if (capability.retryability === "safe" && capability.idempotency.mode === "forbidden")
      fail(`${capability.skill} safe retry conflicts with forbidden idempotency`);
  }
  return Object.freeze({ ...manifest, skills: Object.freeze(manifest.skills) });
}

export async function loadCapabilities() {
  const manifest = parseJson(
    await readFile(new URL("../capabilities.json", import.meta.url), "utf8"),
  );
  return validateCapabilities(manifest);
}
