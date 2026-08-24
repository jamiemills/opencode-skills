import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { clickCoords, waitForSelector, evalInPage, waitForLoad } from "../../lib/cdp.mjs";

function recordingClient(handler) {
  const calls = [];
  return {
    calls,
    async send(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      return handler(method, params, sessionId);
    },
  };
}

test("evalInPage throws with text, line and column on exceptionDetails", async () => {
  const client = recordingClient(() => ({
    result: { type: "object" },
    exceptionDetails: {
      text: "Uncaught",
      lineNumber: 3,
      columnNumber: 4,
      exception: { description: "TypeError: boom\n    at foo (page:1:1)" },
    },
  }));
  await assert.rejects(
    evalInPage(client, "s", "null.x"),
    /Page evaluation threw at line 4, column 5: Uncaught: TypeError: boom/,
  );
});

test("evalInPage exception without position still names the exception text", async () => {
  const client = recordingClient(() => ({
    result: undefined,
    exceptionDetails: { text: "ReferenceError: q is not defined" },
  }));
  await assert.rejects(
    evalInPage(client, "s", "q"),
    /Page evaluation threw: ReferenceError: q is not defined/,
  );
});

test("evalInPage enforces the 1MB result cap", async () => {
  const big = { type: "string", value: "x".repeat(1024 * 1024) };
  const client = recordingClient(() => ({ result: big }));
  await assert.rejects(evalInPage(client, "s", "'x'"), /exceeds 1MB cap/);
});

test("evalInPage returns the serialized result unchanged under the cap", async () => {
  const result = { type: "string", value: "y".repeat(1024 * 1024 - 64) };
  const client = recordingClient(() => ({ result }));
  const out = await evalInPage(client, "s", "'y'");
  assert.deepEqual(out, result);
});

test("clickCoords escapes backslash and quote in the generated selector", async () => {
  const client = recordingClient((method) => {
    if (method === "Runtime.evaluate") return { result: { value: { x: 10.4, y: 20.6 } } };
    return {};
  });
  await clickCoords(client, "s", "#a'b\\c");
  const evals = client.calls.filter((c) => c.method === "Runtime.evaluate");
  assert.equal(evals.length, 1);
  assert.ok(
    evals[0].params.expression.includes("querySelectorAll('#a\\'b\\\\c')"),
    `selector not escaped: ${evals[0].params.expression}`,
  );
  const clicks = client.calls.filter((c) => c.method === "Input.dispatchMouseEvent");
  assert.deepEqual(
    clicks.map((c) => [c.params.type, c.params.x, c.params.y]),
    [
      ["mousePressed", 10, 21],
      ["mouseReleased", 10, 21],
    ],
  );
});

test("clickCoords throws when the element is not found", async () => {
  const client = recordingClient(() => ({ result: { value: null } }));
  await assert.rejects(
    clickCoords(client, "s", "#missing", 3),
    /Element not found: "#missing" at index 3/,
  );
});

test("waitForSelector times out with a descriptive error", async () => {
  const client = recordingClient(() => ({ result: { value: false } }));
  await assert.rejects(
    waitForSelector(client, "s", "#x'y", 120),
    /waitForSelector timed out after 120ms for "#x'y"/,
  );
});

test("waitForSelector polls until the element appears", async () => {
  let n = 0;
  const client = recordingClient(() => ({ result: { value: ++n >= 2 } }));
  await waitForSelector(client, "s", "#late", 5000);
  assert.equal(client.calls.length, 2);
});

test("waitForLoad resolves on the browser load event", async () => {
  const client = new EventEmitter();
  client.send = async () => ({});
  const loading = waitForLoad(client, "s");
  client.emit("Page.loadEventFired");
  await loading;
});
