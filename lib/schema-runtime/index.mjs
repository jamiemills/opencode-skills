"use strict";

import { createHash } from "node:crypto";
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
