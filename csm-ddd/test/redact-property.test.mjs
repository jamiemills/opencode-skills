"use strict";

import assert from "node:assert/strict";
import { test } from "node:test";
import { redactText } from "../lib/ddd/redact.mjs";

// F6-07: seeded redaction property suite over redactText. Each iteration
// generates 1-3 fresh secrets from the vocabularies redactText actually
// covers (sk-/ghp_/gho_/AKIA/xox* service tokens, emails, absolute paths,
// SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY assignments) and plants them in
// carrier prose/lines. Property: no planted substring survives redactText.
// Deterministic: a fixed seed reproduces the exact input sequence.
//
// Mulberry32 PRNG — seeded, deterministic, dependency-free.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo));
}

function pick(rng, arr) {
  return arr[randInt(rng, 0, arr.length)];
}

const REDACT_SEED = 0xf4e09;
const ITERATIONS = 200;
const ASSIGN_KEYS = [
  "SECRET_TOKEN",
  "MY_API_KEY",
  "PASSWORD",
  "DB_PASSWORD",
  "SERVICE_TOKEN",
  "PRIVATE_KEY_PATH",
  "TOKEN_CONFIG",
  "X_SECRET",
];

function alnum(rng, len, alphabet) {
  let s = "";
  for (let k = 0; k < len; k++) s += alphabet[randInt(rng, 0, alphabet.length)];
  return s;
}

function hex(rng, len) {
  return alnum(rng, len, "0123456789abcdef");
}

// Generators produce tokens that EXACTLY satisfy the corresponding
// redactText vocabulary regex, so the property asserts coverage, not luck.
const CLASSES = {
  sk: (rng) =>
    `sk-${alnum(rng, randInt(rng, 16, 25), "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")}`,
  ghp: (rng) =>
    `ghp_${alnum(rng, randInt(rng, 20, 29), "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")}`,
  gho: (rng) =>
    `gho_${alnum(rng, randInt(rng, 20, 29), "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")}`,
  akia: (rng) => `AKIA${alnum(rng, randInt(rng, 16, 21), "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ")}`,
  xox: (rng) =>
    `${pick(rng, ["xoxb", "xoxa", "xoxp", "xoxr", "xoxs"])}-${alnum(rng, randInt(rng, 10, 21), "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-")}`,
  email: (rng) => `pleak${hex(rng, 6)}@example.test`,
  path: (rng) => `/home/dev/${hex(rng, 8)}/file-${hex(rng, 6)}.mjs`,
  assign: (rng) => `${pick(rng, ASSIGN_KEYS)}=pleak-${hex(rng, 10)}-value`,
};

test("property: planted secrets never survive redactText across shapes and carriers", () => {
  console.log(`[redact-property] seed=0x${REDACT_SEED.toString(16)} iterations=${ITERATIONS}`);
  const rng = mulberry32(REDACT_SEED);
  for (let i = 0; i < ITERATIONS; i++) {
    const count = randInt(rng, 1, 4);
    const planted = [];
    const lines = [];
    for (let k = 0; k < count; k++) {
      const cls = pick(rng, Object.keys(CLASSES));
      const token = CLASSES[cls](rng);
      planted.push(token);
      if (cls === "assign") {
        // ASSIGN_SECRET_RE is line-anchored (/^...$/m): assignments keep the
        // line start (leading whitespace is allowed by the vocabulary).
        lines.push(`${pick(rng, ["", "  "])}${token}${pick(rng, ["", " # note"])}`);
      } else {
        lines.push(
          `${pick(rng, ["", "deploy note: ", "see "])}${token}${pick(rng, ["", " end", " tail", ";"])}`,
        );
      }
    }
    const text = lines.join("\n");
    const out = redactText(text);
    for (const token of planted) {
      assert.ok(
        !out.includes(token),
        `planted secret survived redactText (iter ${i}): ${JSON.stringify({
          token,
          text,
          out,
        })}`,
      );
    }
  }
});

test("webhook-path tokens are redacted without broad URL redaction", () => {
  const webhook = "https://hooks.example.com/services/TXXX/BYYY/longtoken";
  assert.equal(redactText(webhook), "<redacted-secret>");
  assert.equal(redactText(`notify ${webhook} now`), "notify <redacted-secret> now");
  assert.equal(
    redactText("https://example.com/services/TXXX/BYYY/longtoken"),
    "https://example.com/services/TXXX/BYYY/longtoken",
  );
});
