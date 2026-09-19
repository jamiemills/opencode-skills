"use strict";

// T012: tracked decision artifacts. The adapter's decisions are observational
// evidence, so each run writes exactly ONE tracked artifact under
// `.agents/decisions/<runId>.json` holding one audit record per APPLIED
// decision. The `csm-decision/1` JSON Schema is a single-record object, so the
// run file is a JSON array whose elements are each a schema-valid
// `csm-decision/1` record (one record per applied decision) -- the array is the
// run container, never a new unregistered schema id.
//
// Two invariants are non-negotiable:
//   - Redaction runs over the entire artifact BEFORE it is written. Jev can
//     never disable, weaken, or own redaction (never-Jev boundary).
//   - Every emitted record validates as `csm-decision/1`; an invalid record is
//     refused rather than written.
//
// Indexing is section-anchored and idempotent: a real write inserts one bullet
// under the `## decisions/` section via `insertAgentsIndexBullet`. Tests write
// to a temp dir (or inject a no-op indexer) so they never touch the README.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { createSchemaValidator, parseJson } from "../../../lib/schema-runtime/index.mjs";

export const DECISION_ARTIFACT_SCHEMA = "csm-decision/1";
export const DECISION_ARTIFACT_SCHEMA_REVISION = 1;
export const DECISION_ARTIFACT_DIR = ".agents/decisions";
export const DECISION_ARTIFACT_INDEX_CLASS = "decisions";

const RUN_ID_PATTERN = /^run-[a-z0-9][a-z0-9-]{1,127}$/;
const DECISION_ID_PATTERN = /^decision-[a-z0-9][a-z0-9-]{1,63}$/;
const STATE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const DEFAULT_CRITERIA = Object.freeze(["deterministic-baseline"]);
const DEFAULT_PROVIDER = Object.freeze({ id: "unspecified", model: "unspecified" });
const DEFAULT_TRANSPORT = "decision-adapter";

// Any object key that names credential material. These are redacted by key, so
// a value under `authorization`/`*_KEY`/`*_TOKEN`/`*_SECRET`/`apiKey` never
// reaches disk even when it is not recognized as a token.
export const CREDENTIAL_KEY_RE =
  /authorization|api[-_]?key|(?:^|[_-])(?:key|token|secret|password|passwd|credential|cookie)$|^auth$/i;

const BEARER_RE = /\bBearer\s+\S+/gi;
// Independent, vendor-aware token shapes: GitHub PATs, Google API keys, AWS
// access keys, Slack/Stripe/GitLab/Docker/PyPI/npm/HF tokens, JWT/opaque
// base64url triples, and PEM private-key headers. Kept as one source so the
// redactor and the fail-closed survivor net cannot silently diverge.
const KEY_SHAPED_SOURCE =
  "(?:\\b(?:sk|rk|pk|gw|gsk|xai|ghp|gho|ghs|ghr|github_pat|xox[baprs]|AKIA|glpat|dckr_pat|pypi|npm|hf)[_-][A-Za-z0-9_-]{8,}\\b|\\bAIza[A-Za-z0-9_-]{20,}\\b|\\beyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\b|-----BEGIN [A-Z ]*PRIVATE KEY-----)";
const KEY_SHAPED_RE = new RegExp(KEY_SHAPED_SOURCE, "g");
const KEY_SHAPED_TEST_RE = new RegExp(KEY_SHAPED_SOURCE);
const BEARER_LONG_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i;

export function isCredentialKey(key) {
  return typeof key === "string" && CREDENTIAL_KEY_RE.test(key);
}

// Credential literals taken from the environment: a value whose env var name is
// credential-shaped is a secret regardless of where it is echoed.
function secretLiterals(env) {
  const secrets = [];
  for (const [name, raw] of Object.entries(env ?? {})) {
    if (!isCredentialKey(name)) continue;
    const text =
      typeof raw === "string" ? raw : raw === null || raw === undefined ? "" : String(raw);
    if (text.length > 0) secrets.push({ name, text });
  }
  return secrets.toSorted((a, b) => b.text.length - a.text.length || a.name.localeCompare(b.name));
}

function redactString(text, secrets) {
  let out = text;
  for (const { name, text: secret } of secrets)
    if (out.includes(secret)) out = out.split(secret).join(`[REDACTED:${name}]`);
  out = out.replace(BEARER_RE, "[REDACTED:bearer]");
  out = out.replace(KEY_SHAPED_RE, "[REDACTED:key]");
  return out;
}

function redactNode(node, secrets) {
  if (Array.isArray(node)) return node.map((item) => redactNode(item, secrets));
  if (node !== null && typeof node === "object") {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = isCredentialKey(key) ? `[REDACTED:${key}]` : redactNode(value, secrets);
    }
    return out;
  }
  if (typeof node === "string") return redactString(node, secrets);
  return node;
}

// Redacts credential-shaped keys, env-var secret literals, `Bearer <token>`
// pairs, and vendor key prefixes anywhere in a value. Never mutates its input.
export function redactDecisionArtifact(value, { env = {} } = {}) {
  return redactNode(value, secretLiterals(env));
}

// Returns the credential-shaped strings that survived redaction. The writer
// calls this as a fail-closed net; a non-empty result aborts the write.
export function findCredentialShapes(value) {
  const findings = [];
  const visit = (node) => {
    if (typeof node === "string") {
      if (BEARER_LONG_RE.test(node) || KEY_SHAPED_TEST_RE.test(node)) findings.push(node);
      return;
    }
    if (Array.isArray(node)) node.forEach(visit);
    else if (node !== null && typeof node === "object") Object.values(node).forEach(visit);
  };
  visit(value);
  return findings;
}

function answerKey(answer) {
  if (answer === null || answer === undefined) return "null";
  if (typeof answer !== "object") return JSON.stringify(answer);
  if (answer.type === "choice") return `choice:${answer.choice}`;
  if (answer.type === "noul") return `noul:${answer.noul === true}`;
  if (answer.type === "score") return `score:${JSON.stringify(answer.scores ?? null)}`;
  return JSON.stringify(answer);
}

export function answersAgree(left, right) {
  if (left === null || left === undefined || right === null || right === undefined) return false;
  return answerKey(left) === answerKey(right);
}

function normalizeAnswer(answer) {
  if (answer !== null && typeof answer === "object") return { ...answer };
  if (typeof answer === "string") return { type: "choice", choice: answer };
  return { type: "noul", noul: true };
}

function deriveDecisionId(runId, pointId, index) {
  const digest = createHash("sha256")
    .update(`${runId}:${pointId}:${index}`)
    .digest("hex")
    .slice(0, 16);
  return `decision-${digest}`;
}

// Builds one schema-valid `csm-decision/1` audit record. `baselineAgreement`
// honors an explicit boolean from the decision, otherwise it is derived by
// comparing the answer with the deterministic baseline (the disagreement is
// recorded as `false`).
export function buildAuditRecord({
  runId,
  decision = {},
  baseline = null,
  provider = null,
  usage = null,
  latencyMs = null,
  criteria = null,
  generatedAt = null,
  decisionId = null,
  stateDigest = null,
  sessionId = null,
  index = 0,
} = {}) {
  if (!RUN_ID_PATTERN.test(runId ?? "")) throw new TypeError(`invalid runId: ${String(runId)}`);
  const resolvedStateDigest = stateDigest ?? decision.stateDigest ?? null;
  if (!STATE_DIGEST_PATTERN.test(resolvedStateDigest ?? ""))
    throw new TypeError(`invalid stateDigest: ${String(resolvedStateDigest)}`);
  const resolvedProvider = provider ?? decision.provider ?? DEFAULT_PROVIDER;
  const resolvedCriteria =
    criteria ?? (Array.isArray(decision.criteria) ? decision.criteria : DEFAULT_CRITERIA);
  const baselineAnswer = baseline === null ? null : (baseline.answer ?? baseline);
  const baselineAgreement =
    typeof decision.baselineAgreement === "boolean"
      ? decision.baselineAgreement
      : baseline === null
        ? false
        : answersAgree(decision.answer, baselineAnswer);
  const resolvedDecisionId =
    decisionId ?? decision.decisionId ?? deriveDecisionId(runId, decision.pointId ?? "", index);
  if (!DECISION_ID_PATTERN.test(resolvedDecisionId))
    throw new TypeError(`invalid decisionId: ${String(resolvedDecisionId)}`);
  return {
    schema: DECISION_ARTIFACT_SCHEMA,
    schemaRevision: DECISION_ARTIFACT_SCHEMA_REVISION,
    decisionId: resolvedDecisionId,
    pointId: String(decision.pointId ?? ""),
    runId,
    stateDigest: resolvedStateDigest,
    criteria: [...resolvedCriteria],
    answer: normalizeAnswer(decision.answer),
    confidence: decision.confidence ?? null,
    baselineAgreement,
    routingBand: decision.routingBand ?? "advisory",
    applied: decision.applied === true,
    provider: { id: resolvedProvider.id, model: resolvedProvider.model },
    usage: usage ?? decision.usage ?? {},
    latencyMs: latencyMs ?? decision.latencyMs ?? 0,
    provenance: {
      transport: decision.transport ?? DEFAULT_TRANSPORT,
      generatedAt: generatedAt ?? decision.generatedAt ?? new Date().toISOString(),
      ...((sessionId ?? decision.sessionId) ? { sessionId: sessionId ?? decision.sessionId } : {}),
    },
  };
}

let validatorPromise;
function decisionValidator() {
  validatorPromise ??= readFile(
    new URL("../../schemas/csm-decision.schema.json", import.meta.url),
    "utf8",
  )
    .then(parseJson)
    .then((schema) => createSchemaValidator({ schemas: [schema] }));
  return validatorPromise;
}

export async function validateDecisionRecord(record) {
  const validator = await decisionValidator();
  const result = validator.validate(DECISION_ARTIFACT_SCHEMA, record);
  return { valid: result.valid, errors: result.errors };
}

// The real (repo) indexer. The `scripts/lib` module is not part of the packed
// skill payload, so the specifier is assembled at runtime and the import is
// guarded: an unavailable index module fails open rather than breaking a write.
const AGENTS_INDEX_SPECIFIER = ["..", "..", "..", "scripts", "lib", "agents-index.mjs"].join("/");

export async function indexDecisionArtifactInReadme({
  relativePath,
  bullet,
  cwd = process.cwd(),
} = {}) {
  let insertAgentsIndexBullet;
  try {
    ({ insertAgentsIndexBullet } = await import(AGENTS_INDEX_SPECIFIER));
  } catch {
    return false;
  }
  const readmePath = join(cwd, ".agents", "README.md");
  let content;
  try {
    content = await readFile(readmePath, "utf8");
  } catch {
    return false;
  }
  const next = insertAgentsIndexBullet(content, relativePath, bullet);
  if (next === content) return false;
  await writeFile(readmePath, next);
  return true;
}

function artifactBullet({ fileName, runId, recordCount, now }) {
  const day = now.toISOString().slice(0, 10);
  const plural = recordCount === 1 ? "decision" : "decisions";
  return `- \`${fileName}\` — ${day} — decision artifact: ${recordCount} applied ${plural} for ${runId} (csm-decision/1 records, redacted)`;
}

// Writes ONE run artifact to `<outputDir>/<runId>.json` (default
// `.agents/decisions/`) and returns a summary. `records` may be full
// `csm-decision/1` records or raw decisions; only applied decisions are kept.
// `outputDir` is injectable for tests; `indexer` is injectable and only called
// when the write targets the real decisions dir (or `index` is forced).
export async function writeDecisionArtifact({
  runId,
  records = [],
  decisions = null,
  env = {},
  outputDir = DECISION_ARTIFACT_DIR,
  cwd = process.cwd(),
  indexer = indexDecisionArtifactInReadme,
  index = null,
  now = new Date(),
} = {}) {
  if (!RUN_ID_PATTERN.test(runId ?? "")) throw new TypeError(`invalid runId: ${String(runId)}`);
  const entries = decisions ?? records;
  if (!Array.isArray(entries)) throw new TypeError("records must be an array");

  const built = entries.map((entry, position) =>
    entry !== null && typeof entry === "object" && entry.schema === DECISION_ARTIFACT_SCHEMA
      ? { ...entry, runId: entry.runId ?? runId }
      : buildAuditRecord({
          runId,
          decision: entry ?? {},
          baseline: entry?.baseline ?? null,
          provider: entry?.provider ?? null,
          usage: entry?.usage ?? null,
          latencyMs: entry?.latencyMs ?? null,
          criteria: entry?.criteria ?? null,
          stateDigest: entry?.stateDigest ?? null,
          decisionId: entry?.decisionId ?? null,
          sessionId: entry?.sessionId ?? null,
          index: position,
          generatedAt: now.toISOString(),
        }),
  );
  const applied = built.filter((record) => record.applied === true);

  const redacted = redactDecisionArtifact(applied, { env });
  for (const [position, record] of redacted.entries()) {
    const { valid, errors } = await validateDecisionRecord(record);
    if (!valid)
      throw new TypeError(
        `invalid ${DECISION_ARTIFACT_SCHEMA} at index ${position}: ${errors
          .map((error) => error.instancePath || error.message)
          .join("; ")}`,
      );
  }
  const survivors = findCredentialShapes(redacted);
  if (survivors.length > 0)
    throw new Error("refusing to write artifact with credential-shaped data");

  const absoluteDir = isAbsolute(outputDir) ? outputDir : resolve(cwd, outputDir);
  const fileName = `${runId}.json`;
  const path = join(absoluteDir, fileName);
  await mkdir(absoluteDir, { recursive: true });
  await writeFile(path, `${JSON.stringify(redacted, null, 2)}\n`, { mode: 0o644 });

  const relativePath = `${DECISION_ARTIFACT_DIR}/${fileName}`;
  const realDir = resolve(cwd, DECISION_ARTIFACT_DIR);
  const shouldIndex = index ?? absoluteDir === realDir;
  let indexed = false;
  if (shouldIndex && typeof indexer === "function") {
    const bullet = artifactBullet({ fileName, runId, recordCount: redacted.length, now });
    indexed = Boolean(
      await indexer({ runId, relativePath, fileName, bullet, recordCount: redacted.length, cwd }),
    );
  }

  return Object.freeze({
    path,
    relativePath,
    runId,
    recordCount: redacted.length,
    appliedCount: applied.length,
    indexed,
    redacted: true,
  });
}

export default {
  DECISION_ARTIFACT_SCHEMA,
  DECISION_ARTIFACT_SCHEMA_REVISION,
  DECISION_ARTIFACT_DIR,
  CREDENTIAL_KEY_RE,
  isCredentialKey,
  redactDecisionArtifact,
  findCredentialShapes,
  answersAgree,
  buildAuditRecord,
  validateDecisionRecord,
  indexDecisionArtifactInReadme,
  writeDecisionArtifact,
};
