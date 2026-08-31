import CDP from "chrome-remote-interface";
import { validateState } from "./security.mjs";

export const DEFAULT_EVAL_TIMEOUT_MS = 5000;
export const MAX_EVAL_RESULT_BYTES = 1024 * 1024;
const EVAL_CANCEL_TIMEOUT_MS = 250;

export async function connect(state) {
  validateState(state);
  const client = await CDP({ target: state.wsUrl });
  return client;
}

export async function getSession(client) {
  const { sessionId } = await attachFirstPage(client);
  return sessionId;
}

// F-014: single implementation of the discover-and-attach sequence shared by
// every verb and the daemon. Returns the attached session plus the chosen
// page target so callers that need the page URL avoid re-discovery.
export async function listPageTargets(client) {
  const { targetInfos } = await client.send("Target.getTargets");
  return targetInfos.filter((t) => t.type === "page");
}

export async function attachFirstPage(client) {
  const pages = await listPageTargets(client);

  if (pages.length === 0) {
    // F-067-3: a typed error, not process.exit(2) — a library function must
    // let the caller run its own cleanup (WS close, redaction wrapper) and
    // decide the exit code.
    throw new Error("No page target exists. Hint: run ensure-browser first");
  }

  const target = pages[0];
  const { sessionId } = await client.send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: true,
  });

  return { sessionId, page: target };
}

export async function waitForLoad(client, sessionId) {
  const start = Date.now();
  const timeout = 30000;
  const load = new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      client.off("Page.loadEventFired", onLoad);
    };
    const onLoad = () => {
      cleanup();
      resolve();
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Page load timed out after ${Date.now() - start}ms`));
    }, timeout);
    client.once("Page.loadEventFired", onLoad);
  });
  await client.send("Page.enable", {}, sessionId);
  await load;
}

export async function clickCoords(client, sessionId, sel, index = 0) {
  const escaped = sel.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const expression = `(function(){var e=document.querySelectorAll('${escaped}')[${index}];if(!e)return null;var r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`;

  const { result } = await client.send(
    "Runtime.evaluate",
    {
      expression,
      returnByValue: true,
    },
    sessionId,
  );

  if (!result || !result.value) {
    throw new Error(`Element not found: "${sel}" at index ${index}`);
  }

  const { x, y } = result.value;

  await client.send(
    "Input.dispatchMouseEvent",
    {
      type: "mousePressed",
      x: Math.round(x),
      y: Math.round(y),
      button: "left",
      clickCount: 1,
    },
    sessionId,
  );

  await client.send(
    "Input.dispatchMouseEvent",
    {
      type: "mouseReleased",
      x: Math.round(x),
      y: Math.round(y),
      button: "left",
      clickCount: 1,
    },
    sessionId,
  );
}

// A click may start a navigation after the input events return. Keep the
// session usable until the new main frame has finished loading, but do not
// delay ordinary in-page clicks.
export async function clickAndWaitForNavigation(client, sessionId, sel, index = 0) {
  await client.send("Page.enable", {}, sessionId);
  const escaped = sel.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const navigationExpression = `(function(){var e=document.querySelectorAll('${escaped}')[${index}];return !!(e&&e.closest('a[href],form[action]'))})()`;
  const { result: navigationProbe } = await client.send(
    "Runtime.evaluate",
    { expression: navigationExpression, returnByValue: true },
    sessionId,
  );
  const mayNavigate = navigationProbe?.value === true;
  let resolveNavigation;
  let resolveLoad;
  let loadTimer;
  const navigation = new Promise((resolve) => (resolveNavigation = resolve));
  const load = new Promise((resolve, reject) => {
    loadTimer = setTimeout(() => reject(new Error("Page load timed out after 30000ms")), 30000);
    resolveLoad = () => {
      clearTimeout(loadTimer);
      resolve();
    };
  });
  const onFrameNavigated = (event) => {
    if (!event.frame?.parentId) {
      resolveNavigation();
    }
  };
  const onLoad = () => resolveLoad();
  client.on("Page.frameNavigated", onFrameNavigated);
  client.on("Page.loadEventFired", onLoad);
  try {
    await clickCoords(client, sessionId, sel, index);
    if (mayNavigate) {
      await navigation;
      await load;
    }
  } finally {
    clearTimeout(loadTimer);
    client.off("Page.frameNavigated", onFrameNavigated);
    client.off("Page.loadEventFired", onLoad);
  }
}

export async function waitForSelector(client, sessionId, sel, timeoutMs = 5000) {
  const escaped = sel.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const { result } = await client.send(
      "Runtime.evaluate",
      {
        expression: `!!document.querySelector('${escaped}')`,
        returnByValue: true,
      },
      sessionId,
    );

    if (result && result.value === true) return;

    await new Promise((r) => setTimeout(r, 100));
  }

  throw new Error(`waitForSelector timed out after ${timeoutMs}ms for "${sel}"`);
}

export function assertOutputCap(value, label = "output") {
  if (Buffer.byteLength(String(value), "utf8") > MAX_EVAL_RESULT_BYTES) {
    throw new Error(`${label} exceeds 1MB cap`);
  }
}

export async function evalInPage(
  client,
  sessionId,
  expression,
  { timeoutMs = DEFAULT_EVAL_TIMEOUT_MS } = {},
) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Evaluation timeout must be a positive integer");
  }

  let timer;
  const evaluation = client.send(
    "Runtime.evaluate",
    {
      expression,
      returnByValue: true,
      awaitPromise: true,
      timeout: timeoutMs,
    },
    sessionId,
  );
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const timeoutMessage = `Page evaluation timed out after ${timeoutMs}ms`;
      const cancellation = Promise.resolve()
        .then(() => client.send("Runtime.terminateExecution", {}, sessionId))
        .then(
          async () => {
            try {
              await client.close?.();
            } catch {}
            reject(new Error(timeoutMessage));
            return "cancelled";
          },
          async (error) => {
            // A timed-out evaluation must not remain usable if CDP cannot
            // terminate it. Closing the session is the fail-closed fallback.
            try {
              await client.close?.();
            } catch {}
            reject(
              new Error(
                `${timeoutMessage}; unable to cancel evaluation, CDP session closed: ${String(error.message || error)}`,
              ),
            );
            return "failed";
          },
        );
      void Promise.race([
        cancellation,
        new Promise((resolve) => setTimeout(resolve, EVAL_CANCEL_TIMEOUT_MS)),
      ]).then((outcome) => {
        if (outcome === undefined) {
          void Promise.resolve(client.close?.()).catch(() => {});
          reject(new Error(`${timeoutMessage}; cancellation timed out, CDP session closed`));
        }
      });
    }, timeoutMs);
  });

  let response;
  try {
    response = await Promise.race([evaluation, deadline]);
  } finally {
    clearTimeout(timer);
  }

  const { result, exceptionDetails } = response;

  if (exceptionDetails) {
    let where = "";
    if (
      typeof exceptionDetails.lineNumber === "number" &&
      typeof exceptionDetails.columnNumber === "number"
    ) {
      where = ` at line ${exceptionDetails.lineNumber + 1}, column ${exceptionDetails.columnNumber + 1}`;
    }
    const detail =
      exceptionDetails.exception &&
      (exceptionDetails.exception.description || exceptionDetails.exception.value);
    const suffix = detail ? `: ${String(detail).split("\n")[0]}` : "";
    throw new Error(
      `Page evaluation threw${where}: ${exceptionDetails.text || "exception"}${suffix}`,
    );
  }

  assertOutputCap(JSON.stringify(result), "eval result");

  return result;
}
