import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { decideContinuation, evaluateReadiness, recordDigest } from "./csm-continue-core.mjs";

// T002: opencode plugin wrapper over the pure continuation core (T001). It
// subscribes to `session.idle`, locates the active build run's durable record
// in the working directory, computes readiness from that record alone, and
// injects at most one bounded continuation prompt per idle. Every path is
// fail-closed and silent: an absent run, an unavailable client, or any thrown
// error leaves the host untouched. Import has no side effects, and the wrapper
// depends ONLY on its sibling core so the installer can drop both files into
// the opencode plugins directory with no repository present.

export const DEFAULT_MAX_CONTINUES = 5;
export const ACTIVE_RECORD_SEGMENTS = Object.freeze([".agents", "csm-build-state", "active.json"]);

function maxContinuesFrom(env) {
  const parsed = Number.parseInt(env?.CSM_CONTINUE_MAX ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_CONTINUES;
}

const absolute = (directory, value) => (isAbsolute(value) ? value : join(directory, value));

// Locate the active run's durable record. `CSM_CONTINUE_RECORD` overrides the
// conventional `.agents/csm-build-state/active.json`; both resolve inside
// `directory`. A missing or malformed record means "no active run" (silent).
export async function locateActiveRecord(directory, env = process.env) {
  const override = typeof env?.CSM_CONTINUE_RECORD === "string" ? env.CSM_CONTINUE_RECORD : "";
  const path = override
    ? absolute(directory, override)
    : join(directory, ...ACTIVE_RECORD_SEGMENTS);
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return { record: value, path };
  } catch {
    return null;
  }
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
