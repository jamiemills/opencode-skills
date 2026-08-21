import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cdpFetchJson, cdpProbe } from "../../lib/fetch.mjs";

// cdpFetchJson/cdpProbe must work over a real HTTP server (they use Node's
// global fetch, so the tokenized URL never appears in an argv that other
// local users could read from /proc).
const server = createServer((req, res) => {
  if (req.url.startsWith("/slow")) return; // never respond -> timeout
  if (req.url.startsWith("/error")) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("boom");
    return;
  }
  if (req.url.startsWith("/badjson")) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("{not json");
    return;
  }
  if (req.url.startsWith("/flaky")) {
    // First two calls fail, third succeeds — for the probe retry loop.
    if (!server.flakyCount || server.flakyCount < 2) {
      server.flakyCount = (server.flakyCount || 0) + 1;
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("not yet");
      return;
    }
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, url: req.url }));
});
server.flakyCount = 0;

let base;
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
base = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("cdpFetchJson returns parsed JSON and sends the URL in the request, not argv", async () => {
  const body = await cdpFetchJson(`${base}/json/version?token=SECRET`);
  assert.deepEqual(body, { ok: true, url: "/json/version?token=SECRET" });
});

test("cdpFetchJson rejects non-2xx responses", async () => {
  await assert.rejects(cdpFetchJson(`${base}/error`), /HTTP 500/);
});

test("cdpFetchJson rejects malformed JSON payloads", async () => {
  await assert.rejects(cdpFetchJson(`${base}/badjson`), SyntaxError);
});

test("cdpFetchJson aborts when the attempt exceeds the timeout budget (curl -m semantics)", async () => {
  const start = Date.now();
  await assert.rejects(
    cdpFetchJson(`${base}/slow`, { timeoutMs: 500 }),
    (err) =>
      err &&
      (err.name === "AbortError" ||
        err.name === "TimeoutError" ||
        /abort|timeout/i.test(String(err))),
  );
  assert.ok(Date.now() - start < 5000, "abort must fire near the timeout budget, not hang");
});

test("cdpProbe retries until ready and gives up after the budget", async () => {
  // /flaky fails twice then succeeds.
  const ready = await cdpProbe(`${base}/flaky`, {
    timeoutMs: 4000,
    attemptTimeoutMs: 500,
    delayMs: 50,
  });
  assert.equal(ready, true, "probe must retry until the endpoint answers");
  // /error never answers -> probe exhausts its budget and reports false.
  const start = Date.now();
  const failed = await cdpProbe(`${base}/error`, {
    timeoutMs: 400,
    attemptTimeoutMs: 300,
    delayMs: 30,
  });
  assert.equal(failed, false, "probe must report not-ready after the budget");
  assert.ok(Date.now() - start < 5000);
});
