"use strict";

import reviewSchema from "../schemas/csm-review-findings.schema.json" with { type: "json" };
import doctrineSchema from "../../csm-review-python/schemas/csm-doctrine-findings.schema.json" with { type: "json" };
import { createSchemaValidator } from "../../lib/schema-runtime/index.mjs";

const schemas = [reviewSchema, doctrineSchema];
const severityRank = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const confidenceRank = { low: 0, medium: 1, high: 2, verified: 3 };
const evidenceRank = { E4: 0, E3: 1, E2: 2, E1: 3 };

function semanticError(instancePath, message) {
  return { keyword: "semantic", instancePath, schemaPath: "", params: {}, message };
}

function expectedSortKey(finding) {
  return `${severityRank[finding.severity]}:${confidenceRank[finding.confidence]}:${evidenceRank[finding.evidenceClass]}:${finding.id}`;
}

function validateSemanticRules(payload) {
  const errors = [];
  const ids = new Set();
  const fingerprints = new Set();

  if (
    payload.verificationStatus.status === "VERIFIED" &&
    payload.verificationStatus.unresolved.length
  )
    errors.push(
      semanticError(
        "/verificationStatus/unresolved",
        "VERIFIED payloads cannot have unresolved checks",
      ),
    );

  for (let index = 0; index < payload.findings.length; index += 1) {
    const finding = payload.findings[index];
    const path = `/findings/${index}`;
    if (ids.has(finding.id))
      errors.push(semanticError(`${path}/id`, `duplicate finding ID: ${finding.id}`));
    ids.add(finding.id);

    const expected = expectedSortKey(finding);
    if (finding.sortKey !== expected)
      errors.push(semanticError(`${path}/sortKey`, `sortKey must be ${expected}`));

    const maximumConfidence = evidenceRank[finding.evidenceClass];
    if (confidenceRank[finding.confidence] > maximumConfidence)
      errors.push(semanticError(`${path}/confidence`, "confidence exceeds the evidence class"));

    if (
      finding.evidenceClass === "E1" &&
      (!finding.verification || finding.verification.redacted !== true)
    )
      errors.push(
        semanticError(`${path}/verification`, "E1 findings require redacted verification evidence"),
      );
    if (finding.evidenceClass === "E2" && finding.challenges.length === 0)
      errors.push(
        semanticError(`${path}/challenges`, "E2 findings require an independent challenge"),
      );
    if (finding.evidenceClass === "E3" && typeof finding.anchorRef !== "string")
      errors.push(semanticError(`${path}/anchorRef`, "E3 findings require a static anchor"));
    if (["critical", "high"].includes(finding.severity) && finding.challenges.length === 0)
      errors.push(
        semanticError(`${path}/challenges`, "critical/high findings require a challenge gate"),
      );

    const challengeIds = new Set();
    for (const challenge of finding.challenges) {
      if (challengeIds.has(challenge.challengeId))
        errors.push(
          semanticError(`${path}/challenges`, `duplicate challenge ID: ${challenge.challengeId}`),
        );
      challengeIds.add(challenge.challengeId);
    }
    const dissentIds = new Set();
    for (const dissent of finding.dissents) {
      if (dissentIds.has(dissent.dissentId))
        errors.push(
          semanticError(`${path}/dissents`, `duplicate dissent ID: ${dissent.dissentId}`),
        );
      dissentIds.add(dissent.dissentId);
    }

    const findingFingerprints = new Set();
    for (const location of finding.locations) {
      const fingerprint = [
        location.path.replaceAll("\\", "/"),
        location.symbol ?? "",
        finding.category,
        finding.anchorRef ?? "",
      ].join("|");
      if (!findingFingerprints.has(fingerprint) && fingerprints.has(fingerprint))
        errors.push(
          semanticError(
            `${path}/locations`,
            `ambiguous duplicate finding fingerprint: ${fingerprint}`,
          ),
        );
      findingFingerprints.add(fingerprint);
    }
    for (const fingerprint of findingFingerprints) fingerprints.add(fingerprint);
  }

  const sorted = payload.findings.toSorted((a, b) => b.sortKey.localeCompare(a.sortKey));
  if (JSON.stringify(payload.findings) !== JSON.stringify(sorted))
    errors.push(semanticError("/findings", "findings must be in declared descending sort order"));

  return errors;
}

export function validateFindingsPayload(payload, schemaId = payload?.schema) {
  const schemaResult = createSchemaValidator({ schemas }).validate(schemaId, payload);
  const errors = schemaResult.valid ? [] : schemaResult.errors;
  if (schemaResult.valid) errors.push(...validateSemanticRules(payload));
  return { valid: errors.length === 0, errors };
}

export function assertFindingsPayload(payload, schemaId = payload?.schema) {
  const result = validateFindingsPayload(payload, schemaId);
  if (!result.valid) throw new TypeError(result.errors.map((error) => error.message).join("; "));
  return payload;
}
