"use strict";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

function scanJsonForDuplicateKeys(text) {
  let offset = 0;

  function whitespace() {
    while (/\s/.test(text[offset] ?? "")) offset += 1;
  }

  function string() {
    const start = offset;
    if (text[offset] !== '"') throw new SyntaxError(`expected string at ${offset}`);
    offset += 1;
    while (offset < text.length) {
      if (text[offset] === "\\") {
        offset += 2;
        continue;
      }
      if (text[offset] === '"') {
        offset += 1;
        return JSON.parse(text.slice(start, offset));
      }
      offset += 1;
    }
    throw new SyntaxError("unterminated JSON string");
  }

  function value() {
    whitespace();
    if (text[offset] === "{") return object();
    if (text[offset] === "[") return array();
    if (text[offset] === '"') {
      string();
      return;
    }
    const start = offset;
    while (!/[\s,\]}]/.test(text[offset] ?? "")) offset += 1;
    if (start === offset) throw new SyntaxError(`expected JSON value at ${offset}`);
  }

  function object() {
    offset += 1;
    whitespace();
    const keys = new Set();
    if (text[offset] === "}") {
      offset += 1;
      return;
    }
    while (true) {
      whitespace();
      const key = string();
      if (keys.has(key)) throw new SyntaxError(`duplicate JSON object key ${JSON.stringify(key)}`);
      keys.add(key);
      whitespace();
      if (text[offset++] !== ":") throw new SyntaxError(`expected ':' at ${offset - 1}`);
      value();
      whitespace();
      if (text[offset] === "}") {
        offset += 1;
        return;
      }
      if (text[offset++] !== ",") throw new SyntaxError(`expected ',' at ${offset - 1}`);
    }
  }

  function array() {
    offset += 1;
    whitespace();
    if (text[offset] === "]") {
      offset += 1;
      return;
    }
    while (true) {
      value();
      whitespace();
      if (text[offset] === "]") {
        offset += 1;
        return;
      }
      if (text[offset++] !== ",") throw new SyntaxError(`expected ',' at ${offset - 1}`);
    }
  }

  value();
  whitespace();
  if (offset !== text.length) throw new SyntaxError(`unexpected JSON input at ${offset}`);
}

export function parseJson(text) {
  if (typeof text !== "string") throw new TypeError("JSON input must be a string");
  scanJsonForDuplicateKeys(text);
  return JSON.parse(text);
}

function canonical(value, seen = new Set()) {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("canonical JSON cannot contain non-finite numbers");
    return JSON.stringify(value);
  }
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  )
    throw new TypeError("canonical JSON cannot contain non-JSON values");
  if (seen.has(value)) throw new TypeError("canonical JSON cannot contain cycles");
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index))
        throw new TypeError("canonical JSON cannot contain sparse arrays");
    }
    result = `[${value.map((item) => canonical(item, seen)).join(",")}]`;
  } else {
    result = `{${Object.keys(value)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key], seen)}`)
      .join(",")}}`;
  }
  seen.delete(value);
  return result;
}

export function canonicalize(value) {
  return canonical(value);
}

export function digest(value) {
  return `sha256:${createHash("sha256").update(canonicalize(value), "utf8").digest("hex")}`;
}

export function createSchemaValidator({ schemas = [], formats = true } = {}) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictTypes: false,
    strictRequired: false,
    unevaluated: true,
    validateFormats: formats,
  });
  if (formats) addFormats(ajv);
  for (const schema of schemas) ajv.addSchema(schema);
  return {
    validate(schemaId, instance) {
      const validate = ajv.getSchema(schemaId) ?? ajv.compile(schemaId);
      const valid = validate(instance);
      return { valid, errors: valid ? [] : [...(validate.errors ?? [])] };
    },
    dialect: "https://json-schema.org/draft/2020-12/schema",
    supported: [
      "$ref",
      "$defs",
      "oneOf",
      "if/then/else",
      "unevaluatedProperties",
      ...(formats ? ["formats"] : []),
    ],
  };
}

function semanticError(keyword, instancePath, message) {
  return { keyword, instancePath, schemaPath: "", params: {}, message };
}

function semanticResult(errors) {
  return { valid: errors.length === 0, errors };
}

function schemaPathWithinRoot(root, schemaPath) {
  if (
    typeof schemaPath !== "string" ||
    !schemaPath ||
    isAbsolute(schemaPath) ||
    /^[A-Za-z]:[\\/]/.test(schemaPath)
  )
    return false;
  if (schemaPath.split(/[\\/]/).includes("..")) return false;
  const relativePath = relative(root, resolve(root, schemaPath));
  return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function validateRegistryManifest(registry, root) {
  if (
    !registry ||
    typeof registry !== "object" ||
    Array.isArray(registry) ||
    registry.format !== "csm-schema-registry/1"
  )
    throw new TypeError("unsupported schema registry format");
  if (registry.unknownRevisionPolicy !== "reject" || registry.revisionPolicy !== "immutable")
    throw new TypeError("schema registry must reject unknown immutable revisions");
  if (!Array.isArray(registry.entries))
    throw new TypeError("schema registry entries must be an array");

  const ids = new Set();
  const aliases = new Set();
  for (const entry of registry.entries) {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      typeof entry.id !== "string" ||
      !Number.isInteger(entry.revision)
    )
      throw new TypeError("registry entry must have an id and integer revision");
    if (!/^csm-[a-z0-9][a-z0-9-]*\/[1-9][0-9]*$/.test(entry.id))
      throw new TypeError(`registry entry id is not canonical: ${entry.id}`);
    if (entry.id !== `${entry.id.split("/")[0]}/${entry.revision}`)
      throw new TypeError(`registry entry id/revision mismatch: ${entry.id}`);
    if (ids.has(entry.id)) throw new TypeError(`duplicate registry id: ${entry.id}`);
    ids.add(entry.id);
    if (entry.immutable !== true)
      throw new TypeError(`registry entry is not immutable: ${entry.id}`);
    if (!Array.isArray(entry.aliases) || entry.aliases.some((alias) => typeof alias !== "string"))
      throw new TypeError(`invalid aliases for ${entry.id}`);
    for (const alias of entry.aliases) {
      if (aliases.has(alias)) throw new TypeError(`duplicate registry alias: ${alias}`);
      aliases.add(alias);
    }
    if (entry.unknownFieldPolicy !== "reject" && entry.unknownFieldPolicy !== "opaque-extension")
      throw new TypeError(`unknown-field policy missing for ${entry.id}`);
    if (
      entry.unknownFieldPolicy === "opaque-extension" &&
      (!Array.isArray(entry.opaqueExtensionPoints) ||
        entry.opaqueExtensionPoints.some((point) => typeof point !== "string"))
    )
      throw new TypeError(`opaque extension points missing for ${entry.id}`);
    if (!schemaPathWithinRoot(root, entry.schemaPath))
      throw new TypeError(`schema path escapes registry root: ${entry.schemaPath}`);
    if (
      typeof entry.schemaContentDigest !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(entry.schemaContentDigest)
    )
      throw new TypeError(`invalid schema content digest for ${entry.id}`);
  }
  for (const alias of aliases)
    if (ids.has(alias)) throw new TypeError(`alias collides with id: ${alias}`);
}

function verifyRegistry({ registry, schemas, root }) {
  validateRegistryManifest(registry, root);
  const byId = new Map();
  const aliases = new Map();
  const schemaByPath = new Map(schemas.map((schema) => [schema.registryPath, schema]));
  for (const entry of registry.entries) {
    const schemaPath = entry.schemaPath;
    if (!schemaPathWithinRoot(root, schemaPath))
      throw new TypeError(`schema path escapes registry root: ${schemaPath}`);
    const schema = schemaByPath.get(schemaPath);
    if (!schema) throw new TypeError(`missing schema for registry entry: ${entry.id}`);
    if (
      schema.$id !== entry.id ||
      (schema.revision !== undefined && schema.revision !== entry.revision)
    )
      throw new TypeError(`schema identity mismatch: ${entry.id}`);
    if (entry.schemaContentDigest !== digest(schema))
      throw new TypeError(`schema content digest mismatch: ${entry.id}`);
    byId.set(entry.id, { ...entry, schema });
    for (const alias of entry.aliases) {
      if (byId.has(alias) || aliases.has(alias))
        throw new TypeError(`duplicate registry alias: ${alias}`);
      aliases.set(alias, entry.id);
    }
  }
  for (const alias of aliases.keys())
    if (byId.has(alias)) throw new TypeError(`alias collides with id: ${alias}`);
  return { byId, aliases };
}

export function createSchemaRegistry({ registry, schemas, root = process.cwd() } = {}) {
  const normalized = schemas;
  const verified = verifyRegistry({ registry, schemas: normalized, root: resolve(root) });
  const validator = createSchemaValidator({ schemas: normalized });
  const resolveEntry = (id, revision) => {
    const exactId = `${id}/${revision}`;
    const entry =
      verified.byId.get(exactId) ??
      verified.byId.get(id) ??
      verified.byId.get(verified.aliases.get(id));
    if (!entry || entry.revision !== revision || entry.id !== exactId)
      throw new RangeError(`unknown schema revision: ${exactId}`);
    return entry;
  };
  const validateEnvelope = (envelope) => {
    const structural = validator.validate("csm-envelope/1", envelope);
    if (!structural.valid) return structural;
    const errors = [];
    if (envelope.artifact.runId !== envelope.run.runId)
      errors.push(
        semanticError("identity", "/artifact/runId", "artifact.runId must equal run.runId"),
      );
    const hasParentRunId = Object.hasOwn(envelope.run, "parentRunId");
    const hasDelegationRunFields =
      Object.hasOwn(envelope.run, "delegatedFromRunId") ||
      Object.hasOwn(envelope.run, "delegationId");
    if ((hasParentRunId || hasDelegationRunFields) && !envelope.delegation) {
      errors.push(
        semanticError(
          "delegation",
          "/delegation",
          "run delegation fields require a delegation object",
        ),
      );
    } else if (envelope.delegation) {
      const { delegation } = envelope;
      if (
        !hasDelegationRunFields ||
        delegation.toRunId !== envelope.run.runId ||
        delegation.fromRunId === envelope.run.runId ||
        delegation.fromRunId !== envelope.run.delegatedFromRunId ||
        delegation.delegationId !== envelope.run.delegationId
      )
        errors.push(
          semanticError(
            "delegation",
            "/delegation",
            "delegation must match run delegation identity fields",
          ),
        );
      if (!hasParentRunId || delegation.fromRunId !== envelope.run.parentRunId)
        errors.push(
          semanticError(
            "delegation",
            "/run/parentRunId",
            "run.parentRunId must equal delegation.fromRunId",
          ),
        );
    }
    const payloadRef = envelope.payloadSchema;
    const payloadEntry = verified.byId.get(payloadRef.id);
    if (!payloadEntry || payloadEntry.revision !== payloadRef.revision) {
      errors.push(
        semanticError(
          "schemaReference",
          "/payloadSchema",
          "payload schema ID and revision are not registered",
        ),
      );
    } else {
      const payloadResult = validator.validate(payloadEntry.id, envelope.payload);
      for (const error of payloadResult.errors)
        errors.push({ ...error, instancePath: `/payload${error.instancePath}` });
      if (payloadEntry.id === "csm-artifact/1" && envelope.payload?.artifact) {
        const fields = ["artifactId", "runId", "digest", "kind", "owner", "createdAt", "revision"];
        for (const field of fields)
          if (envelope.payload.artifact[field] !== envelope.artifact[field])
            errors.push(
              semanticError(
                "identity",
                `/payload/artifact/${field}`,
                `payload.artifact.${field} must equal artifact.${field}`,
              ),
            );
      }
    }
    if (Array.isArray(envelope.journal)) {
      for (const [index, event] of envelope.journal.entries()) {
        const eventResult = validator.validate("csm-journal-event/1", event);
        for (const error of eventResult.errors)
          errors.push({ ...error, instancePath: `/journal/${index}${error.instancePath}` });
      }
      errors.push(...validateJournal(envelope.journal, { runId: envelope.run.runId }).errors);
      if (
        envelope.journal.length > 0 &&
        envelope.journal.at(-1)?.lifecycleStatus !== envelope.lifecycleStatus
      )
        errors.push(
          semanticError(
            "lifecycleConsistency",
            "/lifecycleStatus",
            "journal terminal lifecycleStatus must equal envelope.lifecycleStatus",
          ),
        );
    }
    return semanticResult(errors);
  };
  return {
    registry,
    entries: [...verified.byId.values()],
    resolve: resolveEntry,
    validate(id, instance) {
      const entry = verified.byId.get(id) ?? verified.byId.get(verified.aliases.get(id));
      if (!entry) throw new RangeError(`unknown schema revision: ${id}`);
      if (entry.id === "csm-envelope/1") return validateEnvelope(instance);
      const structural = validator.validate(entry.id, instance);
      if (!structural.valid || entry.id !== "csm-projection/1") return structural;
      const errors = [];
      if (
        instance.approval.status === "approved" &&
        bindingDoesNotMatch(instance.approval.binding, instance)
      )
        errors.push(
          semanticError(
            "approvalBinding",
            "/approval/binding",
            "approved projection binding must match projection metadata",
          ),
        );
      return semanticResult(errors);
    },
    validateEnvelope,
    validateJournal,
  };
}

export async function loadSchemaRegistry({
  root = fileURLToPath(new URL("../../", import.meta.url)),
} = {}) {
  const registryRoot = resolve(root);
  const registry = parseJson(
    await readFile(resolve(registryRoot, "schemas/registry.json"), "utf8"),
  );
  validateRegistryManifest(registry, registryRoot);
  const schemas = await Promise.all(
    registry.entries.map(async (entry) => {
      const schema = parseJson(await readFile(resolve(registryRoot, entry.schemaPath), "utf8"));
      Object.defineProperty(schema, "registryPath", { value: entry.schemaPath, enumerable: false });
      return schema;
    }),
  );
  return createSchemaRegistry({ registry, schemas, root: registryRoot });
}

export function validateJournal(events, { runId } = {}) {
  const errors = [];
  const ids = new Set();
  let lifecycle = "initial";
  const transitions = {
    initial: ["active"],
    active: ["active", "completed", "failed", "blocked", "quarantined", "superseded"],
    blocked: ["active", "failed", "completed", "quarantined"],
    completed: [],
    failed: [],
    quarantined: [],
    superseded: [],
  };
  if (!Array.isArray(events))
    return semanticResult([semanticError("type", "/journal", "journal must be an array")]);
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const path = `/journal/${index}`;
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      errors.push(semanticError("type", path, "journal event must be an object"));
      continue;
    }
    for (const field of [
      "eventId",
      "runId",
      "sequence",
      "eventType",
      "occurredAt",
      "lifecycleStatus",
    ])
      if (!Object.hasOwn(event, field))
        errors.push(
          semanticError("required", `${path}/${field}`, `journal event requires ${field}`),
        );
    if (event.sequence !== index)
      errors.push(
        semanticError(
          "contiguousSequence",
          `${path}/sequence`,
          "journal sequence must start at zero and be contiguous",
        ),
      );
    if (ids.has(event.eventId))
      errors.push(semanticError("uniqueEventId", `${path}/eventId`, "eventId must be unique"));
    if (runId && event.runId !== runId)
      errors.push(semanticError("runConsistency", `${path}/runId`, "journal event runId mismatch"));
    if (!transitions[lifecycle]?.includes(event.lifecycleStatus))
      errors.push(
        semanticError(
          "lifecycleTransition",
          `${path}/lifecycleStatus`,
          "illegal journal lifecycle transition",
        ),
      );
    lifecycle = event.lifecycleStatus;
    if (
      ["artifact.created", "artifact.verified", "artifact.quarantined"].includes(event.eventType) &&
      !event.artifactId
    )
      errors.push(
        semanticError(
          "requiredEventField",
          `${path}/artifactId`,
          "artifact events require artifactId",
        ),
      );
    if (
      typeof event.eventType === "string" &&
      event.eventType.startsWith("delegation.") &&
      (!event.data || typeof event.data.delegationId !== "string")
    )
      errors.push(
        semanticError(
          "requiredEventField",
          `${path}/data/delegationId`,
          "delegation events require data.delegationId",
        ),
      );
    if (event.parentEventId && !ids.has(event.parentEventId))
      errors.push(
        semanticError(
          "parentReference",
          `${path}/parentEventId`,
          "parent event must precede its child",
        ),
      );
    ids.add(event.eventId);
  }
  return semanticResult(errors);
}

function bindingDoesNotMatch(binding, projection) {
  const expected = {
    source: projection.source,
    sourceRunId: projection.sourceRunId,
    sourceOwner: projection.sourceOwner,
    renderer: projection.renderer,
    rendererDigest: projection.rendererDigest,
    profile: projection.profile,
    profileDigest: projection.profileDigest,
    outputDigest: projection.outputDigest,
  };
  return canonicalize(binding) !== canonicalize(expected);
}
