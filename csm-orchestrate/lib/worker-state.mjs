"use strict";

import { createHash } from "node:crypto";
import { IDEMPOTENT_WORKER_EVENT_TYPES, TELEMETRY_EVENT_SCHEMA_ID_V2 } from "./telemetry.mjs";

const WORKER_STATES = new Set([
  "queued",
  "running",
  "retrying",
  "replayed",
  "completed",
  "failed",
  "cancelled",
  "blocked",
  "unknown",
]);

const syntheticWorkerId = (key) =>
  `worker-${createHash("sha256").update(String(key)).digest("hex").slice(0, 16)}`;

function newRow(key) {
  return {
    workerId: syntheticWorkerId(key),
    taskId: null,
    skill: null,
    state: "queued",
    activity: null,
    attempt: 0,
    heartbeatAt: null,
    evidenceRefs: [],
    gateStatus: null,
  };
}

function advance(row, event) {
  const type = event.eventType;
  if (type === "worker.heartbeat" || type === "worker.progress") {
    row.heartbeatAt = event.timestamp ?? row.heartbeatAt;
    const activity = event.payload?.activity;
    if (typeof activity === "string") row.activity = activity;
    return;
  }
  switch (type) {
    case "worker.retrying":
      row.state = "retrying";
      break;
    case "worker.replayed":
      row.state = "replayed";
      break;
    case "worker.cancelled":
      row.state = "cancelled";
      break;
    case "worker.failed":
    case "invocation.failed":
    case "tool.failed":
      row.state = "failed";
      break;
    case "worker.completed":
    case "task.completed":
    case "invocation.completed":
    case "tool.completed":
      row.state = "completed";
      break;
    case "task.blocked":
      row.state = "blocked";
      break;
    case "checkpoint.saved":
      row.activity = "checkpoint";
      break;
    case "egress.decision":
      row.activity = `egress:${event.payload?.decision ?? "unknown"}`;
      break;
    default:
      if (row.state === "queued") row.state = "running";
      row.activity = type;
  }
}

// Bounded, re-entrant fold of the append-only telemetry stream into worker
// rows. Only v2 worker events are folded; idempotent lifecycle events dedupe
// on logicalKey so a resume cannot double-count a re-emitted row. The reducer
// tracks the last applied eventId and only folds the appended suffix when the
// prefix is unchanged; otherwise it re-folds from scratch (torn tail / rewrite
// tolerance). It never writes cursor, receipt, gate, or evidence state.
export function createWorkerStateReducer() {
  const workers = new Map();
  const appliedKeys = new Set();
  let appliedCount = 0;
  let lastEventId = null;
  let runId = null;

  function applyEvent(event) {
    const key =
      event.workerId ?? event.taskId ?? event.childRunId ?? event.logicalKey ?? event.eventId;
    let row = workers.get(key);
    if (!row) {
      row = newRow(key);
      workers.set(key, row);
    }
    if (typeof event.workerId === "string") row.workerId = event.workerId;
    if (typeof event.taskId === "string") row.taskId = event.taskId;
    if (typeof event.payload?.skill === "string") row.skill = event.payload.skill;
    if (Number.isInteger(event.attempt)) row.attempt = Math.max(row.attempt, event.attempt);
    advance(row, event);
  }

  function applyEvents(events, options = {}) {
    if (!Array.isArray(events)) throw new TypeError("events must be an array");
    let start = 0;
    if (lastEventId !== null) {
      const index = events.findIndex((event) => event?.eventId === lastEventId);
      if (index === appliedCount - 1) start = appliedCount;
      else {
        workers.clear();
        appliedKeys.clear();
        appliedCount = 0;
        lastEventId = null;
        start = 0;
      }
    }
    for (let i = start; i < events.length; i += 1) {
      const event = events[i];
      if (event && event.schema === TELEMETRY_EVENT_SCHEMA_ID_V2) {
        if (runId === null && typeof event.runId === "string") runId = event.runId;
        const idempotent =
          typeof event.logicalKey === "string" &&
          IDEMPOTENT_WORKER_EVENT_TYPES.includes(event.eventType);
        if (!idempotent || !appliedKeys.has(event.logicalKey)) {
          if (idempotent) appliedKeys.add(event.logicalKey);
          applyEvent(event);
        }
      }
      appliedCount = i + 1;
      if (event?.eventId) lastEventId = event.eventId;
    }
    return snapshot(options);
  }

  function snapshot({ now = new Date().toISOString() } = {}) {
    const nowMs = Date.parse(now);
    const rows = [...workers.values()].map((row) => ({
      workerId: row.workerId,
      taskId: row.taskId,
      skill: row.skill,
      state: WORKER_STATES.has(row.state) ? row.state : "unknown",
      activity: row.activity,
      attempt: row.attempt,
      heartbeatAgeMs:
        row.heartbeatAt && Number.isFinite(nowMs)
          ? Math.max(0, nowMs - Date.parse(row.heartbeatAt))
          : null,
      model: null,
      evidenceRefs: row.evidenceRefs.slice(),
      gateStatus: row.gateStatus,
    }));
    rows.sort((a, b) => (a.workerId < b.workerId ? -1 : a.workerId > b.workerId ? 1 : 0));
    return {
      schema: "csm-worker-projection/1",
      schemaRevision: 1,
      runId,
      generatedAt: now,
      workers: rows,
      aggregate: {
        workers: rows.length,
        running: rows.filter((row) => ["running", "retrying", "replayed"].includes(row.state))
          .length,
        completed: rows.filter((row) => row.state === "completed").length,
        failed: rows.filter((row) => ["failed", "blocked", "cancelled"].includes(row.state)).length,
      },
    };
  }

  return {
    applyEvents,
    snapshot,
    reset() {
      workers.clear();
      appliedKeys.clear();
      appliedCount = 0;
      lastEventId = null;
      runId = null;
    },
  };
}

export function foldWorkerState(events, options = {}) {
  const reducer = createWorkerStateReducer();
  reducer.applyEvents(events);
  return options.now ? reducer.snapshot(options) : reducer.snapshot();
}

export { syntheticWorkerId };
