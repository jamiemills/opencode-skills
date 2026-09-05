import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const keyringPath = join(root, "bootstrap", "keyring.json");

// F-044: single shared source for the shell denylist and fixed package policy.
// Consumed by tests/protocol/engine.mjs, tests/bootstrap-trust.test.mjs, and
// tests/offline/commands.mjs so the trust boundary cannot drift between copies.
export const SHELL_DENYLIST =
  /\b(npx|npm|node|nodejs|bash|sh|python|python3|pip|pip3|git|curl|wget|sudo|rm|powershell|eval|exec|chmod|chown|docker|uvx|bunx|deno)\b/i;

export const FIXED_PACKAGE_POLICY = Object.freeze({
  name: "@jamiemills/csm-skills-bootstrap",
  version: "0.1.0",
  bin: "csm-skills-bootstrap",
  registry: "https://registry.npmjs.org",
});

export const ENVELOPE_SCHEMA = "csm-bootstrap/2";
export const ENVELOPE_AUDIENCE = "agent-skills";
export const HARDWIRE_CAP = 1048576;

// F-046: payload_index_sha256 is part of the signed policy when present so the
// signature binds payload-index.json bytes, not just the package identity.
export const ALLOWED_ENVELOPE_KEYS = [
  "audience",
  "expires_at",
  "key",
  "payload_index_sha256",
  "policy",
  "schema",
  "signature",
  "steps_markdown",
  "steps_sha256",
  "payload_index_sha256",
];
export const REQUIRED_ENVELOPE_KEYS = [
  "audience",
  "expires_at",
  "key",
  "policy",
  "schema",
  "steps_markdown",
  "steps_sha256",
];

const reject = (code, message) => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

export const canonicalJson = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
};

export const digest = (value) => createHash("sha256").update(value).digest("hex");

export const payloadIndexSha256 = (envelope) =>
  Object.prototype.hasOwnProperty.call(envelope, "payload_index_sha256")
    ? { payload_index_sha256: envelope.payload_index_sha256 }
    : {};

export const policyToSign = (envelope) => ({
  schema: envelope.schema,
  audience: envelope.audience,
  expires_at: envelope.expires_at,
  key: envelope.key,
  policy: envelope.policy,
  steps_sha256: envelope.steps_sha256,
  ...payloadIndexSha256(envelope),
});

export const checkFixedPackagePolicy = (pkg) =>
  pkg?.name === FIXED_PACKAGE_POLICY.name &&
  pkg?.version === FIXED_PACKAGE_POLICY.version &&
  pkg?.bin === FIXED_PACKAGE_POLICY.bin &&
  pkg?.registry === FIXED_PACKAGE_POLICY.registry;

export const checkStepsShellPolicy = (steps) =>
  steps.includes("`") || steps.includes("~~~") || SHELL_DENYLIST.test(steps);

export function validateEnvelopeShape(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope))
    reject("SCHEMA", "envelope must be an object");
  if (envelope.schema !== ENVELOPE_SCHEMA) reject("SCHEMA", "unsupported schema");
  for (const required of REQUIRED_ENVELOPE_KEYS)
    if (!Object.prototype.hasOwnProperty.call(envelope, required))
      reject("SCHEMA", `missing field ${required}`);
  for (const present of Object.keys(envelope))
    if (!ALLOWED_ENVELOPE_KEYS.includes(present))
      reject("UNEXPECTED_FIELD", `unsigned field ${present} is not allowed`);
  if (
    typeof envelope.payload_index_sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(envelope.payload_index_sha256)
  ) {
    reject("SCHEMA", "payload_index_sha256 must be a sha256 hex digest");
  }
  const limits = envelope.policy?.limits;
  if (!limits || typeof limits !== "object") reject("SCHEMA", "limits missing");
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
  if (typeof limits.allowed_origin !== "string") reject("SCHEMA", "allowed_origin missing");
}

// F-045/F-049: signature, keyring, expiry, audience, steps digest, and
// payload_index_sha256 binding are all verified WHEN the signature is present
// (fail-closed on malformed). An envelope with no signature field at all is the
// documented no-signature local flow and keeps working; hard-requiring the
// signature is publication-gated (deferred T009).
export function validateEnvelope(
  envelope,
  keyring,
  {
    origin,
    bytes = Buffer.byteLength(JSON.stringify(envelope)),
    now = new Date(),
    indexSha256,
  } = {},
) {
  validateEnvelopeShape(envelope);
  const limits = envelope.policy.limits;
  let allowedOrigin;
  try {
    allowedOrigin = new URL(limits.allowed_origin);
  } catch {
    reject("SCHEMA", "allowed_origin is not a URL");
  }
  if (allowedOrigin.protocol !== "https:") reject("SCHEMA", "allowed_origin must be https");
  if (bytes > limits.max_bytes) reject("CONTENT_TOO_LARGE", "response exceeds limit");
  if (envelope.audience !== ENVELOPE_AUDIENCE) reject("WRONG_AUDIENCE", "audience mismatch");
  if (!Number.isFinite(Date.parse(envelope.expires_at)) || Date.parse(envelope.expires_at) <= now)
    reject("EXPIRED", "envelope expired");
  if (origin) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      reject("ORIGIN", "origin is not a URL");
    }
    if (
      parsed.protocol !== allowedOrigin.protocol ||
      parsed.hostname !== allowedOrigin.hostname ||
      parsed.port !== allowedOrigin.port ||
      parsed.pathname !== allowedOrigin.pathname ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    )
      reject("ORIGIN", "origin is not allowed");
  }
  const key = keyring?.keys?.find((candidate) => candidate.id === envelope.key?.id);
  if (!key) reject("UNKNOWN_KEY", "key is not trusted");
  if (key.revoked) reject("REVOKED_KEY", "key is revoked");
  if (key.algorithm !== "Ed25519" || envelope.key.algorithm !== "Ed25519")
    reject("ALGORITHM", "algorithm is not supported");
  if (
    key.fingerprint !== envelope.key.fingerprint ||
    digest(Buffer.from(key.public_key_der_base64, "base64")) !== key.fingerprint
  )
    reject("FINGERPRINT", "fingerprint mismatch");
  if (Date.parse(key.not_before) > now || Date.parse(key.not_after) <= now)
    reject("KEY_EXPIRED", "key is outside validity");
  if (typeof envelope.steps_markdown !== "string" || envelope.steps_markdown.length > 4096)
    reject("SCHEMA", "steps_markdown out of bounds");
  if (checkStepsShellPolicy(envelope.steps_markdown))
    reject("SHELL_POLICY", "steps contain shell-like advisory text");
  if (digest(envelope.steps_markdown) !== envelope.steps_sha256)
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
  return { trusted: true, steps: "guidance-only", key: key.id };
}

export async function loadKeyring() {
  return JSON.parse(await readFile(keyringPath, "utf8"));
}
