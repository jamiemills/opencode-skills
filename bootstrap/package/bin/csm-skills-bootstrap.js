#!/usr/bin/env node
"use strict";

import { createHash, createPublicKey, verify } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.1.0";
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const USAGE =
  "usage: csm-skills-bootstrap --version | payload-index | verify <envelope.json> | --help";

// F-045: the envelope trust keyring ships embedded in this fixed bin. A
// canonical-equality test (tests/bootstrap-trust.test.mjs) pins it to
// bootstrap/keyring.json so the shipped trust root cannot drift.
const KEYRING_JSON = `{"schema":"csm-bootstrap-keyring/1","environment":"test-fixture-only","production_use":false,"keys":[{"id":"fixture-2026","algorithm":"Ed25519","public_key_der_base64":"MCowBQYDK2VwAyEATcWR27WU2b6rIfJuqGlgPt89KHz5OX6tSibHg8wn/48=","fingerprint":"b37f525affc870505af1b92034ab44837d06372b6bea27cc24aed14d09d40209","not_before":"2026-01-01T00:00:00.000Z","not_after":"2030-12-31T23:59:59.000Z","revoked":false},{"id":"revoked-fixture","algorithm":"Ed25519","public_key_der_base64":"MCowBQYDK2VwAyEATcWR27WU2b6rIfJuqGlgPt89KHz5OX6tSibHg8wn/48=","fingerprint":"b37f525affc870505af1b92034ab44837d06372b6bea27cc24aed14d09d40209","not_before":"2026-01-01T00:00:00.000Z","not_after":"2030-12-31T23:59:59.000Z","revoked":true,"revoked_at":"2026-02-01T00:00:00.000Z"}]}`;

const isSafePath = (value) =>
  typeof value === "string" &&
  value !== "" &&
  !value.startsWith("/") &&
  !value.includes("\\") &&
  !value.split("/").some((part) => part === "" || part === "." || part === "..");

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

const SHELL_DENYLIST =
  /\b(npx|npm|node|nodejs|bash|sh|python|python3|pip|pip3|git|curl|wget|sudo|rm|powershell|eval|exec|chmod|chown|docker|uvx|bunx|deno)\b/i;
const FIXED_PACKAGE_POLICY = {
  name: "@jamiemills/csm-skills-bootstrap",
  version: "0.1.0",
  bin: "csm-skills-bootstrap",
  registry: "https://registry.npmjs.org",
};
const ENVELOPE_AUDIENCE = "agent-skills";

const canonicalJson = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
};
const policyToSign = (envelope) => ({
  schema: envelope.schema,
  audience: envelope.audience,
  expires_at: envelope.expires_at,
  key: envelope.key,
  policy: envelope.policy,
  steps_sha256: envelope.steps_sha256,
  ...(Object.prototype.hasOwnProperty.call(envelope, "payload_index_sha256")
    ? { payload_index_sha256: envelope.payload_index_sha256 }
    : {}),
});
const checkFixedPackagePolicy = (pkg) =>
  pkg?.name === FIXED_PACKAGE_POLICY.name &&
  pkg?.version === FIXED_PACKAGE_POLICY.version &&
  pkg?.bin === FIXED_PACKAGE_POLICY.bin &&
  pkg?.registry === FIXED_PACKAGE_POLICY.registry;
const checkStepsShellPolicy = (steps) =>
  steps.includes("`") || steps.includes("~~~") || SHELL_DENYLIST.test(steps);
const reject = (code, message) => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

const INDEX_CLASSES = ["skills", "supportingFiles", "helperBins", "metadata"];
const isIndexEntry = (entry) =>
  entry !== null &&
  typeof entry === "object" &&
  !Array.isArray(entry) &&
  isSafePath(entry.path) &&
  typeof entry.sha256 === "string" &&
  /^[a-f0-9]{64}$/.test(entry.sha256) &&
  Number.isInteger(entry.bytes) &&
  entry.bytes >= 0 &&
  typeof entry.mode === "string" &&
  /^[0-7]{3,4}$/.test(entry.mode) &&
  Number.parseInt(entry.mode, 8) <= 0o777;

function validatePayloadIndex(index) {
  if (!index || typeof index !== "object" || Array.isArray(index))
    reject("INDEX_SCHEMA", "payload index must be an object");
  if (index.schema !== "csm-payload-index/1")
    reject("INDEX_SCHEMA", "payload index schema mismatch");
  if (!index.classes || typeof index.classes !== "object" || Array.isArray(index.classes))
    reject("INDEX_SCHEMA", "payload index classes must be an object");
  const entries = [];
  const failures = [];
  for (const className of INDEX_CLASSES) {
    if (!Array.isArray(index.classes[className]))
      reject("INDEX_SCHEMA", `payload index class ${className} is malformed`);
    for (const entry of index.classes[className]) {
      if (!isIndexEntry(entry)) {
        failures.push({ path: entry?.path || null, error: "INVALID_ENTRY" });
        continue;
      }
      entries.push(entry);
    }
  }
  if (!isIndexEntry(index.fixedBin)) failures.push({ path: null, error: "INVALID_ENTRY" });
  else entries.push(index.fixedBin);
  const paths = new Set();
  for (const entry of entries) {
    if (paths.has(entry.path)) {
      failures.push({ path: entry.path, error: "DUPLICATE_ENTRY" });
      continue;
    }
    paths.add(entry.path);
  }
  return { entries, failures };
}

// F-045/F-046: dependency-free envelope validator. Signature, keyring, expiry,
// audience, steps digest, and payload_index_sha256 binding are all verified
// when the signature is present (fail-closed on malformed); an envelope with no
// signature field is the documented no-signature local flow and passes without
// crypto verification (hard-requiring the signature is publication-gated).
function validateEnvelope(envelope, keyring, { now = new Date(), indexSha256 } = {}) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope))
    reject("SCHEMA", "envelope must be an object");
  if (envelope.schema !== "csm-bootstrap/2") reject("SCHEMA", "unsupported schema");
  const allowed = [
    "audience",
    "expires_at",
    "key",
    "payload_index_sha256",
    "policy",
    "schema",
    "signature",
    "steps_markdown",
    "steps_sha256",
  ];
  const required = [
    "audience",
    "expires_at",
    "key",
    "policy",
    "schema",
    "steps_markdown",
    "steps_sha256",
    "payload_index_sha256",
  ];
  for (const field of required)
    if (!Object.prototype.hasOwnProperty.call(envelope, field))
      reject("SCHEMA", `missing field ${field}`);
  for (const field of Object.keys(envelope))
    if (!allowed.includes(field))
      reject("UNEXPECTED_FIELD", `unsigned field ${field} is not allowed`);
  // F-010: limits validation mirrors tests/protocol/trust-policy.mjs exactly
  // so the shipped gate and the tested engine cannot drift apart. A
  // canonical-equality protocol test pins this parity.
  const limits = envelope.policy?.limits;
  if (!limits || typeof limits !== "object") reject("SCHEMA", "limits missing");
  const HARDWIRE_CAP = 1024 * 1024;
  if (
    !Number.isInteger(limits.max_bytes) ||
    limits.max_bytes < 1 ||
    limits.max_bytes > HARDWIRE_CAP
  )
    reject("SCHEMA", "max_bytes out of bounds");
  if (
    !Number.isInteger(limits.max_redirects) ||
    limits.max_redirects < 0 ||
    limits.max_redirects > 3
  )
    reject("SCHEMA", "max_redirects out of bounds");
  if (typeof limits.allowed_origin !== "string") {
    reject("SCHEMA", "allowed_origin missing");
  } else {
    let allowedOrigin;
    try {
      allowedOrigin = new URL(limits.allowed_origin);
    } catch {
      reject("SCHEMA", "allowed_origin is not a URL");
    }
    if (
      allowedOrigin &&
      (allowedOrigin.protocol !== "https:" ||
        allowedOrigin.username !== "" ||
        allowedOrigin.password !== "" ||
        allowedOrigin.search !== "" ||
        allowedOrigin.hash !== "")
    )
      reject("SCHEMA", "allowed_origin must be a bare https URL");
  }
  if (
    typeof envelope.payload_index_sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(envelope.payload_index_sha256)
  ) {
    reject("SCHEMA", "payload_index_sha256 must be a sha256 hex digest");
  }
  if (envelope.audience !== ENVELOPE_AUDIENCE) reject("WRONG_AUDIENCE", "audience mismatch");
  if (!Number.isFinite(Date.parse(envelope.expires_at)) || Date.parse(envelope.expires_at) <= now)
    reject("EXPIRED", "envelope expired");
  const key = keyring?.keys?.find((candidate) => candidate.id === envelope.key?.id);
  if (!key) reject("UNKNOWN_KEY", "key is not trusted");
  if (key.revoked) reject("REVOKED_KEY", "key is revoked");
  if (key.algorithm !== "Ed25519" || envelope.key.algorithm !== "Ed25519")
    reject("ALGORITHM", "algorithm is not supported");
  if (
    key.fingerprint !== envelope.key.fingerprint ||
    sha256(Buffer.from(key.public_key_der_base64, "base64")) !== key.fingerprint
  )
    reject("FINGERPRINT", "fingerprint mismatch");
  if (Date.parse(key.not_before) > now || Date.parse(key.not_after) <= now)
    reject("KEY_EXPIRED", "key is outside validity");
  if (typeof envelope.steps_markdown !== "string" || envelope.steps_markdown.length > 4096)
    reject("SCHEMA", "steps_markdown out of bounds");
  if (checkStepsShellPolicy(envelope.steps_markdown))
    reject("SHELL_POLICY", "steps contain shell-like advisory text");
  if (sha256(envelope.steps_markdown) !== envelope.steps_sha256)
    reject("STEPS_DIGEST", "steps digest mismatch");
  if (!checkFixedPackagePolicy(envelope.policy?.package))
    reject("PACKAGE_POLICY", "package policy is not fixed");
  if (indexSha256 !== undefined && indexSha256 !== envelope.payload_index_sha256) {
    reject("PAYLOAD_INDEX_MISMATCH", "payload index digest mismatch");
  }
  const hasSignature = Object.prototype.hasOwnProperty.call(envelope, "signature");
  if (
    hasSignature &&
    (envelope.signature === null ||
      typeof envelope.signature !== "object" ||
      Array.isArray(envelope.signature))
  )
    reject("UNSIGNED", "signature is malformed");
  const requireSignature = process.env.CSM_BOOTSTRAP_REQUIRE_SIGNATURE === "1";
  if (requireSignature && !hasSignature)
    reject("SIGNATURE_REQUIRED", "signature is required when CSM_BOOTSTRAP_REQUIRE_SIGNATURE=1");
  if (hasSignature && envelope.signature !== null) {
    if (
      envelope.signature.algorithm !== "Ed25519" ||
      typeof envelope.signature.value !== "string" ||
      envelope.signature.value === ""
    )
      reject("UNSIGNED", "signature is missing");
    const publicKey = createPublicKey({
      key: Buffer.from(key.public_key_der_base64, "base64"),
      format: "der",
      type: "spki",
    });
    if (
      !verify(
        null,
        Buffer.from(canonicalJson(policyToSign(envelope))),
        publicKey,
        Buffer.from(envelope.signature.value, "base64"),
      )
    )
      reject("BAD_SIGNATURE", "signature verification failed");
  }
  return { trusted: true, key: key.id };
}

async function verifyPayload() {
  let index;
  try {
    index = JSON.parse(await readFile(join(packageRoot, "payload-index.json"), "utf8"));
  } catch {
    reject("INDEX_SCHEMA", "payload index is missing or malformed JSON");
  }
  const { entries, failures } = validatePayloadIndex(index);
  for (const entry of entries) {
    if (
      !entry ||
      !isSafePath(entry.path) ||
      typeof entry.sha256 !== "string" ||
      !Number.isInteger(entry.bytes) ||
      entry.bytes < 0 ||
      !/^[0-7]{3,4}$/.test(entry.mode)
    ) {
      failures.push({ path: entry && entry.path ? entry.path : null, error: "INVALID_ENTRY" });
      continue;
    }
    let data;
    try {
      data = await readFile(join(packageRoot, entry.path));
    } catch {
      failures.push({ path: entry.path, error: "MISSING_FILE" });
      continue;
    }
    let info;
    try {
      info = await lstat(join(packageRoot, entry.path));
    } catch {
      failures.push({ path: entry.path, error: "MISSING_FILE" });
      continue;
    }
    const actualModeValue = info.mode & 0o777;
    const actualMode = actualModeValue.toString(8).padStart(4, "0");
    if (!info.isFile() || actualMode !== entry.mode) {
      failures.push({ path: entry.path, error: "MODE_MISMATCH" });
      continue;
    }
    if (data.length !== entry.bytes) {
      failures.push({ path: entry.path, error: "SIZE_MISMATCH" });
      continue;
    }
    if (sha256(data) !== entry.sha256) failures.push({ path: entry.path, error: "HASH_MISMATCH" });
  }
  return { index, verified: entries.length, failures };
}

async function verifyEnvelope(envelopePath) {
  if (!envelopePath)
    throw Object.assign(new Error("verify requires an envelope JSON path"), { code: "USAGE" });
  const envelope = JSON.parse(await readFile(resolve(envelopePath), "utf8"));
  let indexSha256;
  try {
    indexSha256 = sha256(await readFile(join(packageRoot, "payload-index.json"), "utf8"));
  } catch {
    throw Object.assign(new Error("payload-index.json is missing from the package"), {
      code: "MISSING_PAYLOAD_INDEX",
    });
  }
  const trusted = validateEnvelope(envelope, JSON.parse(KEYRING_JSON), {
    now: new Date(),
    indexSha256,
  });
  // F4-01: `signed` is true only when the envelope carried a signature and
  // Ed25519 verification ran and passed (validateEnvelope returns only after
  // every check passed); all failure paths report signed:false.
  const signed =
    Object.prototype.hasOwnProperty.call(envelope, "signature") && envelope.signature !== null;
  return {
    verification: { ok: true, key: trusted.key, payload_index_sha256: indexSha256, signed },
  };
}

const arg = process.argv[2];
if (arg === "--version") {
  process.stdout.write(`${VERSION}\n`);
} else if (arg === "payload-index") {
  try {
    const { index, verified, failures } = await verifyPayload();
    process.stdout.write(
      `${JSON.stringify(
        { index, verification: { ok: failures.length === 0, verified, failures, signed: false } },
        null,
        2,
      )}\n`,
    );
    process.exitCode = failures.length === 0 ? 0 : 1;
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify(
        {
          verification: {
            ok: false,
            verified: 0,
            failures: [],
            signed: false,
            code: error.code || "MALFORMED",
            error: error.message,
          },
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 1;
  }
} else if (arg === "verify") {
  let result;
  try {
    result = await verifyEnvelope(process.argv[3]);
  } catch (error) {
    result = {
      verification: {
        ok: false,
        signed: false,
        code: error.code || "MALFORMED",
        error: error.message,
      },
    };
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.verification.ok ? 0 : 1;
} else if (arg === "--help") {
  process.stdout.write(`${USAGE}\n`);
} else {
  process.stderr.write(`${USAGE}\nunknown argument: ${arg === undefined ? "(none)" : arg}\n`);
  process.exitCode = 1;
}
