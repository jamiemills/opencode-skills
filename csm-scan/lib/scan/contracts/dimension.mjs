import {
  APPLICABILITY_FACT_FIELDS,
  assertDataOnly,
  compareAscii,
  DATA_LIMITS,
  deepFreeze,
  DIMENSION_EVIDENCE_CATEGORIES,
  EvidenceContractError,
  normalizeSearchSpace,
  validateEvidenceList,
} from "./evidence.mjs";

export { assertDataOnly, compareAscii, deepFreeze } from "./evidence.mjs";

export const DIMENSION_SCHEMA_VERSION = 1;
export const CLAIM_SCHEMA_VERSION = 1;

export const CLAIM_STATUSES = Object.freeze([
  "observed",
  "inferred",
  "not_detected",
  "unsupported",
  "unverified",
  "not_applicable",
]);

export const COVERAGE_STATES = Object.freeze(["complete", "incomplete", "unsupported", "excluded"]);

export const DIMENSION_IDS = Object.freeze(Object.keys(DIMENSION_EVIDENCE_CATEGORIES));

export const PROVIDER_DIMENSION_IDS = Object.freeze(
  DIMENSION_IDS.filter((id) => id !== "DIM-structure-v1" && id !== "DIM-git-v1"),
);

export const TOTAL_DIMENSION_COUNT = 17;
export const PROVIDER_DIMENSION_COUNT = 15;
export const APPLICABILITY_FIELDS = APPLICABILITY_FACT_FIELDS;
export const APPLICABILITY_OPERATORS = Object.freeze(["equals", "exists", "in", "not_equals"]);

export const CONTRACT_LIMITS = deepFreeze({
  applicabilityRules: 16,
  applicabilityValues: 16,
  claims: 2048,
  dimensions: TOTAL_DIMENSION_COUNT,
  evidenceIds: 128,
  expectedClaims: 128,
  id: 96,
  limitations: 32,
  text: 256,
  ...DATA_LIMITS,
});

const DIMENSION_ID_PATTERN = /^DIM-[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$/;
const CLAIM_ID_PATTERN = /^CLM-[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$/;
const EVIDENCE_ID_PATTERN = /^EVD-v1-[a-f0-9]{64}$/;
const RENDERER_ID_PATTERN = /^RND-[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$/;
const DERIVATION_ID_PATTERN = /^DRV-[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$/;
const SAFE_VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const DIMENSION_KEYS = Object.freeze([
  "applicability",
  "expectedClaimIds",
  "id",
  "order",
  "providerCapability",
  "rendererId",
  "retryable",
]);
const CLAIM_KEYS = Object.freeze([
  "applicabilityEvidenceIds",
  "coverageState",
  "derivationId",
  "dimensionId",
  "evidenceIds",
  "id",
  "inputEvidenceIds",
  "limitations",
  "searchSpace",
  "status",
]);
const STATUS_COVERAGE = Object.freeze({
  observed: "complete",
  inferred: "complete",
  not_detected: "complete",
  unsupported: "unsupported",
  unverified: "incomplete",
  not_applicable: "excluded",
});

export class DimensionContractError extends TypeError {
  constructor(code, message) {
    super(`Invalid dimension contract: ${message}`);
    this.name = "DimensionContractError";
    this.code = code;
  }
}

export class ClaimContractError extends TypeError {
  constructor(code, message) {
    super(`Invalid claim contract: ${message}`);
    this.name = "ClaimContractError";
    this.code = code;
  }
}

function fail(ErrorType, code, message) {
  throw new ErrorType(code, message);
}

function exactKeys(value, expected, ErrorType, label) {
  const keys = Object.keys(value).toSorted(compareAscii);
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail(ErrorType, "UNKNOWN_FIELD", `${label} fields do not match the schema`);
  }
}

function identifier(value, pattern, ErrorType, field) {
  if (typeof value !== "string" || value.length > CONTRACT_LIMITS.id || !pattern.test(value)) {
    fail(ErrorType, "INVALID_ID", `${field} must be a stable versioned ASCII identifier`);
  }
  return value;
}

function boundedIdArray(value, pattern, ErrorType, field, maximum) {
  if (!Array.isArray(value) || value.length > maximum) {
    fail(ErrorType, "BOUND_EXCEEDED", `${field} must be a bounded array`);
  }
  const result = value.map((item) => identifier(item, pattern, ErrorType, field));
  if (new Set(result).size !== result.length)
    fail(ErrorType, "DUPLICATE_ID", `${field} contains duplicate identifiers`);
  return result.toSorted(compareAscii);
}

function safeValue(field, value, ErrorType) {
  if (field === "is_git") {
    if (typeof value !== "boolean") {
      fail(ErrorType, "INVALID_APPLICABILITY", "is_git applicability value must be boolean");
    }
    return value;
  }
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > CONTRACT_LIMITS.text ||
    !SAFE_VALUE_PATTERN.test(value)
  ) {
    fail(ErrorType, "INVALID_APPLICABILITY", "applicability value must be bounded safe ASCII");
  }
  return value;
}

function normalizeRule(rule) {
  if (rule === null || typeof rule !== "object" || Array.isArray(rule)) {
    fail(DimensionContractError, "INVALID_APPLICABILITY", "applicability rule must be an object");
  }
  exactKeys(rule, ["field", "operator", "value"], DimensionContractError, "applicability rule");
  if (
    !APPLICABILITY_FIELDS.includes(rule.field) ||
    !APPLICABILITY_OPERATORS.includes(rule.operator)
  ) {
    fail(DimensionContractError, "INVALID_APPLICABILITY", "applicability rule is not allowlisted");
  }
  let value;
  if (rule.operator === "exists") {
    if (typeof rule.value !== "boolean") {
      fail(DimensionContractError, "INVALID_APPLICABILITY", "exists rule value must be boolean");
    }
    value = rule.value;
  } else if (rule.operator === "in") {
    if (
      !Array.isArray(rule.value) ||
      rule.value.length === 0 ||
      rule.value.length > CONTRACT_LIMITS.applicabilityValues
    ) {
      fail(DimensionContractError, "INVALID_APPLICABILITY", "in rule requires bounded values");
    }
    value = rule.value
      .map((entry) => safeValue(rule.field, entry, DimensionContractError))
      .toSorted(compareAscii);
    if (new Set(value.map(String)).size !== value.length) {
      fail(DimensionContractError, "DUPLICATE_ID", "applicability values must be unique");
    }
  } else {
    value = safeValue(rule.field, rule.value, DimensionContractError);
  }
  return { field: rule.field, operator: rule.operator, value };
}

function normalizeApplicability(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(DimensionContractError, "INVALID_APPLICABILITY", "applicability must be an object");
  }
  exactKeys(value, ["mode", "rules"], DimensionContractError, "applicability");
  if (
    !["all", "any"].includes(value.mode) ||
    !Array.isArray(value.rules) ||
    value.rules.length === 0 ||
    value.rules.length > CONTRACT_LIMITS.applicabilityRules
  ) {
    fail(
      DimensionContractError,
      "INVALID_APPLICABILITY",
      "applicability predicate is invalid or too large",
    );
  }
  return { mode: value.mode, rules: value.rules.map(normalizeRule) };
}

export function validateDimension(definition) {
  assertDataOnly(definition, DimensionContractError);
  if (definition === null || typeof definition !== "object" || Array.isArray(definition)) {
    fail(DimensionContractError, "INVALID_TYPE", "dimension must be an object");
  }
  exactKeys(definition, DIMENSION_KEYS, DimensionContractError, "dimension");
  const id = identifier(definition.id, DIMENSION_ID_PATTERN, DimensionContractError, "id");
  const canonicalOrder = DIMENSION_IDS.indexOf(id);
  if (canonicalOrder < 0)
    fail(DimensionContractError, "UNKNOWN_DIMENSION", "dimension id is not registered");
  if (definition.order !== canonicalOrder)
    fail(DimensionContractError, "INVALID_ORDER", "dimension order is not canonical");
  const expectedClaimIds = boundedIdArray(
    definition.expectedClaimIds,
    CLAIM_ID_PATTERN,
    DimensionContractError,
    "expectedClaimIds",
    CONTRACT_LIMITS.expectedClaims,
  );
  if (expectedClaimIds.length === 0)
    fail(DimensionContractError, "INVALID_EXPECTED", "dimension must own expected claims");
  if (
    typeof definition.retryable !== "boolean" ||
    typeof definition.providerCapability !== "boolean"
  ) {
    fail(DimensionContractError, "INVALID_TYPE", "dimension flags must be boolean");
  }
  if (definition.providerCapability !== PROVIDER_DIMENSION_IDS.includes(id)) {
    fail(
      DimensionContractError,
      "INVALID_PROVIDER_FLAG",
      "providerCapability does not match the canonical dimension mapping",
    );
  }
  const rendererId = identifier(
    definition.rendererId,
    RENDERER_ID_PATTERN,
    DimensionContractError,
    "rendererId",
  );
  return deepFreeze({
    id,
    order: canonicalOrder,
    expectedClaimIds,
    applicability: normalizeApplicability(definition.applicability),
    retryable: definition.retryable,
    providerCapability: definition.providerCapability,
    rendererId,
  });
}

export function validateDimensions(definitions) {
  assertDataOnly(definitions, DimensionContractError);
  if (!Array.isArray(definitions) || definitions.length !== TOTAL_DIMENSION_COUNT) {
    fail(
      DimensionContractError,
      "INCOMPLETE_REGISTRY",
      "dimension registry must contain exactly 17 entries",
    );
  }
  const result = definitions.map(validateDimension);
  if (result.some((entry, index) => entry.id !== DIMENSION_IDS[index])) {
    fail(DimensionContractError, "INVALID_ORDER", "dimension registry order is not canonical");
  }
  if (new Set(result.map(({ rendererId }) => rendererId)).size !== result.length) {
    fail(DimensionContractError, "DUPLICATE_ID", "dimension renderer identifiers must be unique");
  }
  const expected = result.flatMap(({ expectedClaimIds }) => expectedClaimIds);
  if (new Set(expected).size !== expected.length) {
    fail(
      DimensionContractError,
      "DUPLICATE_ID",
      "expected claim identifiers must be globally unique",
    );
  }
  return deepFreeze(result);
}

function normalizeLimitations(value) {
  if (!Array.isArray(value) || value.length > CONTRACT_LIMITS.limitations) {
    fail(ClaimContractError, "BOUND_EXCEEDED", "limitations must be a bounded array");
  }
  const result = value
    .map((item) => {
      if (
        typeof item !== "string" ||
        item.length === 0 ||
        item.length > CONTRACT_LIMITS.text ||
        item !== item.trim() ||
        /[^\x20-\x7e]/.test(item)
      ) {
        fail(
          ClaimContractError,
          "INVALID_TEXT",
          "limitations must contain bounded trimmed ASCII text",
        );
      }
      return item;
    })
    .toSorted(compareAscii);
  if (new Set(result).size !== result.length)
    fail(ClaimContractError, "DUPLICATE_ID", "limitations must be unique");
  return result;
}

function evidenceMap(records) {
  let validated;
  try {
    validated = validateEvidenceList(records);
  } catch (error) {
    if (error instanceof EvidenceContractError) {
      fail(ClaimContractError, "INVALID_EVIDENCE", "evidence failed canonical validation");
    }
    throw error;
  }
  return { validated, index: new Map(validated.map((entry) => [entry.id, entry])) };
}

function referencedEvidence(ids, claimId, index) {
  return ids.map((id) => {
    const evidence = index.get(id);
    if (!evidence || evidence.claimId !== claimId) {
      fail(
        ClaimContractError,
        "INVALID_EVIDENCE",
        "claim references missing or unrelated evidence",
      );
    }
    return evidence;
  });
}

function canonicalSearch(value) {
  try {
    return normalizeSearchSpace(value);
  } catch (error) {
    if (error instanceof EvidenceContractError) {
      fail(ClaimContractError, "INVALID_SEARCH_SPACE", "claim searchSpace is invalid");
    }
    throw error;
  }
}

function searchState(status, searchSpace) {
  const cleanComplete =
    searchSpace.supported &&
    searchSpace.readable &&
    searchSpace.complete &&
    !searchSpace.capped &&
    !searchSpace.error &&
    !searchSpace.malformed &&
    !searchSpace.ambiguous &&
    searchSpace.omittedCount === 0;
  const cleanUnsupported =
    !searchSpace.supported &&
    !searchSpace.readable &&
    !searchSpace.complete &&
    !searchSpace.capped &&
    !searchSpace.error &&
    !searchSpace.malformed &&
    !searchSpace.ambiguous &&
    searchSpace.filesInspected === 0 &&
    searchSpace.bytesInspected === 0 &&
    searchSpace.recordsInspected === 0 &&
    searchSpace.omittedCount === 0;
  const incomplete =
    searchSpace.supported &&
    (!searchSpace.readable ||
      !searchSpace.complete ||
      searchSpace.capped ||
      searchSpace.error ||
      searchSpace.malformed ||
      searchSpace.ambiguous ||
      searchSpace.omittedCount > 0);
  if (
    (status === "not_detected" && !cleanComplete) ||
    (status === "unsupported" && !cleanUnsupported) ||
    (status === "unverified" && !incomplete)
  ) {
    fail(ClaimContractError, "STATUS_EVIDENCE", "search-space state does not match claim status");
  }
}

function ruleResult(rule, facts) {
  const selected = facts.filter((fact) => fact.field === rule.field);
  if (selected.length === 0) return null;
  const present = selected.filter((fact) => fact.present);
  const knownPresent = present.length > 0;
  if (rule.operator === "exists") return knownPresent === rule.value;
  if (!knownPresent) return rule.operator === "not_equals";
  if (rule.operator === "equals") return present.some((fact) => fact.value === rule.value);
  if (rule.operator === "not_equals") return present.every((fact) => fact.value !== rule.value);
  return present.some((fact) => rule.value.includes(fact.value));
}

function provesNotApplicable(dimension, evidence) {
  const allowedFields = new Set(dimension.applicability.rules.map(({ field }) => field));
  const facts = evidence.flatMap(({ details }) => details.facts);
  if (facts.some(({ field }) => !allowedFields.has(field))) {
    fail(
      ClaimContractError,
      "APPLICABILITY_PROOF",
      "applicability evidence contains unrelated facts",
    );
  }
  for (const field of allowedFields) {
    const selected = facts.filter((fact) => fact.field === field);
    if (selected.some((fact) => fact.present) && selected.some((fact) => !fact.present)) {
      fail(
        ClaimContractError,
        "APPLICABILITY_PROOF",
        "applicability evidence contains conflicting facts",
      );
    }
  }
  const outcomes = dimension.applicability.rules.map((rule) => ruleResult(rule, facts));
  const provenFalse =
    dimension.applicability.mode === "all"
      ? outcomes.some((outcome) => outcome === false)
      : outcomes.every((outcome) => outcome === false);
  if (!provenFalse)
    fail(
      ClaimContractError,
      "APPLICABILITY_PROOF",
      "applicability evidence does not prove the predicate false",
    );
}

function normalizeClaim(record, index, dimension) {
  assertDataOnly(record, ClaimContractError);
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    fail(ClaimContractError, "INVALID_TYPE", "claim must be an object");
  }
  exactKeys(record, CLAIM_KEYS, ClaimContractError, "claim");
  const id = identifier(record.id, CLAIM_ID_PATTERN, ClaimContractError, "id");
  if (record.dimensionId !== dimension.id || !dimension.expectedClaimIds.includes(id)) {
    fail(ClaimContractError, "UNOWNED_CLAIM", "claim is not owned by its declared dimension");
  }
  if (!CLAIM_STATUSES.includes(record.status))
    fail(ClaimContractError, "INVALID_STATUS", "status is not allowlisted");
  if (record.coverageState !== STATUS_COVERAGE[record.status]) {
    fail(ClaimContractError, "INVALID_COVERAGE", "coverageState does not match status semantics");
  }
  const evidenceIds = boundedIdArray(
    record.evidenceIds,
    EVIDENCE_ID_PATTERN,
    ClaimContractError,
    "evidenceIds",
    CONTRACT_LIMITS.evidenceIds,
  );
  const inputEvidenceIds = boundedIdArray(
    record.inputEvidenceIds,
    EVIDENCE_ID_PATTERN,
    ClaimContractError,
    "inputEvidenceIds",
    CONTRACT_LIMITS.evidenceIds,
  );
  const applicabilityEvidenceIds = boundedIdArray(
    record.applicabilityEvidenceIds,
    EVIDENCE_ID_PATTERN,
    ClaimContractError,
    "applicabilityEvidenceIds",
    CONTRACT_LIMITS.evidenceIds,
  );
  const evidence = referencedEvidence(evidenceIds, id, index);
  if (
    inputEvidenceIds.some((entry) => !evidenceIds.includes(entry)) ||
    applicabilityEvidenceIds.some((entry) => !evidenceIds.includes(entry))
  ) {
    fail(
      ClaimContractError,
      "INVALID_EVIDENCE",
      "specialized evidence must be included in claim evidence",
    );
  }
  const limitations = normalizeLimitations(record.limitations);
  const searchSpace = record.searchSpace === null ? null : canonicalSearch(record.searchSpace);
  let derivationId = null;
  const inadmissible = evidence.some(
    (entry) =>
      !["search_space", "applicability"].includes(entry.category) &&
      !DIMENSION_EVIDENCE_CATEGORIES[dimension.id].includes(entry.category),
  );
  if (inadmissible) {
    fail(
      ClaimContractError,
      "DIMENSION_CATEGORY",
      "evidence category is not admissible for the claim dimension",
    );
  }

  if (record.status === "observed") {
    if (
      record.derivationId !== null ||
      inputEvidenceIds.length ||
      applicabilityEvidenceIds.length ||
      searchSpace !== null ||
      evidence.length === 0 ||
      evidence.some((entry) => ["search_space", "applicability"].includes(entry.category))
    ) {
      fail(
        ClaimContractError,
        "STATUS_EVIDENCE",
        "observed requires only direct canonical evidence",
      );
    }
  } else if (record.status === "inferred") {
    derivationId = identifier(
      record.derivationId,
      DERIVATION_ID_PATTERN,
      ClaimContractError,
      "derivationId",
    );
    const inputs = referencedEvidence(inputEvidenceIds, id, index);
    if (
      inputs.length === 0 ||
      applicabilityEvidenceIds.length ||
      searchSpace !== null ||
      evidence.some((entry) => ["search_space", "applicability"].includes(entry.category)) ||
      inputs.some((entry) => ["search_space", "applicability"].includes(entry.category))
    ) {
      fail(
        ClaimContractError,
        "STATUS_EVIDENCE",
        "inferred requires direct canonical input evidence",
      );
    }
  } else if (["not_detected", "unsupported", "unverified"].includes(record.status)) {
    if (
      record.derivationId !== null ||
      inputEvidenceIds.length ||
      applicabilityEvidenceIds.length ||
      searchSpace === null ||
      evidence.length === 0 ||
      evidence.some((entry) => entry.category !== "search_space")
    ) {
      fail(
        ClaimContractError,
        "STATUS_EVIDENCE",
        "search status requires only canonical search-space evidence",
      );
    }
    const canonical = JSON.stringify(searchSpace);
    if (evidence.some((entry) => JSON.stringify(entry.details) !== canonical)) {
      fail(
        ClaimContractError,
        "STATUS_EVIDENCE",
        "claim and evidence search-space details must be identical",
      );
    }
    searchState(record.status, searchSpace);
  } else {
    const applicability = referencedEvidence(applicabilityEvidenceIds, id, index);
    if (
      record.derivationId !== null ||
      inputEvidenceIds.length ||
      searchSpace !== null ||
      evidence.length === 0 ||
      applicability.length !== evidence.length ||
      evidence.some((entry) => entry.category !== "applicability")
    ) {
      fail(
        ClaimContractError,
        "STATUS_EVIDENCE",
        "not_applicable requires only applicability evidence",
      );
    }
    provesNotApplicable(dimension, applicability);
  }

  return deepFreeze({
    id,
    dimensionId: dimension.id,
    status: record.status,
    coverageState: record.coverageState,
    evidenceIds,
    inputEvidenceIds,
    applicabilityEvidenceIds,
    derivationId,
    limitations,
    searchSpace,
  });
}

export function validateClaim(record, evidenceRecords, dimensionDefinition) {
  const dimension = validateDimension(dimensionDefinition);
  const { index } = evidenceMap(evidenceRecords);
  return normalizeClaim(record, index, dimension);
}

export function validateClaims(records, evidenceRecords, dimensionRegistry) {
  assertDataOnly(records, ClaimContractError, {
    ...DATA_LIMITS,
    maxArray: CONTRACT_LIMITS.claims,
    maxNodes: CONTRACT_LIMITS.claims * 32,
  });
  if (!Array.isArray(records) || records.length > CONTRACT_LIMITS.claims) {
    fail(ClaimContractError, "BOUND_EXCEEDED", "claims must be a bounded array");
  }
  const dimensions = validateDimensions(dimensionRegistry);
  const dimensionsById = new Map(dimensions.map((entry) => [entry.id, entry]));
  const { validated: validatedEvidence, index } = evidenceMap(evidenceRecords);
  const result = records.map((record) => {
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
      fail(ClaimContractError, "INVALID_TYPE", "claim must be an object");
    }
    exactKeys(record, CLAIM_KEYS, ClaimContractError, "claim");
    const dimension =
      record && typeof record.dimensionId === "string"
        ? dimensionsById.get(record.dimensionId)
        : null;
    if (!dimension)
      fail(ClaimContractError, "UNKNOWN_DIMENSION", "claim dimension is not registered");
    return normalizeClaim(record, index, dimension);
  });
  if (new Set(result.map(({ id }) => id)).size !== result.length) {
    fail(ClaimContractError, "DUPLICATE_ID", "claims contain duplicate identifiers");
  }
  const claimsById = new Map(result.map((claim) => [claim.id, claim]));
  for (const evidence of validatedEvidence) {
    const claim = claimsById.get(evidence.claimId);
    if (!claim || !claim.evidenceIds.includes(evidence.id)) {
      fail(
        ClaimContractError,
        "ORPHAN_EVIDENCE",
        "aggregate evidence must be owned and referenced by a present claim",
      );
    }
  }
  return deepFreeze(result.toSorted((left, right) => compareAscii(left.id, right.id)));
}

export function computeCoverage(records, evidenceRecords, dimensionRegistry) {
  if (dimensionRegistry === undefined) {
    fail(
      ClaimContractError,
      "MISSING_REGISTRY",
      "coverage requires an explicit dimension registry",
    );
  }
  const dimensions = validateDimensions(dimensionRegistry);
  const claims = validateClaims(records, evidenceRecords, dimensions);
  const expected = dimensions.flatMap(({ expectedClaimIds }) => expectedClaimIds);
  const seen = new Set(claims.map(({ id }) => id));
  const counts = { complete: 0, incomplete: 0, unsupported: 0, excluded: 0 };
  for (const claim of claims) counts[claim.coverageState]++;
  counts.incomplete += expected.filter((id) => !seen.has(id)).length;
  const eligible = counts.complete + counts.incomplete;
  return deepFreeze({
    expected: expected.length,
    eligible,
    complete: counts.complete,
    incomplete: counts.incomplete,
    unsupported: counts.unsupported,
    excluded: counts.excluded,
    ratio: eligible === 0 ? null : counts.complete / eligible,
  });
}
