import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const HEX64 = /^[a-f0-9]{64}$/;
const FORBIDDEN = /^(rawPrompt|prompt|secret|secrets|token|fullToolResult|toolResult)$/i;
const MANIFEST_SCHEMA = JSON.parse(
  readFileSync(new URL("../../schemas/csm-skill-manifest.schema.json", import.meta.url), "utf8"),
);
const TRACE_SCHEMA = JSON.parse(
  readFileSync(new URL("../../schemas/csm-trace.schema.json", import.meta.url), "utf8"),
);

export function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fail(message) {
  return { valid: false, error: message };
}

function hasForbidden(value, path = "$") {
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN.test(key)) return `${path}.${key} is not permitted`;
    const found = hasForbidden(child, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

function schemaTypeMatches(value, type) {
  if (type === "object")
    return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  return typeof value === type;
}

function schemaError(value, schema, path = "$") {
  if (schema.type && !schemaTypeMatches(value, schema.type))
    return `${path} must be ${schema.type}`;
  if (Object.hasOwn(schema, "const") && !Object.is(value, schema.const)) {
    return `${path} must equal ${JSON.stringify(schema.const)}`;
  }
  if (schema.enum && !schema.enum.some((allowed) => Object.is(value, allowed))) {
    return `${path} must be one of ${schema.enum.join(", ")}`;
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      return `${path} is too short`;
    if (schema.pattern && !new RegExp(schema.pattern).test(value))
      return `${path} has an invalid format`;
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) {
    return `${path} is below the minimum`;
  }
  if (schema.type === "array") {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      return `${path} requires items`;
    if (schema.uniqueItems) {
      const serialized = value.map((item) => JSON.stringify(item));
      if (new Set(serialized).size !== serialized.length)
        return `${path} must contain unique items`;
    }
    for (let index = 0; index < value.length; index += 1) {
      const error = schemaError(value[index], schema.items, `${path}[${index}]`);
      if (error) return error;
    }
  }
  if (schema.type === "object") {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) return `${path}.${key} is required`;
    }
    for (const key of Object.keys(value)) {
      if (schema.additionalProperties === false && !Object.hasOwn(schema.properties ?? {}, key)) {
        return `${path}.${key} is not permitted`;
      }
      if (schema.properties?.[key]) {
        const error = schemaError(value[key], schema.properties[key], `${path}.${key}`);
        if (error) return error;
      }
    }
  }
  return null;
}

function validateAgainstSchema(value, schema) {
  const error = schemaError(value, schema);
  return error ? fail(error) : null;
}

function validateLegacyManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
    return fail("unsupported legacy manifest shape");
  if (manifest.schema !== "csm-skill-manifest/0" || manifest.version !== 0)
    return fail("unsupported legacy manifest shape");
  const keys = Object.keys(manifest);
  if (keys.some((key) => !["schema", "version", "skills"].includes(key)))
    return fail("unsupported legacy manifest shape");
  if (!Array.isArray(manifest.skills) || manifest.skills.length === 0)
    return fail("unsupported legacy manifest shape");
  if (
    manifest.skills.some((skill) => typeof skill !== "string" || !/^csm-[a-z0-9-]+$/.test(skill))
  ) {
    return fail("unsupported legacy manifest shape");
  }
  if (new Set(manifest.skills).size !== manifest.skills.length)
    return fail("unsupported legacy manifest shape");
  return { valid: true, compatibility: "legacy-explicit" };
}

export function validateManifest(manifest, { allowLegacy = false } = {}) {
  if (manifest?.schema === "csm-skill-manifest/0") {
    return allowLegacy ? validateLegacyManifest(manifest) : fail("unknown manifest version");
  }
  if (!manifest || manifest.schema !== "csm-skill-manifest/1" || manifest.version !== 1)
    return fail("unknown manifest version");
  const schemaResult = validateAgainstSchema(manifest, MANIFEST_SCHEMA);
  if (schemaResult) return schemaResult;
  if (manifest.contentDigest !== "sha256") return fail("manifest contentDigest must be sha256");
  if (manifest.compatibility?.node !== ">=22 <25") return fail("unsupported node compatibility");
  if (!Array.isArray(manifest.skills) || manifest.skills.length === 0)
    return fail("manifest skills are required");
  if (manifest.eval?.mode !== "deterministic-fixtures" || manifest.trace?.mode !== "redacted")
    return fail("manifest evaluation and trace modes are incompatible");
  return { valid: true, compatibility: "current" };
}

export function validateTrace(trace, manifest) {
  const forbidden = hasForbidden(trace);
  if (forbidden) return fail(forbidden);
  if (!trace || trace.schema !== "csm-trace/1") return fail("unknown trace version");
  const schemaResult = validateAgainstSchema(trace, TRACE_SCHEMA);
  if (schemaResult) return schemaResult;
  if (!manifest || manifest.schema !== "csm-skill-manifest/1" || manifest.version !== 1)
    return fail("unknown manifest version");
  if (!HEX64.test(trace.manifest.contentDigest)) return fail("trace manifest digest is required");
  if (trace.manifest.schema !== manifest.schema || trace.manifest.version !== manifest.version)
    return fail("trace manifest does not match manifest version");
  const eventIds = new Set();
  for (let i = 0; i < trace.events.length; i += 1) {
    if (trace.events[i].sequence !== i) return fail("event sequence is not contiguous");
    if (eventIds.has(trace.events[i].eventId)) return fail("event IDs must be unique");
    eventIds.add(trace.events[i].eventId);
  }
  const ids = eventIds;
  const artifactIds = new Set();
  for (const artifact of trace.artifacts ?? []) {
    if (!ids.has(artifact.producedByEventId)) return fail("artifact event correlation is missing");
    if (!HEX64.test(artifact.sha256)) return fail("artifact sha256 is invalid");
    if (artifactIds.has(artifact.artifactId)) return fail("artifact IDs must be unique");
    artifactIds.add(artifact.artifactId);
  }
  if (trace.reproducibility?.deterministic !== true) return fail("trace is not deterministic");
  if (trace.redaction?.mode !== "default-deny") return fail("trace redaction must be default-deny");
  return { valid: true, compatibility: "current", artifactCount: trace.artifacts.length };
}

export function evaluateFixture(manifestPath, tracePath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const trace = JSON.parse(readFileSync(tracePath, "utf8"));
  const manifestResult = validateManifest(manifest);
  if (!manifestResult.valid) return manifestResult;
  return validateTrace(trace, manifest);
}
