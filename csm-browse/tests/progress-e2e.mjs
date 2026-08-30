#!/usr/bin/env node
import { execFile, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  itemForNode,
  createProgressDocument,
  updateProgress,
} from "../../csm-orchestrate/lib/progress.mjs";
import { projectProgress } from "../../csm-orchestrate/output/projection.mjs";

const SKILL_DIR = fileURLToPath(new URL("..", import.meta.url));
const SESSION_ID = `progress-e2e-${Date.now()}`;
const REQUIRE = process.env.CSM_BROWSE_E2E_REQUIRE === "1";
const SKIP = process.env.CSM_BROWSE_E2E_SKIP === "1";
let server;
let sessionReady = false;

const run = (command, args, timeout = 60000) =>
  new Promise((resolve) =>
    execFile(command, args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) =>
      resolve({ ok: !error, stdout: stdout.trim(), stderr: stderr.trim(), error }),
    ),
  );

const browse = (verb, ...args) =>
  run(
    "node",
    [join(SKILL_DIR, "scripts", "browse.mjs"), verb, "--session", SESSION_ID, ...args],
    35000,
  );

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`PASS: ${message}`);
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} was not JSON: ${value.slice(0, 200)}`);
  }
}

function bridgeHost() {
  const configured = process.env.CSM_BROWSE_FIXTURE_BASE?.match(/^[a-z]+:\/\/([^/:?]+)/i);
  if (configured) return configured[1];
  const probes = [
    [
      "docker",
      [
        "inspect",
        "chromium-vnc",
        "--format",
        "{{range $k,$v := .NetworkSettings.Networks}}{{$v.Gateway}} {{end}}",
      ],
    ],
    ["ip", ["route"]],
    ["hostname", ["-I"]],
  ];
  for (const [command, args] of probes) {
    try {
      const result = execFileSync(command, args, { encoding: "utf8", timeout: 2000 });
      const match = result.match(/\b(\d+\.\d+\.\d+\.\d+)\b/);
      if (match) return match[1];
    } catch {}
  }
  return "127.0.0.1";
}

function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );
}

function syntheticProjection() {
  const phase = { phaseId: "phase-progress", graphRevision: 1 };
  const first = itemForNode({
    runId: "run-progress-e2e",
    graphRevision: 1,
    phase,
    node: { nodeId: "node-build", skill: "csm-build" },
    weight: 60,
  });
  const second = {
    ...itemForNode({
      runId: "run-progress-e2e",
      graphRevision: 1,
      phase,
      node: { nodeId: "node-browse", skill: "csm-browse" },
      weight: 40,
    }),
    evidenceRefs: ["password=synthetic-secret", "sha256:" + "a".repeat(64)],
  };
  let document = createProgressDocument({
    runId: "run-progress-e2e",
    items: [first, second],
    now: "2026-08-30T04:00:00Z",
  });
  document = updateProgress(
    document,
    first.itemId,
    { state: "verified", verifiedFraction: 1 },
    { now: "2026-08-30T04:00:01Z" },
  );
  document = updateProgress(
    document,
    second.itemId,
    { state: "active", verifiedFraction: 0.5, attempt: 2 },
    { now: "2026-08-30T04:00:02Z", eventsObserved: 2 },
  );
  return { document, projection: projectProgress(document, { profile: "csm-browse" }) };
}

async function startFixture(html) {
  const host = bridgeHost();
  server = createServer((request, response) => {
    if (request.url !== "/progress.html") {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  return `http://${host}:${server.address().port}/progress.html`;
}

async function closeFixture() {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
  server = null;
}

async function main() {
  if (SKIP) {
    const message = "CSM_BROWSE_E2E_SKIP=1";
    if (REQUIRE) throw new Error(`e2e is REQUIRED but infrastructure was skipped (${message})`);
    console.log(`SKIP: ${message}`);
    return;
  }

  const docker = await run("docker", ["info"], 15000);
  if (!docker.ok) {
    const blocker = docker.stderr || docker.error?.message || "docker info failed";
    if (REQUIRE) throw new Error(`e2e is REQUIRED but Docker is unavailable: ${blocker}`);
    console.log(`SKIP: Docker/chromium-vnc unavailable (${blocker})`);
    return;
  }

  const { document, projection } = syntheticProjection();
  assert(document.schema === "csm-progress/1", "synthetic canonical progress uses csm-progress/1");
  assert(projection.overall.percentage === 80, "projection reports 80% overall progress");
  assert(
    !projection.text.includes("synthetic-secret") && !projection.text.includes("password="),
    "projection contains no secret-like fields",
  );

  const html = `<!doctype html><html><head><title>Progress</title><link rel="icon" href="data:,"></head><body>
    <main aria-labelledby="progress-title">
      <h1 id="progress-title">Progress overview</h1>
      <section aria-labelledby="overall-title">
        <h2 id="overall-title">Overall progress</h2>
        <div id="overall-progress" role="progressbar" aria-label="Overall task progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${projection.overall.percentage}" aria-valuetext="${projection.overall.percentage}% (${projection.overall.outcome})">${escapeHtml(projection.overall.bar)}</div>
        <p id="overall-status">${escapeHtml(`Overall: ${projection.overall.percentage}% (${projection.overall.outcome})`)}</p>
      </section>
      <section aria-labelledby="milestones-title"><h2 id="milestones-title">Milestones</h2>
        <ul id="milestones" aria-labelledby="milestones-title">${projection.milestones.map((milestone) => `<li data-state="${milestone.state}">${escapeHtml(`${milestone.name} ${milestone.state} ${milestone.weightPercent}%`)}</li>`).join("")}</ul>
      </section>
      <pre id="projection-text">${escapeHtml(projection.text)}</pre>
    </main></body></html>`;

  const url = await startFixture(html);
  const ensured = await run(
    "node",
    [join(SKILL_DIR, "scripts", "ensure-browser.mjs"), "--session", SESSION_ID],
    120000,
  );
  if (!ensured.ok)
    throw new Error(`isolated browser setup failed: ${ensured.stderr || ensured.stdout}`);
  sessionReady = true;
  const stateLine = ensured.stdout
    .split("\n")
    .toReversed()
    .find((line) => line.trim().startsWith("{"));
  const state = parseJson(stateLine, "ensure-browser state");
  assert(
    state.sid === SESSION_ID && state.publicPort >= 9224,
    "browser uses an isolated session port",
  );

  let result = await browse("open", url);
  assert(result.ok, `progress projection opened (${result.stdout})`);
  result = await browse(
    "eval",
    `JSON.stringify((()=>{const p=document.querySelector('#overall-progress');const list=document.querySelectorAll('#milestones li');return {role:p?.getAttribute('role'),label:p?.getAttribute('aria-label'),now:p?.getAttribute('aria-valuenow'),text:p?.getAttribute('aria-valuetext'),milestones:list.length,main:!!document.querySelector('main[aria-labelledby="progress-title"]'),listLabel:document.querySelector('#milestones')?.getAttribute('aria-labelledby')}})())`,
    "--allow-sensitive",
  );
  const semantics = parseJson(
    parseJson(result.stdout, "DOM evaluation").result.value,
    "DOM semantics",
  );
  assert(
    semantics.role === "progressbar" &&
      semantics.label === "Overall task progress" &&
      semantics.now === "80",
    "DOM exposes named overall progress semantics",
  );
  assert(
    semantics.milestones === 2 && semantics.main && semantics.listLabel === "milestones-title",
    "DOM exposes milestone structure and labels",
  );

  result = await browse("text", "#projection-text", "--allow-sensitive");
  assert(
    result.ok && result.stdout.includes("TASK PROGRESS") && result.stdout.includes("80% (active)"),
    "projection text includes overall progress output",
  );
  assert(
    result.stdout.includes("csm-build/phase-progress complete") &&
      result.stdout.includes("csm-browse/phase-progress active"),
    "projection text includes milestone output",
  );
  assert(
    !result.stdout.includes("synthetic-secret") &&
      !result.stdout.includes("password=") &&
      !result.stdout.includes("sha256:"),
    "rendered DOM contains no secrets or sensitive references",
  );

  const consoleEvents = parseJson((await browse("console")).stdout, "console events");
  const consoleErrors = consoleEvents.filter((event) => {
    const payload = event.payload || {};
    return event.type === "exception" || payload.level === "error" || payload.type === "error";
  });
  assert(
    consoleErrors.length === 0,
    `browser console has no errors (${consoleErrors.map((event) => `${event.type}:${event.payload?.type || event.payload?.level || "error"}`).join(",")})`,
  );
  const networkEvents = parseJson((await browse("network")).stdout, "network events");
  const unexpected = networkEvents.filter((event) => {
    const payload = event.payload || {};
    if (payload.phase === "failed") return true;
    if (payload.phase === "response")
      return (
        payload.status >= 400 ||
        !String(payload.url || "").startsWith(url.split("/progress.html")[0])
      );
    if (payload.phase === "request")
      return !String(payload.url || "").startsWith(url.split("/progress.html")[0]);
    return false;
  });
  assert(
    unexpected.length === 0,
    `network has no unexpected requests or failures (${networkEvents.length} events)`,
  );
  console.log(
    JSON.stringify({
      schema: "csm-browse-progress-evidence/1",
      session: SESSION_ID,
      overall: projection.overall,
      milestones: projection.milestones.length,
      consoleErrors: 0,
      unexpectedNetwork: 0,
    }),
  );
}

try {
  await main();
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = REQUIRE ? 2 : 1;
} finally {
  try {
    if (sessionReady) {
      const closed = await browse("close");
      console.log(`CLEANUP: isolated session ${closed.ok ? "closed" : "close failed"}`);
    }
  } finally {
    await closeFixture();
  }
}
