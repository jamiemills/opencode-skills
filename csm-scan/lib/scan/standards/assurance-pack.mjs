// Assurance & Supply Chain standards pack — sidecar metadata.
//
// T216 owns this module. It is a NEW additive standards metadata module under
// `lib/scan/standards/`. It references ONLY existing T200 registry IDs (through
// the read-only `standardById` accessor) and NEVER edits
// `lib/scan/standards/policy.mjs` or `lib/scan/standards/registry.mjs`.
//
// Purpose: define the EXACT schema-identity joins the assurance parsers may
// apply. A join binds a stable schema identity (e.g. a CycloneDX SBOM whose
// `bomFormat` is "CycloneDX" and whose `specVersion` is exactly "1.7") to a
// registered standard identifier. Matching is byte-exact: an identity that does
// not appear in this pack produces NO standard reference, and an identity whose
// registry entry has any disposition other than `metadata_only` is rejected.
//
// Hard guarantees:
//   - Every `registryId` resolves through `standardById` and is metadata_only.
//   - The pack stores no control text, no compliance/conformance/compatibility
//     language, and no vulnerability verdicts. It is metadata only.
//   - `resolveAssuranceStandard` returns a frozen metadata record or null; it
//     never asserts that an artifact satisfies, conforms to, or complies with a
//     standard.
//
// ESM only. Zero npm deps. node: builtins only (imported here: none).
//
// Source-policy note (T201): this module imports only the standards registry;
// it never touches node:fs / node:child_process / node:process / node:vm /
// node:module.

import { compareAscii, deepFreeze } from '../contracts/evidence.mjs';
import { standardById } from './registry.mjs';

export const ASSURANCE_STANDARD_PACK_VERSION = 1;

const IDENTITY_PATTERN = /^[a-z0-9]+:(?:[A-Za-z0-9._-]+:)?[A-Za-z0-9._-]+$/;
const REGISTRY_ID_PATTERN = /^std:[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

// Exact schema-identity joins. Adding or removing an entry requires an
// independent review: each identity must be a provable byte-exact schema
// identity and the registry entry must be metadata_only.
const ASSURANCE_STANDARD_JOINS_SOURCE = Object.freeze([
  { identity: 'sbom:CycloneDX:1.7', registryId: 'std:owasp-cyclonedx:1.7' },
  { identity: 'sbom:SPDX:SPDX-2.3', registryId: 'std:spdx-spec:2.3.0' },
  { identity: 'vex:OpenVEX:0.2.0', registryId: 'std:openvex-spec:0.2.0' },
  { identity: 'sarif:2.1.0', registryId: 'std:oasis-sarif:2.1.0-errata01' },
  { identity: 'accessibility:WCAG:2.2', registryId: 'std:w3c-wcag:2.2-rec-20241212' },
]);

export class AssuranceStandardsPackError extends TypeError {
  constructor(code, message) {
    super(`Invalid assurance standards pack: ${message}`);
    this.name = 'AssuranceStandardsPackError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new AssuranceStandardsPackError(code, message);
}

function normalizeIdentity(identity) {
  if (typeof identity !== 'string' || identity.length === 0 || identity.length > 96
      || !IDENTITY_PATTERN.test(identity)) {
    fail('INVALID_IDENTITY', 'schema identity must be a bounded stable token');
  }
  return identity;
}

function normalizeRegistryId(registryId) {
  if (typeof registryId !== 'string' || registryId.length === 0 || registryId.length > 96
      || !REGISTRY_ID_PATTERN.test(registryId)) {
    fail('INVALID_REGISTRY_ID', 'registry id must be a stable versioned identifier');
  }
  const entry = standardById(registryId);
  if (entry === null) fail('UNKNOWN_REGISTRY_ID', `registry id is not registered: ${registryId}`);
  if (entry.disposition !== 'metadata_only') {
    fail('NON_METADATA_ONLY', 'assurance joins require a metadata_only disposition');
  }
  return entry;
}

function normalizeJoin(join) {
  if (join === null || typeof join !== 'object' || Array.isArray(join)) {
    fail('INVALID_JOIN', 'join must be an object');
  }
  const keys = Object.keys(join).sort(compareAscii);
  if (keys.length !== 2 || keys[0] !== 'identity' || keys[1] !== 'registryId') {
    fail('UNKNOWN_FIELD', 'join fields do not match the schema');
  }
  const identity = normalizeIdentity(join.identity);
  const entry = normalizeRegistryId(join.registryId);
  return deepFreeze({
    identity,
    registryId: entry.id,
    publisher: entry.publisher,
    title: entry.title,
    editionKey: entry.editionKey,
    edition: entry.edition,
    disposition: entry.disposition,
  });
}

export const ASSURANCE_STANDARD_JOINS = deepFreeze(
  ASSURANCE_STANDARD_JOINS_SOURCE.map(normalizeJoin).sort((left, right) => (
    compareAscii(left.identity, right.identity)
  )),
);

const JOINS_BY_IDENTITY = new Map(ASSURANCE_STANDARD_JOINS.map((join) => [join.identity, join]));

/**
 * Resolve an exact schema identity to registry metadata, or null.
 *
 * The identity must appear verbatim in `ASSURANCE_STANDARD_JOINS`; otherwise
 * no standard reference is produced. The returned record is frozen metadata
 * (`disposition: 'metadata_only'`) and carries no compliance language.
 *
 * @param {string} identity - exact schema identity, e.g. `sbom:CycloneDX:1.7`.
 * @returns {object|null} Deep-frozen metadata record or null.
 */
export function resolveAssuranceStandard(identity) {
  if (typeof identity !== 'string') return null;
  return JOINS_BY_IDENTITY.get(identity) ?? null;
}

/**
 * Validate that the pack references only registered metadata-only standards.
 * Throws `AssuranceStandardsPackError` on any unknown/duplicate identity or
 * non-metadata-only registry entry.
 */
export function validateAssuranceStandardsPack() {
  const identities = ASSURANCE_STANDARD_JOINS.map(({ identity }) => identity);
  if (new Set(identities).size !== identities.length) fail('DUPLICATE_IDENTITY', 'joins must be unique');
  for (const join of ASSURANCE_STANDARD_JOINS_SOURCE) normalizeJoin(join);
  return ASSURANCE_STANDARD_JOINS;
}
