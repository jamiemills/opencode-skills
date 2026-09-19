"use strict";

// T004: the provider-neutral PORT. A provider is a descriptor-only module under
// this directory named `providers/<id>.mjs`; the registry discovers it by naming
// convention and dynamically imports it, so adding a route (for example the
// Vercel AI Gateway in T024) is a new file, never an edit here. No transport is
// implemented in this module (T008/T024 do that); an unknown selected id is
// reported as unresolved and fail-open is handled by a later task.

import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PROVIDER_SELECTION_ENV = "CSM_DECISION_PROVIDER";
export const DEFAULT_PROVIDER_ID = "openrouter";

export const PROVIDER_DESCRIPTOR_FIELDS = Object.freeze([
  "id",
  "endpoint",
  "apiKeyEnv",
  "defaultModel",
  "buildRequest",
  "parseResponse",
  "classifyError",
]);

const PROVIDERS_DIR = dirname(fileURLToPath(import.meta.url));
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const RESERVED_PROVIDER_IDS = Object.freeze(["index"]);

// `providers/<id>.mjs` -> `<id>`; returns null for anything that is not a
// discoverable descriptor filename (so index.mjs, dotfiles, and non-.mjs files
// are skipped rather than guessed at).
export function providerIdFromFilename(filename) {
  if (typeof filename !== "string" || !filename.endsWith(".mjs")) return null;
  const id = filename.slice(0, -".mjs".length);
  if (!PROVIDER_ID_PATTERN.test(id) || RESERVED_PROVIDER_IDS.includes(id)) return null;
  return id;
}

export function validateProviderDescriptor(descriptor, { expectedId = null } = {}) {
  const problems = [];
  if (descriptor === null || typeof descriptor !== "object" || Array.isArray(descriptor))
    return ["descriptor must be an object"];
  for (const field of PROVIDER_DESCRIPTOR_FIELDS)
    if (!Object.hasOwn(descriptor, field)) problems.push(`missing ${field}`);
  for (const key of Object.keys(descriptor))
    if (!PROVIDER_DESCRIPTOR_FIELDS.includes(key)) problems.push(`unknown field ${key}`);
  if (!PROVIDER_ID_PATTERN.test(String(descriptor.id ?? "")))
    problems.push("id must match ^[a-z0-9][a-z0-9-]*$");
  if (expectedId !== null && descriptor.id !== expectedId)
    problems.push(`id ${String(descriptor.id)} does not match filename id ${expectedId}`);
  for (const field of ["endpoint", "defaultModel"])
    if (typeof descriptor[field] !== "string" || descriptor[field].length < 1)
      problems.push(`${field} must be a non-empty string`);
  if (typeof descriptor.apiKeyEnv !== "string" || !ENV_NAME_PATTERN.test(descriptor.apiKeyEnv))
    problems.push("apiKeyEnv must be an environment variable name");
  for (const field of ["buildRequest", "parseResponse", "classifyError"])
    if (typeof descriptor[field] !== "function") problems.push(`${field} must be a function`);
  return problems;
}

function resolveDescriptor(module, expectedId) {
  const descriptor = module?.default ?? module?.descriptor;
  const problems = validateProviderDescriptor(descriptor, { expectedId });
  if (problems.length > 0)
    throw new TypeError(`invalid provider descriptor ${expectedId}: ${problems.join("; ")}`);
  return Object.freeze({ ...descriptor });
}

async function discoverProviderDescriptors({ providersDir, importModule }) {
  const entries = await readdir(providersDir, { withFileTypes: true });
  const discovered = [];
  const invalid = [];
  for (const entry of entries.toSorted((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    if (!entry.isFile()) continue;
    const id = providerIdFromFilename(entry.name);
    if (id === null) continue;
    try {
      const module = await importModule(pathToFileURL(join(providersDir, entry.name)).href);
      discovered.push({ id, descriptor: resolveDescriptor(module, id), file: entry.name });
    } catch (error) {
      // A malformed descriptor is quarantined, never fatal: one bad file must
      // not defeat unknown-id fail-open or the other providers' resolution.
      invalid.push({ id, file: entry.name, error: error?.message ?? String(error) });
    }
  }
  return { discovered, invalid };
}

function requestedProviderId(env) {
  const configured = env?.[PROVIDER_SELECTION_ENV];
  if (configured === undefined || configured === null) return DEFAULT_PROVIDER_ID;
  const trimmed = String(configured).trim();
  return trimmed.length === 0 ? DEFAULT_PROVIDER_ID : trimmed;
}

export async function createProviderRegistry({
  providersDir = PROVIDERS_DIR,
  env = process.env,
  importModule = (url) => import(url),
} = {}) {
  const { discovered, invalid } = await discoverProviderDescriptors({ providersDir, importModule });
  const byId = new Map(discovered.map((entry) => [entry.id, entry.descriptor]));
  const requestedId = requestedProviderId(env);
  const selected = byId.get(requestedId) ?? null;
  return Object.freeze({
    requestedId,
    unresolved: selected === null,
    list: () => [...byId.values()],
    ids: () => [...byId.keys()],
    resolve: (id) => byId.get(id) ?? null,
    invalid: () => invalid.map((entry) => Object.freeze({ ...entry })),
    select: () =>
      selected === null
        ? Object.freeze({
            id: requestedId,
            descriptor: null,
            unresolved: true,
            reason: "unknown-provider",
          })
        : Object.freeze({ id: requestedId, descriptor: selected, unresolved: false, reason: null }),
  });
}

// The default registry reads this directory at import time (naming-based
// discovery, no hard-coded switch). With no descriptors shipped yet the
// requested default stays unresolved; T008 adds providers/openrouter.mjs.
export const defaultProviderRegistry = await createProviderRegistry();

export default { createProviderRegistry, defaultProviderRegistry };
