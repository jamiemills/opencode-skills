"use strict";

import { lstat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSchemaValidator, digest, parseJson } from "../schema-runtime/index.mjs";
import { readDurableBytes } from "../durable-json/index.mjs";

export const CONFIG_SCHEMA_ID = "csm-skills-config/1";
export const CONFIG_SCHEMA_VERSION = 1;

export const PROJECT_CONFIG_FILE_NAME = ".csm-skills.json";
export const USER_CONFIG_DIR_NAME = "csm";
export const USER_CONFIG_FILE_NAME = "skills.json";

export const LIMITS = Object.freeze({
  maxFileBytes: 1024 * 1024,
  maxJsonDepth: 32,
});

export const SKILL_NAMES = Object.freeze([
  "csm-autoresearch",
  "csm-bdd-tdd",
  "csm-browse",
  "csm-build",
  "csm-ddd",
  "csm-deep-research",
  "csm-grill",
  "csm-make-tests",
  "csm-orchestrate",
  "csm-plan",
  "csm-review",
  "csm-review-python",
  "csm-scan",
  "csm-upload",
]);

const SKILL_NAME_SET = new Set(SKILL_NAMES);
const TOP_LEVEL_KEYS = ["schema", "version", "skills"];
const ENV_REF_GRAMMAR = "[A-Za-z_][A-Za-z0-9_]*";
const ENV_REF_AT = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}/;

function configFailure(code, message, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code });
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function setOwn(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return target;
}

export function projectConfigPath(projectRoot = process.cwd()) {
  return resolve(projectRoot, PROJECT_CONFIG_FILE_NAME);
}

function resolveUserConfigPath(env) {
  const xdg =
    typeof env?.XDG_CONFIG_HOME === "string" && env.XDG_CONFIG_HOME.length > 0
      ? env.XDG_CONFIG_HOME
      : null;
  if (xdg !== null) {
    if (!isAbsolute(xdg)) return resolveUserConfigPath({}); // relative XDG is ignored per spec
    return join(xdg, USER_CONFIG_DIR_NAME, USER_CONFIG_FILE_NAME);
  }
  const home = typeof env?.HOME === "string" && env.HOME.length > 0 ? env.HOME : homedir();
  if (!home) return null;
  return join(home, ".config", USER_CONFIG_DIR_NAME, USER_CONFIG_FILE_NAME);
}

export function userConfigPath(env = process.env) {
  return resolveUserConfigPath(env);
}

function builtinDefaults() {
  const skills = {};
  for (const name of SKILL_NAMES) setOwn(skills, name, {});
  return { schema: CONFIG_SCHEMA_ID, version: CONFIG_SCHEMA_VERSION, skills };
}

export function mergeConfig(base, overlay) {
  if (!isPlainObject(base)) throw new TypeError("mergeConfig base must be a plain object");
  if (!isPlainObject(overlay)) throw new TypeError("mergeConfig overlay must be a plain object");
  return mergeObjects(base, overlay);
}

function mergeObjects(base, overlay) {
  const out = {};
  for (const key of Object.keys(base)) setOwn(out, key, base[key]);
  for (const key of Object.keys(overlay)) {
    const value = overlay[key];
    if (value === undefined) continue;
    if (isPlainObject(value) && Object.hasOwn(out, key) && isPlainObject(out[key]))
      setOwn(out, key, mergeObjects(out[key], value));
    else setOwn(out, key, value);
  }
  return out;
}

function envValue(env, name) {
  if (env === null || typeof env !== "object" || !Object.hasOwn(env, name)) return undefined;
  const raw = env[name];
  return raw === undefined ? undefined : String(raw);
}

function expandString(text, env, refs, path) {
  let out = "";
  let offset = 0;
  while (offset < text.length) {
    if (text[offset] === "$" && text[offset + 1] === "{") {
      const match = ENV_REF_AT.exec(text.slice(offset));
      if (!match)
        throw configFailure(
          "invalid-env-ref",
          `malformed environment reference at ${path} offset ${offset}: ${JSON.stringify(text)} does not match \${VAR_NAME} with VAR_NAME matching ${ENV_REF_GRAMMAR}`,
        );
      const name = match[1];
      const value = envValue(env, name);
      if (value === undefined)
        throw configFailure(
          "missing-env",
          `environment variable '${name}' referenced at ${path} is not set`,
        );
      refs.add(name);
      out += value;
      offset += match[0].length;
      continue;
    }
    out += text[offset];
    offset += 1;
  }
  return out;
}

function expandValue(value, env, refs, path) {
  if (typeof value === "string") return expandString(value, env, refs, path);
  if (Array.isArray(value))
    return value.map((item, index) => expandValue(item, env, refs, `${path}/${index}`));
  if (isPlainObject(value)) {
    const out = {};
    for (const key of Object.keys(value))
      setOwn(out, key, expandValue(value[key], env, refs, `${path}/${key}`));
    return out;
  }
  return value;
}

export function expandEnvRefs(value, { env = process.env } = {}) {
  const refs = new Set();
  const expanded = expandValue(value, env, refs, "");
  return { value: expanded, envRefs: [...refs].toSorted() };
}

export function computeEffectiveDigest(effective) {
  return digest(effective);
}

let envelopeValidatorPromise = null;

function loadEnvelopeValidator() {
  if (!envelopeValidatorPromise) {
    envelopeValidatorPromise = readFile(
      fileURLToPath(new URL("../../schemas/csm-skills-config.schema.json", import.meta.url)),
      "utf8",
    ).then((text) => createSchemaValidator({ schemas: [parseJson(text)] }));
  }
  return envelopeValidatorPromise;
}

export async function validateConfigEnvelope(value) {
  const validator = await loadEnvelopeValidator();
  return validator.validate(CONFIG_SCHEMA_ID, value);
}

function summarizeAjvErrors(errors) {
  return errors
    .map((error) => `${error.instancePath || "/"} ${error.keyword}: ${error.message}`)
    .join("; ");
}

function assertEnvelopeShape(config, label) {
  if (!isPlainObject(config))
    throw configFailure("config-schema", `${label}: root must be a JSON object at /`);
  for (const key of Object.keys(config))
    if (!TOP_LEVEL_KEYS.includes(key))
      throw configFailure(
        "unknown-key",
        `${label}: unknown top-level key '${key}' at /${key} (allowed: ${TOP_LEVEL_KEYS.join(", ")})`,
      );
  if (config.schema !== CONFIG_SCHEMA_ID)
    throw configFailure(
      "config-schema",
      `${label}: schema must be '${CONFIG_SCHEMA_ID}' at /schema (got ${JSON.stringify(config.schema)})`,
    );
  if (Object.hasOwn(config, "version") && config.version !== CONFIG_SCHEMA_VERSION)
    throw configFailure(
      "config-schema",
      `${label}: version must be ${CONFIG_SCHEMA_VERSION} at /version (got ${JSON.stringify(config.version)})`,
    );
  if (!isPlainObject(config.skills))
    throw configFailure("config-schema", `${label}: skills must be an object at /skills`);
  for (const key of Object.keys(config.skills)) {
    if (!SKILL_NAME_SET.has(key))
      throw configFailure(
        "unknown-skill",
        `${label}: unknown skill namespace '${key}' at /skills/${key} (known: ${SKILL_NAMES.join(", ")})`,
      );
    if (!isPlainObject(config.skills[key]))
      throw configFailure(
        "config-schema",
        `${label}: skill namespace '${key}' must be an object at /skills/${key}`,
      );
  }
}

function assertEnvelopeSchema(config, label, validator) {
  const result = validator.validate(CONFIG_SCHEMA_ID, config);
  if (!result.valid)
    throw configFailure(
      "config-schema",
      `${label}: violates ${CONFIG_SCHEMA_ID}: ${summarizeAjvErrors(result.errors)}`,
    );
}

function assertJsonDepth(value, maxDepth, label) {
  const stack = [[value, 1]];
  while (stack.length > 0) {
    const [current, depth] = stack.pop();
    if (depth > maxDepth)
      throw configFailure(
        "depth-limit",
        `${label}: JSON nesting exceeds the maximum depth of ${maxDepth}`,
      );
    if (current !== null && typeof current === "object") {
      if (Array.isArray(current)) {
        for (const item of current) stack.push([item, depth + 1]);
      } else {
        for (const key of Object.keys(current)) stack.push([current[key], depth + 1]);
      }
    }
  }
}

async function readConfigLayer(kind, filePath, { required }) {
  let info;
  try {
    info = await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      if (required)
        throw configFailure(
          "missing-config",
          `explicit ${kind} config path does not exist (fail closed): ${filePath}`,
        );
      return { present: false };
    }
    throw error;
  }
  if (info.isSymbolicLink())
    throw configFailure("symlink", `${kind} config path is a symbolic link: ${filePath}`);
  if (!info.isFile())
    throw configFailure(
      "not-regular-file",
      `${kind} config path is not a regular file: ${filePath}`,
    );
  if (info.size > LIMITS.maxFileBytes)
    throw configFailure(
      "size-limit",
      `${kind} config file exceeds ${LIMITS.maxFileBytes} bytes: ${filePath} (${info.size} bytes)`,
    );
  let bytes;
  try {
    bytes = await readDurableBytes(filePath);
  } catch (error) {
    if (error?.code === "ELOOP")
      throw configFailure("symlink", `${kind} config path is a symbolic link: ${filePath}`);
    if (error?.code === "symlink" || error?.code === "path-containment")
      throw configFailure(
        "symlink",
        `${kind} config path contains a symbolic link component: ${filePath}`,
      );
    if (error?.code === "concurrent-replacement")
      throw configFailure(
        "concurrent-replacement",
        `${kind} config file changed while being read: ${filePath}`,
      );
    throw error;
  }
  if (bytes.length === 0)
    throw configFailure("invalid-json", `${kind} config file is empty: ${filePath}`);
  if (bytes.length > LIMITS.maxFileBytes)
    throw configFailure(
      "size-limit",
      `${kind} config file exceeds ${LIMITS.maxFileBytes} bytes: ${filePath} (${bytes.length} bytes)`,
    );
  let parsed;
  try {
    parsed = parseJson(bytes.toString("utf8"));
  } catch (error) {
    throw configFailure(
      "invalid-json",
      `${kind} config file is not strict JSON (${filePath}): ${error.message}`,
      error,
    );
  }
  assertJsonDepth(parsed, LIMITS.maxJsonDepth, `${kind} config file (${filePath})`);
  return { present: true, config: parsed };
}

export async function resolveConfig(options = {}) {
  const { projectRoot = process.cwd(), configPath = null, env = process.env } = options;
  if (typeof projectRoot !== "string" || projectRoot.length === 0)
    throw new TypeError("projectRoot must be a non-empty string");
  let explicitPath = null;
  if (configPath !== null && configPath !== undefined) {
    if (typeof configPath !== "string" || configPath.trim().length === 0)
      throw new TypeError("configPath must be a non-empty string when provided");
    explicitPath = resolve(configPath);
  }
  const validator = await loadEnvelopeValidator();

  const defaults = builtinDefaults();
  const layerSpecs = [
    { kind: "project", path: projectConfigPath(projectRoot), required: false },
    { kind: "user", path: resolveUserConfigPath(env), required: false },
    { kind: "run", path: explicitPath, required: true },
  ];

  const sources = [
    { kind: "defaults", path: null, present: true, contentDigest: digest(defaults) },
  ];
  const envRefs = new Set();
  let effective = defaults;

  for (const layer of layerSpecs) {
    if (layer.path === null) {
      sources.push({ kind: layer.kind, path: null, present: false, contentDigest: null });
      continue;
    }
    const read = await readConfigLayer(layer.kind, layer.path, { required: layer.required });
    if (!read.present) {
      sources.push({ kind: layer.kind, path: layer.path, present: false, contentDigest: null });
      continue;
    }
    const label = `${layer.kind} config (${layer.path})`;
    assertEnvelopeShape(read.config, label);
    assertEnvelopeSchema(read.config, label, validator);
    const expanded = expandEnvRefs(read.config, { env });
    for (const name of expanded.envRefs) envRefs.add(name);
    effective = mergeConfig(effective, expanded.value);
    sources.push({
      kind: layer.kind,
      path: layer.path,
      present: true,
      contentDigest: digest(read.config),
    });
  }

  assertEnvelopeShape(effective, "effective config");
  assertEnvelopeSchema(effective, "effective config", validator);
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    effective,
    effectiveDigest: digest(effective),
    sources,
    envRefs: [...envRefs].toSorted(),
  };
}
