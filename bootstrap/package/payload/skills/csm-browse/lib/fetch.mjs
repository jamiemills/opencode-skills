import { redactUrl } from "./security.mjs";
import { CDP_RETRY_TIMEOUT_MS } from "./constants.mjs";

// CDP discovery over Node's global fetch (Node 22). The tokenized URL lives
// in the request, never in argv, so it cannot be read from /proc/<pid>/cmdline
// (the previous curl invocation leaked it there). `timeoutMs` mirrors curl's
// -m semantics: the whole attempt, connection + body, must fit in the budget.
export async function cdpFetchJson(url, { timeoutMs = 2000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (timer.unref) timer.unref();
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`CDP HTTP ${res.status} from ${redactUrl(url)}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// CDP readiness probe: keep trying until `timeoutMs` total has elapsed. Each
// attempt is bounded by `attemptTimeoutMs` (the old curl -m 2); failures and
// malformed payloads are treated as not-ready and retried after `delayMs`.
export async function cdpProbe(
  url,
  { timeoutMs = CDP_RETRY_TIMEOUT_MS, attemptTimeoutMs = 2000, delayMs = 1000 } = {},
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await cdpFetchJson(url, { timeoutMs: attemptTimeoutMs });
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return false;
}
