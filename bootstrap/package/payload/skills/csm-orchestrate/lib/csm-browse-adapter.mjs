"use strict";

import { createHash } from "node:crypto";
import { digest } from "../../../lib/schema-runtime/index.mjs";

const MAX_OUTPUT_BYTES = 1024 * 1024;
const OPERATIONS = new Set([
  "navigate",
  "wait",
  "wait-selector",
  "click",
  "type",
  "press",
  "eval",
  "capture",
  "log",
  "status",
]);
const SPECIAL_KEYS = new Set([
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "Delete",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);
const policyError = (code, message) => Object.assign(new Error(message), { code });

export function sessionIdFor(context) {
  return `orch-${createHash("sha256").update(`${context.runId}\0${context.attempt}`).digest("hex").slice(0, 32)}`;
}

function assertUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw policyError("unsafe-url", "browser navigation URL is invalid");
  }
  if (!new Set(["http:", "https:"]).has(url.protocol))
    throw policyError("unsafe-url", "browser navigation permits only http and https");
  url.username = "";
  url.password = "";
  return url.href;
}

function bounded(value, label = "browser output") {
  if (Buffer.byteLength(JSON.stringify(value) ?? "null") > MAX_OUTPUT_BYTES)
    throw policyError("output-too-large", `${label} exceeds 1MiB`);
  return value;
}

function assertOwnedState(state, sid, { sessionDir, validateSid, validateState }) {
  validateSid(sid);
  validateState(state, sid);
  if (state.sid !== undefined && state.sid !== sid)
    throw policyError("foreign-session", "session identity mismatch");
  if ([state.publicPort, state.internalPort].includes(9222))
    throw policyError("shared-port-forbidden", "port 9222 is never a session target");
  if (state.sessionDir && state.sessionDir !== sessionDir(sid))
    throw policyError("foreign-session", "session path is not owned by the derived session");
  return state;
}

async function loadSessionModules() {
  const [{ sessionDir, validateSid }, { validateState }, { validateEvidenceDescriptor }] =
    await Promise.all([
      import("../../csm-browse/lib/session.mjs"),
      import("../../csm-browse/lib/security.mjs"),
      import("../../csm-browse/lib/json-contract.mjs"),
    ]);
  return { sessionDir, validateSid, validateState, validateEvidenceDescriptor };
}

function assertTypedInput(input) {
  for (const field of ["selector", "text", "expression"]) {
    if (field in input && typeof input[field] !== "string")
      throw policyError("invalid-operation", `${field} must be a string`);
  }
  if ("index" in input && (!Number.isInteger(input.index) || input.index < 0 || input.index > 1000))
    throw policyError("invalid-operation", "index is out of bounds");
  if (
    "timeoutMs" in input &&
    (!Number.isInteger(input.timeoutMs) || input.timeoutMs <= 0 || input.timeoutMs > 30000)
  )
    throw policyError("invalid-operation", "timeout is out of bounds");
}

function reconciliationResult(
  sid,
  message = "browser action may have occurred; reconcile before retry",
) {
  return {
    status: "incomplete",
    effects: [],
    artifacts: [],
    evidence: [],
    output: { sessionId: sid },
    failure: {
      class: "incomplete",
      code: "reconciliation-required",
      message,
    },
  };
}

function requireSensitive(input, request) {
  if (
    input.allowSensitive !== true ||
    request.approval?.status !== "approved" ||
    !request.permissions?.includes("browser-sensitive")
  )
    throw policyError(
      "sensitive-approval-required",
      "operation requires explicit browser-sensitive approval",
    );
}

function translateEvidence(native, context, validateEvidenceDescriptor) {
  validateEvidenceDescriptor(native, { sourceRunId: native.runId });
  const body = {
    schema: "csm-orchestrate-evidence/2",
    evidenceId: `ev-${context.runId.slice(4)}-${native.evidenceId.slice(9)}`.slice(0, 140),
    kind: native.kind === "dom" ? "functional" : "technical",
    status: "current",
    owner: context.owner,
    runId: context.runId,
    source: {
      path: native.path,
      artifactId: native.evidenceId,
      digest: native.descriptorDigest,
      schema: native.schema,
      sourceRunId: native.runId,
      nativeRunId: native.runId,
      nativeArtifactId: native.evidenceId,
    },
  };
  return { ...body, digest: digest(body) };
}

function translateArtifact(native, context) {
  const body = {
    artifactId: `artifact-${context.runId.slice(4)}-${native.evidenceId.slice(9)}`.slice(0, 140),
    schema: native.schema,
    runId: context.runId,
    owner: context.owner,
    path: native.path,
    nativeArtifactId: native.evidenceId,
    nativeRunId: native.runId,
    bytes: native.bytes,
    value: native,
  };
  return { ...body, digest: digest(body) };
}

async function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) throw policyError("cancelled", "browser operation cancelled");
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(policyError("cancelled", "browser operation cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function runCdpOperation(
  client,
  attachedSessionId,
  input,
  { clickCoords, evalInPage, waitForLoad, waitForSelector },
) {
  if (input.operation === "navigate") {
    const url = assertUrl(input.url);
    const load = waitForLoad(client, attachedSessionId);
    await client.send("Page.navigate", { url }, attachedSessionId);
    await load;
    const title = await evalInPage(client, attachedSessionId, "document.title");
    return {
      sessionId: attachedSessionId,
      url: new URL(url).origin,
      title: String(title?.value ?? ""),
    };
  }
  if (input.operation === "wait") {
    if (!Number.isInteger(input.ms) || input.ms < 0 || input.ms > 30000)
      throw policyError("invalid-operation", "wait duration is out of bounds");
    await new Promise((resolve) => setTimeout(resolve, input.ms));
    return { waited: input.ms };
  }
  if (input.operation === "wait-selector") {
    if (typeof input.selector !== "string" || !input.selector)
      throw policyError("invalid-operation", "selector is required");
    await waitForSelector(client, attachedSessionId, input.selector, input.timeoutMs ?? 5000);
    return { found: input.selector };
  }
  if (input.operation === "click") {
    await clickCoords(client, attachedSessionId, input.selector, input.index ?? 0);
    return { clicked: input.selector, index: input.index ?? 0 };
  }
  if (input.operation === "type") {
    await clickCoords(client, attachedSessionId, input.selector);
    await client.send("Input.insertText", { text: input.text }, attachedSessionId);
    return { typed: true, selector: input.selector };
  }
  if (input.operation === "press") {
    if (typeof input.key !== "string" || (input.key.length !== 1 && !SPECIAL_KEYS.has(input.key)))
      throw policyError("invalid-operation", "key is not allowlisted");
    await clickCoords(client, attachedSessionId, input.selector);
    for (const type of ["rawKeyDown", "keyUp"])
      await client.send(
        "Input.dispatchKeyEvent",
        { type, key: input.key, code: input.key },
        attachedSessionId,
      );
    return { pressed: input.key, selector: input.selector };
  }
  if (input.operation === "eval")
    return {
      result: bounded(
        await evalInPage(client, attachedSessionId, input.expression, {
          timeoutMs: input.timeoutMs ?? 5000,
        }),
        "eval output",
      ),
    };
  if (input.operation === "status") return await client.send("Browser.getVersion");
  throw policyError("binding-required", `${input.operation} requires an injected evidence binding`);
}

export function createCsmBrowseAdapter({
  ensureSession,
  cleanupSession,
  capture,
  readLog,
  artifactResolver = null,
} = {}) {
  if (typeof ensureSession !== "function")
    throw new TypeError("csm-browse ensureSession binding is required");
  if (typeof cleanupSession !== "function")
    throw new TypeError("csm-browse cleanupSession binding is required");
  return Object.freeze({
    skill: "csm-browse",
    async execute({ input = {}, signal, context, request }) {
      if (!OPERATIONS.has(input.operation))
        throw policyError("invalid-operation", "typed browser operation is required");
      assertTypedInput(input);
      if (signal?.aborted)
        return {
          status: "cancelled",
          effects: [],
          artifacts: [],
          evidence: [],
          failure: {
            class: "policy",
            code: "cancelled",
            message: "execution cancelled before dispatch",
          },
        };
      if (["eval", "log"].includes(input.operation)) requireSensitive(input, request);
      const sid = sessionIdFor(context);
      let state;
      let client;
      let dispatched = false;
      let provisioned = false;
      let cleanupAttempted = false;
      let result;
      let thrown;
      try {
        const browse = await loadSessionModules();
        state = await ensureSession({ sid, context, signal });
        provisioned = true;
        state = assertOwnedState(state, sid, browse);
        if (signal?.aborted)
          result = {
            status: "cancelled",
            effects: [],
            artifacts: [],
            evidence: [],
            failure: {
              class: "policy",
              code: "cancelled",
              message: "execution cancelled before dispatch",
            },
          };
        if (!result && (input.operation === "capture" || input.operation === "log")) {
          if (input.operation === "capture" && input.binaryAcknowledged !== true)
            throw policyError("binary-acknowledgment", "binary capture requires acknowledgment");
          const fn = input.operation === "capture" ? capture : readLog;
          if (typeof fn !== "function")
            throw policyError("binding-required", `${input.operation} binding is required`);
          dispatched = true;
          const native = await abortable(fn({ state, sid, input, context, signal }), signal);
          browse.validateEvidenceDescriptor(native, { sourceRunId: native.runId });
          if (!artifactResolver?.resolve)
            throw policyError("invalid-artifact", "browser artifact resolver is required");
          const resolved = await artifactResolver.resolve(native.path, {
            expectedFileDigest: native.digest,
            expectedArtifactId: native.evidenceId,
            expectedOwner: "csm-browse",
            expectedSourceRunId: native.runId,
          });
          if (resolved?.status !== "resolved" || resolved.fileDigest !== native.digest)
            throw policyError("invalid-artifact", "browser evidence was not resolver-validated");
          result = {
            status: "completed",
            effects:
              input.operation === "capture"
                ? ["browser-session", "workspace-write"]
                : ["browser-session"],
            output: { sessionId: sid },
            artifacts: input.operation === "capture" ? [translateArtifact(native, context)] : [],
            evidence: [translateEvidence(native, context, browse.validateEvidenceDescriptor)],
          };
        }
        if (!result) {
          const {
            attachFirstPage,
            clickCoords,
            connect,
            evalInPage,
            waitForLoad,
            waitForSelector,
          } = await import("../../csm-browse/lib/cdp.mjs");
          client = await abortable(connect(state), signal);
          const attached = await abortable(attachFirstPage(client), signal);
          dispatched = true;
          const output = await abortable(
            runCdpOperation(client, attached.sessionId, input, {
              clickCoords,
              evalInPage,
              waitForLoad,
              waitForSelector,
            }),
            signal,
          );
          if (signal?.aborted)
            throw policyError("cancelled", "browser operation cancelled after dispatch");
          result = {
            status: "completed",
            effects: ["browser-session"],
            output: bounded({ sessionId: sid, ...output }),
            artifacts: [],
            evidence: [],
          };
        }
      } catch (error) {
        if (dispatched && (error.code === "cancelled" || signal?.aborted))
          result = reconciliationResult(sid);
        else thrown = error;
      }
      try {
        if (client?.close) await client.close();
      } catch (error) {
        if (dispatched && (error.code === "cancelled" || signal?.aborted))
          result = reconciliationResult(sid);
        else if (!thrown) thrown = error;
      }
      if (provisioned && !cleanupAttempted) {
        cleanupAttempted = true;
        try {
          await cleanupSession({ sid, state, context });
        } catch (error) {
          result = reconciliationResult(
            sid,
            `browser session cleanup failed; reconcile before retry: ${error.message}`,
          );
          thrown = null;
        }
      }
      if (thrown) throw thrown;
      return result;
    },
  });
}

export { MAX_OUTPUT_BYTES };
