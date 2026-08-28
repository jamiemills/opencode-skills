"use strict";

import { digest } from "../schema-runtime/index.mjs";
import { RolloutError, cloneData, deepFreeze, isPlainObject } from "./internal.mjs";

export const VERSION_REGISTRY_FORMAT = "csm-config-version-registry/1";
export const VERSION_STATES = Object.freeze(["registered", "active", "superseded", "fenced"]);

export class VersionRegistryError extends RolloutError {}

function publicRecord(record) {
  return deepFreeze(cloneData(record));
}

export function createConfigVersionRegistry(options = {}) {
  if (options !== null && !isPlainObject(options))
    throw new VersionRegistryError("invalid-options", "registry options must be a plain object");
  const now = options.now ?? (() => new Date().toISOString());

  const versions = new Map();
  const order = [];
  const byDigest = new Map();
  let activeVersionId = null;
  let sequence = 0;

  function requireRecord(versionId) {
    const record = versions.get(versionId);
    if (!record)
      throw new VersionRegistryError(
        "unknown-version",
        `unknown config version '${String(versionId)}'`,
      );
    return record;
  }

  function register(config, meta = {}) {
    if (!isPlainObject(config))
      throw new VersionRegistryError("invalid-config", "registered config must be a plain object");
    if (meta !== null && !isPlainObject(meta))
      throw new VersionRegistryError("invalid-meta", "registration meta must be a plain object");
    const configDigest = digest(config);
    const existing = byDigest.get(configDigest);
    if (existing) return publicRecord(existing);
    sequence += 1;
    const digestHex = configDigest.slice("sha256:".length);
    const versionId = `cfg-v${sequence}-${digestHex.slice(0, 8)}`;
    const record = {
      versionId,
      seq: sequence,
      state: "registered",
      configDigest,
      config: deepFreeze(cloneData(config)),
      meta: deepFreeze(cloneData(meta ?? {})),
      registeredAt: now(),
      activations: [],
      supersededAt: null,
      fencedAt: null,
      fenceReason: null,
      fencedWhileActive: false,
      knownGood: false,
      knownGoodAt: null,
      knownGoodEvidence: null,
    };
    versions.set(versionId, record);
    order.push(versionId);
    byDigest.set(configDigest, record);
    return publicRecord(record);
  }

  function activate(versionId) {
    if (typeof versionId !== "string")
      throw new VersionRegistryError(
        "unknown-version",
        `unknown config version '${String(versionId)}'`,
      );
    const record = requireRecord(versionId);
    if (record.state === "fenced")
      throw new VersionRegistryError(
        "version-fenced",
        `config version '${versionId}' is fenced and can never be re-activated`,
      );
    if (record.versionId === activeVersionId)
      return { activated: record.versionId, previousActiveVersionId: null, changed: false };
    const previousActiveVersionId = activeVersionId;
    if (previousActiveVersionId !== null) {
      const previous = versions.get(previousActiveVersionId);
      previous.state = "superseded";
      previous.supersededAt = now();
    }
    record.state = "active";
    record.activations.push({ at: now(), previousActiveVersionId });
    activeVersionId = record.versionId;
    return { activated: record.versionId, previousActiveVersionId, changed: true };
  }

  function fence(versionId, reason) {
    if (typeof versionId !== "string")
      throw new VersionRegistryError(
        "unknown-version",
        `unknown config version '${String(versionId)}'`,
      );
    if (typeof reason !== "string" || reason.length === 0)
      throw new VersionRegistryError("invalid-reason", "fence reason must be a non-empty string");
    const record = requireRecord(versionId);
    if (record.state === "fenced") return publicRecord(record);
    const wasActive = record.versionId === activeVersionId;
    record.state = "fenced";
    record.fencedAt = now();
    record.fenceReason = reason;
    record.fencedWhileActive = wasActive;
    if (wasActive) activeVersionId = null;
    return publicRecord(record);
  }

  function markKnownGood(versionId, evidence = {}) {
    if (typeof versionId !== "string")
      throw new VersionRegistryError(
        "unknown-version",
        `unknown config version '${String(versionId)}'`,
      );
    if (evidence !== null && !isPlainObject(evidence))
      throw new VersionRegistryError(
        "invalid-evidence",
        "known-good evidence must be a plain object",
      );
    const record = requireRecord(versionId);
    if (record.state === "fenced")
      throw new VersionRegistryError(
        "version-fenced",
        `config version '${versionId}' is fenced and can never be marked known-good`,
      );
    record.knownGood = true;
    record.knownGoodAt = now();
    record.knownGoodEvidence = deepFreeze(cloneData(evidence ?? {}));
    return publicRecord(record);
  }

  function get(versionId) {
    if (typeof versionId !== "string")
      throw new VersionRegistryError(
        "unknown-version",
        `unknown config version '${String(versionId)}'`,
      );
    return publicRecord(requireRecord(versionId));
  }

  function getActiveVersionId() {
    return activeVersionId;
  }

  function getActive() {
    return activeVersionId === null ? null : publicRecord(versions.get(activeVersionId));
  }

  function getLastKnownGood(preferences = {}) {
    if (preferences !== null && !isPlainObject(preferences))
      throw new VersionRegistryError(
        "invalid-options",
        "getLastKnownGood options must be a plain object",
      );
    const excluding = preferences.excluding ?? null;
    for (let index = order.length - 1; index >= 0; index -= 1) {
      const record = versions.get(order[index]);
      if (!record.knownGood) continue;
      if (record.state === "fenced") continue;
      if (excluding !== null && record.versionId === excluding) continue;
      return publicRecord(record);
    }
    return null;
  }

  function list() {
    return order.map((versionId) => publicRecord(versions.get(versionId)));
  }

  function historySize() {
    return order.length;
  }

  function authorizeDispatch(versionId) {
    if (typeof versionId !== "string" || !versions.has(versionId))
      return { allowed: false, reason: "unknown-version", versionId: versionId ?? null };
    const record = versions.get(versionId);
    if (record.state === "fenced") return { allowed: false, reason: "version-fenced", versionId };
    if (record.versionId !== activeVersionId)
      return { allowed: false, reason: "not-active", versionId };
    return { allowed: true, reason: "active-version", versionId };
  }

  function assertDispatchable(versionId) {
    const decision = authorizeDispatch(versionId);
    if (!decision.allowed)
      throw new VersionRegistryError(
        decision.reason,
        `dispatch refused for config version '${String(versionId)}': ${decision.reason}`,
      );
    return decision;
  }

  return Object.freeze({
    register,
    activate,
    fence,
    markKnownGood,
    get,
    getActiveVersionId,
    getActive,
    getLastKnownGood,
    list,
    historySize,
    authorizeDispatch,
    assertDispatchable,
  });
}
