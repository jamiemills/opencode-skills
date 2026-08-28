"use strict";

import { createSchemaValidator } from "../../../lib/schema-runtime/index.mjs";
import schema from "../schemas/config.schema.json" with { type: "json" };

export const SKILL_NAME = "csm-plan";
export const CONFIG_SCHEMA_ID = "csm-plan-config/1";
export const DEFAULT_CONFIG = Object.freeze({ verbosity: "normal", batchSize: 5 });

const validator = createSchemaValidator({ schemas: [schema] });

function configFailure(code, message) {
  return Object.assign(new Error(message), { code });
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function summarizeErrors(errors) {
  return errors
    .map((error) => `${error.instancePath || "/"} ${error.keyword}: ${error.message}`)
    .join("; ");
}

export function resolveSkillConfig(effectiveConfig) {
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
    return {
      config: Object.freeze({ ...DEFAULT_CONFIG }),
      schema: CONFIG_SCHEMA_ID,
      source: "defaults",
    };
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
  return {
    config: Object.freeze({ ...DEFAULT_CONFIG, ...namespace }),
    schema: CONFIG_SCHEMA_ID,
    source: "configured",
  };
}
