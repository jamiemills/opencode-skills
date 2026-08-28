"use strict";

import { homedir } from "node:os";
import { join } from "node:path";
import { createSchemaValidator } from "../../lib/schema-runtime/index.mjs";
import { readDurableJson } from "../../lib/durable-json/index.mjs";
import schema from "../schemas/config.schema.json" with { type: "json" };

/**
 * Legacy-compatible suite adapter for csm-upload.
 *
 * The legacy `~/.agents/csm-upload.json` config file and the CLI flags
 * (`--github`, `--repo`, `--label`, `--confirm-permanent`) remain the
 * authoritative source for existing upload behavior. This adapter is purely
 * additive: suite-config values apply only to fields the legacy file does not
 * set, legacy values always win on collision, and neither this module nor
 * `loadLegacyConfig()` ever writes, rewrites, migrates, or deletes the legacy
 * file. Malformed legacy input fails closed instead of being silently merged.
 */

export const SKILL_NAME = "csm-upload";
export const CONFIG_SCHEMA_ID = "csm-upload-config/1";
export const DEFAULT_CONFIG = Object.freeze({});
export const LEGACY_CONFIG_FIELDS = Object.freeze(["github", "pagesRepo", "label"]);
export const LEGACY_CONFIG_FILE_NAME = "csm-upload.json";

const validator = createSchemaValidator({ schemas: [schema] });

function configFailure(code, message, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code });
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function summarizeErrors(errors) {
  return errors
    .map((error) => `${error.instancePath || "/"} ${error.keyword}: ${error.message}`)
    .join("; ");
}

export function legacyConfigPath(env = process.env) {
  const home = typeof env?.HOME === "string" && env.HOME.length > 0 ? env.HOME : homedir();
  return join(home, ".agents", LEGACY_CONFIG_FILE_NAME);
}

/**
 * Read the legacy config fail-closed. Returns `{ present, config, path }`:
 * `present: false, config: null` when the file does not exist; a frozen copy
 * of the known legacy fields when it does. Malformed JSON, a non-object root,
 * or wrongly typed known fields throw a coded `legacy-config` error. The file
 * is never modified.
 */
export async function loadLegacyConfig({ env = process.env } = {}) {
  const path = legacyConfigPath(env);
  let raw;
  try {
    raw = await readDurableJson(path);
  } catch (error) {
    if (error?.code === "ENOENT") return { present: false, config: null, path };
    throw configFailure(
      "legacy-config",
      `csm-upload legacy config is unreadable (${path}): ${error.message}`,
      error,
    );
  }
  if (!isPlainObject(raw))
    throw configFailure(
      "legacy-config",
      `csm-upload legacy config must be a JSON object (${path})`,
    );
  const config = {};
  for (const field of LEGACY_CONFIG_FIELDS) {
    if (raw[field] === undefined) continue;
    if (typeof raw[field] !== "string" || raw[field].length === 0)
      throw configFailure(
        "legacy-config",
        `csm-upload legacy config field '${field}' must be a non-empty string (${path})`,
      );
    config[field] = raw[field];
  }
  return { present: true, config: Object.freeze(config), path };
}

function resolveNamespace(effectiveConfig) {
  if (!isPlainObject(effectiveConfig))
    throw configFailure(
      "config-schema",
      `${SKILL_NAME} config: effective config must be an object`,
    );
  if (!isPlainObject(effectiveConfig.skills))
    throw configFailure(
      "config-schema",
      `${SKILL_NAME} config: effective config has no skills object at /skills`,
    );
  const namespace = Object.hasOwn(effectiveConfig.skills, SKILL_NAME)
    ? effectiveConfig.skills[SKILL_NAME]
    : undefined;
  if (namespace === undefined || (isPlainObject(namespace) && Object.keys(namespace).length === 0))
    return { settings: {}, source: "defaults" };
  if (!isPlainObject(namespace))
    throw configFailure(
      "config-schema",
      `${SKILL_NAME} config: /skills/${SKILL_NAME} must be an object`,
    );
  const result = validator.validate(CONFIG_SCHEMA_ID, namespace);
  if (!result.valid) {
    const unknownKey = result.errors.find((error) => error.keyword === "additionalProperties");
    if (unknownKey)
      throw configFailure(
        "unknown-key",
        `${SKILL_NAME} config: unknown key '${unknownKey.params?.additionalProperty}' at /skills/${SKILL_NAME}/${unknownKey.params?.additionalProperty} (allowed: ${Object.keys(schema.properties).join(", ") || "none"})`,
      );
    throw configFailure(
      "skill-config",
      `${SKILL_NAME} config: /skills/${SKILL_NAME} violates ${CONFIG_SCHEMA_ID}: ${summarizeErrors(result.errors)}`,
    );
  }
  return { settings: namespace, source: "configured" };
}

/**
 * Resolve the csm-upload suite namespace additively over legacy config.
 * `legacy` is the legacy settings object (`loadLegacyConfig().config`) or
 * `null` when no legacy config exists. Legacy-set fields always win; suite
 * values fill only unset fields; `legacyMode` reports whether legacy config
 * exists. The returned config is advisory presentation-level defaulting —
 * publication authority, destinations, and confirmations stay with the legacy
 * file, CLI flags, and the upload script.
 */
export function resolveSkillConfig(effectiveConfig, { legacy = null } = {}) {
  if (legacy !== null && !isPlainObject(legacy))
    throw configFailure(
      "legacy-config",
      `${SKILL_NAME} config: legacy option must be an object or null`,
    );
  const { settings, source } = resolveNamespace(effectiveConfig);
  const merged = { ...settings };
  for (const field of LEGACY_CONFIG_FIELDS)
    if (legacy?.[field] !== undefined) merged[field] = legacy[field];
  const legacyMode = legacy !== null;
  return {
    config: Object.freeze({ ...merged, legacyMode }),
    schema: CONFIG_SCHEMA_ID,
    source,
    legacyMode,
  };
}
