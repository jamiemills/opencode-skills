"use strict";

import { atomicWrite, readDurableJson } from "../../../../lib/durable-json/index.mjs";
import { hash as stableHash } from "../ledger/index.mjs";

const hash = (value) => stableHash(value);

function number(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new TypeError(`${name} must be finite`);
  return value;
}

function identity(candidate) {
  if (!candidate || typeof candidate.id !== "string" || !candidate.id)
    throw new TypeError("candidate id is required");
  return candidate.contentHash ?? candidate.patchHash ?? hash(candidate.id);
}

function normalize(candidate) {
  identity(candidate);
  const metrics = Object.fromEntries(
    Object.entries(candidate.metrics ?? {}).map(([key, value]) => [
      key,
      number(value, `metric ${key}`),
    ]),
  );
  if (!candidate.hardGatesPassed) return { ...candidate, metrics, hardGatesPassed: false };
  return {
    ...candidate,
    metrics,
    hardGatesPassed: true,
    behaviorCategory: candidate.behaviorCategory ?? "uncategorized",
    island: candidate.island ?? "default",
    contentHash: identity(candidate),
  };
}

function directionValue(value, direction) {
  return direction === "maximize" ? value : -value;
}
function dominates(left, right, objectives) {
  let strictlyBetter = false;
  for (const objective of objectives) {
    const a = directionValue(left.metrics[objective.name], objective.direction);
    const b = directionValue(right.metrics[objective.name], objective.direction);
    if (a < b) return false;
    if (a > b) strictlyBetter = true;
  }
  return strictlyBetter;
}

function deterministicOrder(left, right, objectives) {
  for (const objective of objectives) {
    const a = directionValue(left.metrics[objective.name], objective.direction);
    const b = directionValue(right.metrics[objective.name], objective.direction);
    if (a !== b) return b - a;
  }
  return `${left.behaviorCategory}:${left.island}:${left.id}:${identity(left)}`.localeCompare(
    `${right.behaviorCategory}:${right.island}:${right.id}:${identity(right)}`,
  );
}

function paretoFront(candidates, objectives) {
  return candidates.filter(
    (candidate, index) =>
      !candidates.some(
        (other, otherIndex) => otherIndex !== index && dominates(other, candidate, objectives),
      ),
  );
}

function retain(candidates, options = {}) {
  const limit = options.maxArchive ?? 100;
  if (!Number.isInteger(limit) || limit < 1)
    throw new RangeError("maxArchive must be a positive integer");
  const objectives = options.objectives ?? [
    { name: options.metric?.name ?? "score", direction: options.metric?.direction ?? "maximize" },
  ];
  const valid = candidates.map(normalize).filter((candidate) => candidate.hardGatesPassed);
  const unique = [...new Map(valid.map((candidate) => [identity(candidate), candidate])).values()];
  const ordered = unique.toSorted((a, b) => deterministicOrder(a, b, objectives));
  const front = paretoFront(unique, objectives).toSorted((a, b) =>
    deterministicOrder(a, b, objectives),
  );
  const chosen = [];
  for (const category of [
    ...new Set(ordered.map((candidate) => candidate.behaviorCategory)),
  ].toSorted()) {
    const candidate = ordered.find((item) => item.behaviorCategory === category);
    if (candidate) chosen.push(candidate);
  }
  for (const candidate of front)
    if (!chosen.some((item) => identity(item) === identity(candidate))) chosen.push(candidate);
  return chosen.slice(0, limit);
}

class PopulationArchive {
  constructor(options = {}) {
    this.options = { ...options };
    this.path = options.path;
    this.provenance = structuredClone(options.provenance ?? {});
    this.lineageRecords = [];
    this.records = [];
    this.recompute(options.lineage ?? []);
  }
  recompute(lineageInput = []) {
    this.lineageRecords = lineageInput.map((candidate) => structuredClone(candidate));
    this.records = retain(lineageInput, this.options);
    return this.snapshot();
  }
  add(candidate) {
    return this.recompute([...this.records, candidate]);
  }
  snapshot() {
    return this.records.map((candidate) => structuredClone(candidate));
  }
  async save(path = this.path) {
    if (!path) throw new TypeError("archive path is required");
    const records = this.snapshot();
    const lineageRecords = lineage(this.lineageRecords.length ? this.lineageRecords : records);
    const provenance = structuredClone(this.provenance);
    const archive = {
      format: "csm-autoresearch-archive/1",
      records,
      lineage: lineageRecords,
      provenance,
      contentHash: hash(records),
      lineageHash: hash(lineageRecords),
      provenanceHash: hash(provenance),
    };
    await atomicWrite(path, `${JSON.stringify(archive, null, 2)}\n`, { mode: 0o600 });
    this.path = path;
    return this.snapshot();
  }
  static async load(path, options = {}) {
    const value = await readDurableJson(path);
    if (
      value?.format !== "csm-autoresearch-archive/1" ||
      !Array.isArray(value.records) ||
      !Array.isArray(value.lineage) ||
      !value.provenance ||
      typeof value.contentHash !== "string" ||
      typeof value.lineageHash !== "string" ||
      typeof value.provenanceHash !== "string"
    )
      throw new Error("invalid population archive");
    if (
      value.contentHash !== hash(value.records) ||
      value.lineageHash !== hash(value.lineage) ||
      value.provenanceHash !== hash(value.provenance)
    )
      throw new Error("population archive integrity failure");
    const archive = new PopulationArchive({
      ...options,
      path,
      provenance: value.provenance,
      lineage: value.records,
    });
    archive.lineageRecords = value.lineage;
    return archive;
  }
  select(seed = 0) {
    if (!this.records.length) return null;
    const index = Math.abs(Number(seed) || 0) % this.records.length;
    return structuredClone(this.records[index]);
  }
}

function lineage(records = []) {
  const result = new Map();
  for (const record of records) {
    const candidate = normalize(record);
    result.set(candidate.id, {
      id: candidate.id,
      parentId: candidate.parentId ?? null,
      contentHash: identity(candidate),
      decision: candidate.decision ?? "archive",
    });
  }
  return [...result.values()].toSorted((a, b) => a.id.localeCompare(b.id));
}

function isStagnant(history = [], threshold = 1, options = {}) {
  if (!Number.isInteger(threshold) || threshold < 1)
    throw new RangeError("stagnation threshold must be positive");
  const objective = options.objective ?? { name: "score", direction: "maximize" };
  let stagnant = 0;
  let best;
  for (const trial of history) {
    if (trial?.hardGatesPassed === false || !trial?.metrics) {
      stagnant++;
      continue;
    }
    const value = directionValue(
      number(trial.metrics[objective.name], objective.name),
      objective.direction,
    );
    if (best === undefined || value > best) {
      best = value;
      stagnant = 0;
    } else stagnant++;
  }
  return { stagnantTrials: stagnant, activated: stagnant >= threshold };
}

function migrate(archive, islands = [], options = {}) {
  const interval = options.interval ?? 1;
  if (!Number.isInteger(interval) || interval < 1)
    throw new RangeError("migration interval must be positive");
  if (!Number.isInteger(options.round ?? 0) || (options.round ?? 0) % interval)
    return islands.map((island) => ({ ...island, candidates: [...(island.candidates ?? [])] }));
  const source =
    archive instanceof PopulationArchive ? archive.snapshot() : retain(archive, options);
  return islands.map((island, index) => {
    const migrant = source[index % Math.max(source.length, 1)];
    return {
      ...island,
      candidates: migrant
        ? [...(island.candidates ?? []).filter((item) => item.id !== migrant.id), migrant]
        : [...(island.candidates ?? [])],
    };
  });
}

function protectedPathRefusal(candidate, protectedPaths = []) {
  const changed = candidate.changedPaths ?? candidate.paths ?? [];
  const forbidden = changed.filter((path) =>
    protectedPaths.some(
      (protectedPath) => path === protectedPath || path.startsWith(`${protectedPath}/`),
    ),
  );
  if (forbidden.length)
    throw new Error(`protected paths cannot be promoted: ${forbidden.join(", ")}`);
}

async function promote({ candidate, approval, protectedPaths = [], read, apply, validate } = {}) {
  const selected = normalize(candidate);
  if (!selected.hardGatesPassed) throw new Error("candidate failed hard gates");
  if (approval?.approved !== true || approval.candidateId !== selected.id)
    throw new Error("human approval is required for promotion");
  protectedPathRefusal(selected, protectedPaths);
  if (typeof apply !== "function" || typeof read !== "function")
    throw new TypeError("read and apply are required");
  const before = await read();
  const beforeHash = stableHash(before);
  if (candidate.expectedBeforeHash && candidate.expectedBeforeHash !== beforeHash)
    throw new Error("current state before promotion does not match");
  const promotion = {
    candidateId: selected.id,
    contentHash: identity(selected),
    previous: structuredClone(before),
    beforeHash,
    promotionId: hash({ id: selected.id, contentHash: identity(selected), beforeHash }),
  };
  try {
    await apply(selected);
    if (typeof validate === "function" && !(await validate(selected)))
      throw new Error("final validation failed");
    const after = await read();
    const afterHash = stableHash(after);
    if (candidate.expectedAfterHash && candidate.expectedAfterHash !== afterHash)
      throw new Error("current state after promotion does not match");
    return { decision: "promote", ...promotion, afterHash };
  } catch (error) {
    await apply(before);
    throw error;
  }
}

async function rollback({ promotion, candidate, identity: expectedIdentity, restore, read } = {}) {
  if (!promotion || typeof restore !== "function")
    throw new TypeError("promotion and restore are required");
  const actual = identity(
    candidate ?? { id: promotion.candidateId, contentHash: promotion.contentHash },
  );
  if (
    actual !== promotion.contentHash ||
    (expectedIdentity && expectedIdentity !== promotion.contentHash)
  )
    throw new Error("rollback identity mismatch");
  if (typeof read === "function" && stableHash(await read()) !== promotion.afterHash)
    throw new Error("current state is not the promoted state");
  await restore(structuredClone(promotion.previous), {
    type: "population-state",
    expectedHash: promotion.beforeHash,
  });
  if (typeof read === "function" && stableHash(await read()) !== promotion.beforeHash)
    throw new Error("restore did not recover the previous state");
  return {
    decision: "rollback",
    candidateId: promotion.candidateId,
    contentHash: promotion.contentHash,
    promotionId: promotion.promotionId,
  };
}

export {
  PopulationArchive,
  dominates,
  isStagnant,
  lineage,
  migrate,
  paretoFront,
  promote,
  protectedPathRefusal,
  retain,
  rollback,
};
