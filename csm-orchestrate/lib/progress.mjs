"use strict";

import { digest } from "../../lib/schema-runtime/index.mjs";

const STATES = new Set(["pending", "active", "verified", "failed", "blocked", "incomplete"]);
const RUN_ID = /^run-[a-z0-9][a-z0-9-]{1,127}$/;
const ITEM_ID = /^item-[a-z0-9][a-z0-9-]{1,127}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const ITEM_FIELDS = new Set([
  "itemId",
  "phaseId",
  "nodeId",
  "graphRevision",
  "skill",
  "weight",
  "state",
  "verifiedFraction",
  "attempt",
  "childRunId",
  "evidenceRefs",
  "receiptId",
  "blocker",
]);
const DOCUMENT_FIELDS = new Set([
  "schema",
  "progressId",
  "runId",
  "graphRevision",
  "revision",
  "items",
  "aggregate",
  "updatedAt",
]);
const AGGREGATE_FIELDS = new Set([
  "plannedProgress",
  "observedWork",
  "outcome",
  "counts",
  "eventsObserved",
]);
const COUNT_FIELDS = new Set(STATES);

const slug = (value) =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function assertItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item))
    throw new TypeError("progress item is required");
  if (Object.keys(item).some((field) => !ITEM_FIELDS.has(field)))
    throw new TypeError("unknown progress item field");
  if (Object.keys(item).length !== ITEM_FIELDS.size)
    throw new TypeError("progress item has missing fields");
  if (!ITEM_ID.test(item.itemId)) throw new TypeError("invalid progress itemId");
  if (!/^phase-[a-z0-9][a-z0-9-]{1,127}$/.test(item.phaseId))
    throw new TypeError("invalid progress phaseId");
  if (typeof item.nodeId !== "string" || item.nodeId.length === 0)
    throw new TypeError("invalid progress nodeId");
  if (!/^csm-[a-z0-9][a-z0-9-]{1,63}$/.test(item.skill))
    throw new TypeError("invalid progress skill");
  if (!Number.isInteger(item.graphRevision) || item.graphRevision < 1)
    throw new TypeError("item graphRevision must be positive");
  if (item.childRunId !== null && !RUN_ID.test(item.childRunId))
    throw new TypeError("invalid progress childRunId");
  if (!STATES.has(item.state)) throw new TypeError("invalid progress state");
  if (!Number.isFinite(item.weight) || item.weight <= 0)
    throw new TypeError("progress weight must be positive");
  if (!Number.isInteger(item.attempt) || item.attempt < 1)
    throw new TypeError("progress attempt must be positive");
  if (
    !Number.isFinite(item.verifiedFraction) ||
    item.verifiedFraction < 0 ||
    item.verifiedFraction > 1
  )
    throw new TypeError("verifiedFraction must be between zero and one");
  if (
    !Array.isArray(item.evidenceRefs) ||
    item.evidenceRefs.some((ref) => typeof ref !== "string" || !ref.length)
  )
    throw new TypeError("progress evidenceRefs must be an array of strings");
  if (item.receiptId !== null && !/^receipt-[a-z0-9][a-z0-9-]{1,127}$/.test(item.receiptId))
    throw new TypeError("invalid progress receiptId");
  if (
    item.blocker !== null &&
    (!item.blocker ||
      typeof item.blocker !== "object" ||
      !/^[A-Z][A-Z0-9_]{1,63}$/.test(item.blocker.code) ||
      Object.keys(item.blocker).some((field) => !["code", "message"].includes(field)) ||
      Object.keys(item.blocker).length !== 2 ||
      typeof item.blocker.message !== "string" ||
      item.blocker.message.length === 0 ||
      item.blocker.message.length > 500)
  )
    throw new TypeError("invalid progress blocker");
}

function assertTimestamp(value) {
  if (!TIMESTAMP.test(value) || !Number.isFinite(Date.parse(value)))
    throw new TypeError("updatedAt must be a valid timestamp");
}

function assertAggregate(aggregate) {
  if (!aggregate || typeof aggregate !== "object" || Array.isArray(aggregate))
    throw new TypeError("progress aggregate is required");
  if (Object.keys(aggregate).some((field) => !AGGREGATE_FIELDS.has(field)))
    throw new TypeError("unknown progress aggregate field");
  if (Object.keys(aggregate).length !== AGGREGATE_FIELDS.size)
    throw new TypeError("progress aggregate has missing fields");
  if (!Number.isInteger(aggregate.observedWork) || aggregate.observedWork < 0)
    throw new TypeError("invalid progress observedWork");
  if (!Number.isInteger(aggregate.eventsObserved) || aggregate.eventsObserved < 0)
    throw new TypeError("invalid progress eventsObserved");
  if (!STATES.has(aggregate.outcome) && aggregate.outcome !== "indeterminate")
    throw new TypeError("invalid progress outcome");
  if (!aggregate.counts || typeof aggregate.counts !== "object" || Array.isArray(aggregate.counts))
    throw new TypeError("progress counts are required");
  if (Object.keys(aggregate.counts).some((field) => !COUNT_FIELDS.has(field)))
    throw new TypeError("unknown progress count field");
  if (
    Object.keys(aggregate.counts).length !== COUNT_FIELDS.size ||
    [...COUNT_FIELDS].some(
      (field) => !Number.isInteger(aggregate.counts[field]) || aggregate.counts[field] < 0,
    )
  )
    throw new TypeError("invalid progress counts");
  if (
    aggregate.plannedProgress !== null &&
    (!Number.isFinite(aggregate.plannedProgress) ||
      aggregate.plannedProgress < 0 ||
      aggregate.plannedProgress > 1)
  )
    throw new TypeError("invalid progress plannedProgress");
}

const TERMINAL_STATES = new Set(["verified", "failed", "blocked", "incomplete"]);
const STATE_ORDER = new Map([
  ["pending", 0],
  ["active", 1],
  ["verified", 2],
  ["failed", 2],
  ["blocked", 2],
  ["incomplete", 2],
]);

function assertTransition(previous, next) {
  if (TERMINAL_STATES.has(previous.state) && next.state !== previous.state)
    throw new TypeError("terminal progress state cannot regress or change");
  if (STATE_ORDER.get(next.state) < STATE_ORDER.get(previous.state))
    throw new TypeError("progress state cannot regress");
  if (next.attempt < previous.attempt) throw new TypeError("progress attempt cannot decrease");
  if (
    previous.childRunId !== null &&
    next.childRunId !== previous.childRunId &&
    next.attempt <= previous.attempt
  )
    throw new TypeError("child run changes require attempt progression");
}

export function aggregateProgress(items = [], eventsObserved = 0) {
  if (!Array.isArray(items)) throw new TypeError("progress items must be an array");
  const counts = Object.fromEntries([...STATES].map((state) => [state, 0]));
  let denominator = 0;
  let completed = 0;
  for (const item of items) {
    assertItem(item);
    counts[item.state] += 1;
    denominator += item.weight;
    completed += item.weight * item.verifiedFraction;
  }
  const terminal =
    items.length > 0 &&
    items.every((item) => ["verified", "failed", "blocked", "incomplete"].includes(item.state));
  const outcome = !items.length
    ? "indeterminate"
    : counts.blocked > 0
      ? "blocked"
      : counts.failed > 0
        ? "failed"
        : counts.incomplete > 0
          ? "incomplete"
          : terminal && counts.verified === items.length
            ? "verified"
            : "active";
  return {
    plannedProgress: denominator ? completed / denominator : null,
    observedWork: items.filter((item) => item.state !== "pending").length,
    outcome,
    counts,
    eventsObserved: Number.isInteger(eventsObserved) && eventsObserved >= 0 ? eventsObserved : 0,
  };
}

export function createProgressDocument({
  runId,
  graphRevision = 1,
  progressId = `progress-${slug(runId)}`,
  items = [],
  revision = 0,
  eventsObserved = 0,
  now = new Date().toISOString(),
} = {}) {
  if (!RUN_ID.test(runId ?? "")) throw new TypeError("canonical progress runId is required");
  if (!/^progress-[a-z0-9][a-z0-9-]{1,127}$/.test(progressId))
    throw new TypeError("canonical progress progressId is required");
  if (!Number.isInteger(graphRevision) || graphRevision < 1)
    throw new TypeError("graphRevision must be positive");
  if (!Number.isInteger(revision) || revision < 0)
    throw new TypeError("revision must be a non-negative integer");
  assertTimestamp(now);
  const unique = new Set();
  const normalized = items.map((item) => {
    assertItem(item);
    if (unique.has(item.itemId)) throw new TypeError(`duplicate progress item ${item.itemId}`);
    unique.add(item.itemId);
    return {
      ...item,
      graphRevision: item.graphRevision,
      evidenceRefs: [...new Set(item.evidenceRefs ?? [])],
    };
  });
  return {
    schema: "csm-progress/1",
    progressId,
    runId,
    graphRevision,
    revision,
    items: normalized,
    aggregate: aggregateProgress(normalized, eventsObserved),
    updatedAt: new Date(now).toISOString(),
  };
}

export function validateProgressDocument(document) {
  if (
    !document ||
    typeof document !== "object" ||
    Array.isArray(document) ||
    document.schema !== "csm-progress/1"
  )
    throw new TypeError("invalid progress document schema");
  if (
    Object.keys(document).some((field) => !DOCUMENT_FIELDS.has(field)) ||
    Object.keys(document).length !== DOCUMENT_FIELDS.size
  )
    throw new TypeError("invalid progress document fields");
  assertTimestamp(document.updatedAt);
  assertAggregate(document.aggregate);
  const rebuilt = createProgressDocument({
    ...document,
    eventsObserved: document.aggregate?.eventsObserved,
    now: document.updatedAt,
  });
  if (
    rebuilt.progressId !== document.progressId ||
    rebuilt.runId !== document.runId ||
    rebuilt.graphRevision !== document.graphRevision ||
    rebuilt.revision !== document.revision
  )
    throw new TypeError("invalid progress document identity");
  if (JSON.stringify(rebuilt.aggregate) !== JSON.stringify(document.aggregate))
    throw new TypeError("progress aggregate does not match items");
  return document;
}

export function itemForNode({ runId, graphRevision, phase, node, weight = 1 } = {}) {
  return {
    itemId: `item-${slug(runId)}-${slug(phase.phaseId)}-${slug(node.nodeId)}`,
    phaseId: phase.phaseId,
    nodeId: node.nodeId,
    graphRevision,
    skill: node.skill,
    weight,
    state: "pending",
    verifiedFraction: 0,
    attempt: 1,
    childRunId: null,
    evidenceRefs: [],
    receiptId: null,
    blocker: null,
  };
}

export function updateProgress(
  document,
  itemId,
  patch,
  { eventsObserved = document.aggregate.eventsObserved, now = new Date().toISOString() } = {},
) {
  const index = document.items.findIndex((item) => item.itemId === itemId);
  if (index < 0) throw new TypeError(`unknown progress item ${itemId}`);
  const next = { ...document.items[index], ...patch };
  assertItem(next);
  assertTransition(document.items[index], next);
  if (next.state === "verified" && next.verifiedFraction !== 1) next.verifiedFraction = 1;
  if (next.state !== "verified" && next.verifiedFraction === 1) next.verifiedFraction = 0;
  const items = document.items.slice();
  items[index] = next;
  return createProgressDocument({
    ...document,
    items,
    revision: document.revision + 1,
    eventsObserved,
    now,
  });
}

export function appendProgressItems(
  document,
  items,
  { graphRevision = document.graphRevision, now = new Date().toISOString() } = {},
) {
  return createProgressDocument({
    ...document,
    graphRevision,
    items: [...document.items, ...items],
    revision: document.revision + 1,
    now,
  });
}

export function createProgressTracker({
  runId,
  graphRevision = 1,
  store = null,
  now = () => new Date().toISOString(),
} = {}) {
  let document = createProgressDocument({ runId, graphRevision, now: now() });
  let writes = Promise.resolve();
  let fencingToken = null;
  const persist = () => {
    if (!store?.saveProgress) return Promise.resolve(document);
    const snapshot = structuredClone(document);
    validateProgressDocument(snapshot);
    const expectedRevision = snapshot.revision - 1;
    const write = writes.then(() =>
      store.saveProgress(snapshot, {
        expectedRevision,
        ...(fencingToken === null ? {} : { fencingToken }),
      }),
    );
    writes = write.catch(() => undefined);
    return write.then(() => snapshot);
  };
  const change = (fn) => {
    document = fn(document);
    return persist();
  };
  return {
    get snapshot() {
      return structuredClone(document);
    },
    materialize(phases) {
      const planned = phases.flatMap((phase) =>
        phase.routeNodes.map((node) =>
          itemForNode({ runId, graphRevision: phase.graphRevision, phase, node }),
        ),
      );
      return change((current) => {
        const existing = new Map(current.items.map((item) => [item.itemId, item]));
        return createProgressDocument({
          ...current,
          items: planned.map((item) => existing.get(item.itemId) ?? item),
          revision: current.revision + 1,
          now: now(),
        });
      });
    },
    addPhase(phase) {
      return change((current) =>
        appendProgressItems(
          current,
          phase.routeNodes.map((node) =>
            itemForNode({ runId, graphRevision: phase.graphRevision, phase, node }),
          ),
          { graphRevision: Math.max(current.graphRevision, phase.graphRevision), now: now() },
        ),
      );
    },
    update(itemId, patch) {
      return change((current) =>
        updateProgress(current, itemId, patch, {
          eventsObserved: current.aggregate.eventsObserved,
          now: now(),
        }),
      );
    },
    itemId(phaseId, nodeId) {
      return document.items.find((item) => item.phaseId === phaseId && item.nodeId === nodeId)
        ?.itemId;
    },
    setFencingToken(token) {
      if (!Number.isInteger(token) || token < 1)
        throw new TypeError("fencing token must be positive");
      fencingToken = Math.max(fencingToken ?? 0, token);
    },
    observeTelemetry() {
      document = createProgressDocument({
        ...document,
        revision: document.revision + 1,
        eventsObserved: document.aggregate.eventsObserved + 1,
        now: now(),
      });
      return persist();
    },
    flush() {
      return writes;
    },
    async reload() {
      await writes;
      if (store?.loadProgress) {
        const loadOptions = fencingToken === null ? {} : { fencingToken };
        const loaded = await store.loadProgress(`progress-${slug(runId)}`, loadOptions);
        if (loaded) {
          validateProgressDocument(loaded);
          document = structuredClone(loaded);
        }
      }
      return this.snapshot;
    },
    persist() {
      if (document.revision === 0)
        document = createProgressDocument({ ...document, revision: 1, now: now() });
      return persist();
    },
    associateReceipt(receiptId, phaseId) {
      return Promise.all(
        document.items
          .filter((item) => item.phaseId === phaseId && item.state !== "pending")
          .map((item) => this.update(item.itemId, { receiptId })),
      );
    },
  };
}

export const progressDigest = (document) => digest(document);
