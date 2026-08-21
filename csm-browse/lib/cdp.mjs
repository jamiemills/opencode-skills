import CDP from "chrome-remote-interface";

export async function connect(state) {
  const client = await CDP({ target: state.wsUrl });
  return client;
}

export async function getSession(client) {
  const { targetInfos } = await client.send("Target.getTargets");
  const pages = targetInfos.filter((t) => t.type === "page");

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

  return sessionId;
}

export async function waitForLoad(client, sessionId) {
  const start = Date.now();
  const timeout = 30000;
  while (Date.now() - start < timeout) {
    try {
      const { result } = await client.send(
        "Runtime.evaluate",
        {
          expression: "document.readyState",
          returnByValue: true,
        },
        sessionId,
      );
      if (result && result.value === "complete") return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Page load timed out after 30s");
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

export async function evalInPage(client, sessionId, expression) {
  const { result, exceptionDetails } = await client.send(
    "Runtime.evaluate",
    {
      expression,
      returnByValue: true,
      awaitPromise: true,
    },
    sessionId,
  );

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

  const json = JSON.stringify(result);
  if (json.length > 1024 * 1024) {
    throw new Error("eval result exceeds 1MB cap");
  }

  return result;
}
