import { readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { decideContinuation, evaluateReadiness, recordDigest } from "./csm-continue-core.mjs";

// T002: opencode plugin wrapper over the pure continuation core (T001). It
// subscribes to `session.idle`, locates the active build run's durable record in
// the working directory, computes readiness from that record (and, when
// available, its paired plan), and injects at most one bounded continuation
// prompt per idle. Every path is fail-closed and silent: an absent run, an
// unavailable client, or any thrown error leaves the host untouched. Import has
// no side effects, and the wrapper depends ONLY on its sibling core (plus node
// builtins) so the installer can drop both files into the opencode plugins
// directory with no repository present.
//
// Activation wiring (T015): an explicit `CSM_CONTINUE_RECORD` wins, then the
// conventional `.agents/csm-build-state/active.json`, then auto-discovery of the
// newest NON-TERMINAL `.agents/csm-build-state/*.json`. The matching plan is
// resolved from `record.planPath`, else paired by `runId` against
// `.agents/plans/*-csm.json`. This makes the supervisor work without a manual
// pointer while remaining inert when no live run exists.

export const DEFAULT_MAX_CONTINUES = 5;
// Auto-discovery only considers a build state whose record has been updated
// recently, so stale abandoned runs (in_progress records left in a repo) never
// cause spurious continuation prompts. An explicit `active.json` or
// `CSM_CONTINUE_RECORD` pointer bypasses this freshness gate.
export const DEFAULT_FRESH_MS = 6 * 60 * 60 * 1000;
export const ACTIVE_RECORD_SEGMENTS = Object.freeze([".agents", "csm-build-state", "active.json"]);
const BUILD_STATE_SCHEMAS = new Set(["csm-build-state/1", "csm-build-state/2"]);
const TERMINAL_BUILD_STATES = new Set(["COMPLETE", "BLOCKED", "SUPERSEDED"]);
const TERMINAL_STATUSES = new Set(["complete", "blocked", "superseded"]);

function maxContinuesFrom(env) {
  const parsed = Number.parseInt(env?.CSM_CONTINUE_MAX ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_CONTINUES;
}

const absolute = (directory, value) => (isAbsolute(value) ? value : join(directory, value));

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonTerminalBuildState(value) {
  if (!isRecord(value) || !BUILD_STATE_SCHEMAS.has(value.schema)) return false;
  if (TERMINAL_BUILD_STATES.has(value?.control?.currentState)) return false;
  if (TERMINAL_STATUSES.has(String(value?.status ?? "").toLowerCase())) return false;
  return true;
}

// Read an explicit `CSM_CONTINUE_RECORD` override, or the conventional
// `active.json`, when readable and non-terminal. Returns null otherwise.
async function readExplicitRecord(directory, env) {
  const override = typeof env?.CSM_CONTINUE_RECORD === "string" ? env.CSM_CONTINUE_RECORD : "";
  const path = override
    ? absolute(directory, override)
    : join(directory, ...ACTIVE_RECORD_SEGMENTS);
  const value = await readJson(path);
  if (!isRecord(value)) return null;
  return { record: value, path };
}

// Auto-discover the newest non-terminal build state under
// `.agents/csm-build-state/`. Records that are complete/blocked/superseded are
// ignored so the supervisor stays inert once a run has ended.
export async function discoverBuildState(directory, env = process.env) {
  const explicit = await readExplicitRecord(directory, env);
  if (explicit) return explicit;
  const dir = join(directory, ".agents", "csm-build-state");
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  const parsed = Number.parseInt(env?.CSM_CONTINUE_FRESH_MS ?? "", 10);
  const freshness = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FRESH_MS;
  const candidates = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name === "active.json") continue;
    const path = join(dir, name);
    const value = await readJson(path);
    if (!isNonTerminalBuildState(value)) continue;
    let mtime = 0;
    try {
      mtime = (await stat(path)).mtimeMs;
    } catch {
      mtime = 0;
    }
    if (mtime <= 0 || Date.now() - mtime > freshness) continue;
    candidates.push({ record: value, path, mtime });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtime - a.mtime);
  const best = candidates[0];
  return { record: best.record, path: best.path };
}

// Resolve the plan paired with a build state: an explicit `record.planPath`,
// else the `.agents/plans/*-csm.json` whose `runId` matches the record.
export async function resolvePlanPath(record, directory) {
  if (typeof record?.planPath === "string" && record.planPath !== "")
    return absolute(directory, record.planPath);
  if (typeof record?.runId !== "string" || record.runId === "") return null;
  const dir = join(directory, ".agents", "plans");
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.endsWith("-csm.json")) continue;
    const path = join(dir, name);
    const plan = await readJson(path);
    if (isRecord(plan) && plan.runId === record.runId) return path;
  }
  return null;
}

// Locate the active run's durable record and its optional plan. The returned
// record carries `recordPath`/`planPath` so the resume command is concrete.
export async function locateActiveRecord(directory, env = process.env) {
  const located = await discoverBuildState(directory, env);
  if (!located) return null;
  const planPath = await resolvePlanPath(located.record, directory);
  return {
    record: {
      ...located.record,
      recordPath: located.path,
      ...(planPath ? { planPath } : {}),
    },
    path: located.path,
    planPath: planPath ?? null,
  };
}

// A build-state record carries no tasks of its own; its `planPath` (when
// present and readable) supplies the source plan's tasks readiness needs.
export async function loadPlanTasks(record, directory) {
  if (typeof record?.planPath !== "string" || record.planPath === "") return [];
  try {
    const plan = JSON.parse(await readFile(absolute(directory, record.planPath), "utf8"));
    return Array.isArray(plan?.tasks) ? plan.tasks : [];
  } catch {
    return [];
  }
}

function continuationPrompt(decision) {
  return decision?.command
    ? `Continue the active build run: work remains. Resume with: ${decision.command}`
    : "Continue the active build run: work remains.";
}

async function injectContinuation(client, sessionID, prompt) {
  const promptFn = client?.session?.prompt;
  if (typeof sessionID !== "string" || sessionID === "" || typeof promptFn !== "function")
    return false;
  try {
    await promptFn.call(client.session, {
      path: { id: sessionID },
      body: { parts: [{ type: "text", text: prompt }] },
    });
    return true;
  } catch {
    return false;
  }
}

export async function CsmContinuePlugin({ client, directory } = {}) {
  const dir = typeof directory === "string" && directory !== "" ? directory : process.cwd();
  const budget = {
    continues: 0,
    maxContinues: maxContinuesFrom(process.env),
    lastDigest: undefined,
  };

  async function handleIdle(sessionID) {
    const located = await locateActiveRecord(dir);
    if (!located) return;
    const tasks = await loadPlanTasks(located.record, dir);
    const guard = evaluateReadiness({ record: located.record, tasks });
    const digest = recordDigest(located.record);
    const decision = decideContinuation({
      record: located.record,
      guard,
      budget: { ...budget, digest },
      env: process.env,
    });
    if (decision.action !== "continue") return;
    if (await injectContinuation(client, sessionID, continuationPrompt(decision))) {
      budget.continues += 1;
      budget.lastDigest = digest;
    }
  }

  return {
    event: async (input) => {
      try {
        const event = input?.event ?? input;
        if (event?.type !== "session.idle") return;
        await handleIdle(event?.properties?.sessionID);
      } catch {
        // Fail closed and silent: a plugin error never crashes the host.
      }
    },
  };
}
