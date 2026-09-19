import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

// Raised when a bounded harness wait elapses. Kept as a named type so callers
// can distinguish a harness bound from a daemon-reported failure.
export class HarnessTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "HarnessTimeoutError";
  }
}

// SIGKILL a child and resolve only once it has actually exited. Idempotent:
// safe on an already-exited child and safe to call repeatedly. The child is
// never left live — every code path either observes "exit"/"error" or the
// process was already reaped.
export function killAndReap(child, { signal = "SIGKILL" } = {}) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.once("exit", finish);
    child.once("error", finish);
    try {
      child.kill(signal);
    } catch {
      finish();
    }
  });
}

// Bounded wait for a child to exit. On timeout the child is SIGKILLed and
// reaped BEFORE resolving, so a live child can never outlive this call. A
// child that died by signal resolves -1 (the historical sentinel) so callers
// keep an unambiguous "did not exit cleanly" value.
export function waitExit(child, ms) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    if (child.exitCode !== null || child.signalCode !== null) {
      finish(child.signalCode ? -1 : child.exitCode);
      return;
    }
    child.once("exit", (code, signal) => finish(signal ? -1 : code));
    child.once("error", () => finish(-1));
    timer = setTimeout(() => {
      killAndReap(child).then(() => finish(-1));
    }, ms);
  });
}

// Bounded readiness wait. On timeout the child is SIGKILLed and reaped before
// the error is thrown — the caller must never have to clean up a leaked daemon
// after a readiness failure. `stderr` is a getter so the error carries the
// daemon's own diagnostics without capturing them eagerly.
export async function waitForReady(
  readyPath,
  child,
  { timeoutMs = 15000, intervalMs = 50, stderr = () => "" } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(readyPath)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      await killAndReap(child);
      throw new HarnessTimeoutError(`daemon.ready never appeared (${stderr()})`);
    }
    await sleep(Math.min(intervalMs, remaining));
  }
}
