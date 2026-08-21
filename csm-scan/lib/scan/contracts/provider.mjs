import {
  assertDataOnly,
  compareAscii,
  deepFreeze,
  PROVIDER_DIMENSION_COUNT,
  PROVIDER_DIMENSION_IDS,
} from "./dimension.mjs";
import { DIMENSION_EVIDENCE_CATEGORIES } from "./evidence.mjs";

export const PROVIDER_SCHEMA_VERSION = 1;

export const PROVIDER_CATEGORIES = deepFreeze(
  Object.fromEntries(PROVIDER_DIMENSION_IDS.map((id) => [id, DIMENSION_EVIDENCE_CATEGORIES[id]])),
);

const PROVIDER_KEYS = Object.freeze(["apiVersion", "dimensions", "id"]);
const CAPABILITY_KEYS = Object.freeze(["categories", "dimensionId"]);
const PROVIDER_ID_PATTERN = /^PRV-[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$/;

export class ProviderContractError extends TypeError {
  constructor(code, message) {
    super(`Invalid provider contract: ${message}`);
    this.name = "ProviderContractError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ProviderContractError(code, message);
}

function exactKeys(value, expected, label) {
  const keys = Object.keys(value).toSorted(compareAscii);
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail("UNKNOWN_FIELD", `${label} fields do not match the schema`);
  }
}

function normalizeCapability(capability) {
  if (capability === null || typeof capability !== "object" || Array.isArray(capability)) {
    fail("INVALID_TYPE", "provider capability must be an object");
  }
  exactKeys(capability, CAPABILITY_KEYS, "provider capability");
  if (!PROVIDER_DIMENSION_IDS.includes(capability.dimensionId)) {
    fail("UNKNOWN_DIMENSION", "provider capability dimension is not allowlisted");
  }
  const allowed = PROVIDER_CATEGORIES[capability.dimensionId];
  if (
    !Array.isArray(capability.categories) ||
    capability.categories.length === 0 ||
    capability.categories.length > allowed.length
  ) {
    fail("BOUND_EXCEEDED", "provider categories must be a bounded non-empty array");
  }
  const categories = capability.categories
    .map((category) => {
      if (typeof category !== "string" || !allowed.includes(category)) {
        fail("UNKNOWN_CATEGORY", "provider category is not allowlisted for the dimension");
      }
      return category;
    })
    .toSorted(compareAscii);
  if (new Set(categories).size !== categories.length)
    fail("DUPLICATE_ID", "provider categories must be unique");
  return { dimensionId: capability.dimensionId, categories };
}

export function validateProvider(provider) {
  assertDataOnly(provider, ProviderContractError);
  if (provider === null || typeof provider !== "object" || Array.isArray(provider)) {
    fail("INVALID_TYPE", "provider must be an object");
  }
  exactKeys(provider, PROVIDER_KEYS, "provider");
  if (provider.apiVersion !== PROVIDER_SCHEMA_VERSION)
    fail("INVALID_VERSION", "provider apiVersion is unsupported");
  if (
    typeof provider.id !== "string" ||
    provider.id.length > 96 ||
    !PROVIDER_ID_PATTERN.test(provider.id)
  ) {
    fail("INVALID_ID", "provider id must be a stable versioned ASCII identifier");
  }
  if (
    !Array.isArray(provider.dimensions) ||
    provider.dimensions.length === 0 ||
    provider.dimensions.length > PROVIDER_DIMENSION_COUNT
  ) {
    fail("BOUND_EXCEEDED", "provider dimensions must be a bounded non-empty array");
  }
  const dimensions = provider.dimensions
    .map(normalizeCapability)
    .toSorted((left, right) => compareAscii(left.dimensionId, right.dimensionId));
  if (new Set(dimensions.map(({ dimensionId }) => dimensionId)).size !== dimensions.length) {
    fail("DUPLICATE_ID", "provider dimensions must be unique");
  }
  return deepFreeze({ id: provider.id, apiVersion: PROVIDER_SCHEMA_VERSION, dimensions });
}

export function validateProviders(providers) {
  assertDataOnly(providers, ProviderContractError, { maxArray: 256, maxNodes: 8192 });
  if (!Array.isArray(providers) || providers.length > 256)
    fail("BOUND_EXCEEDED", "providers must be a bounded array");
  const result = providers.map(validateProvider);
  if (new Set(result.map(({ id }) => id)).size !== result.length) {
    fail("DUPLICATE_ID", "providers contain duplicate identifiers");
  }
  return deepFreeze(result.toSorted((left, right) => compareAscii(left.id, right.id)));
}
