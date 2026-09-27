import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { redactText } from "../csm-ddd/lib/ddd/redact.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("csm-ddd's vendored token-families stays byte-identical to csm-scan's", () => {
  const vendored = readFileSync(resolve(ROOT, "csm-ddd/lib/ddd/token-families.mjs"));
  const source = readFileSync(resolve(ROOT, "csm-scan/lib/scan/shared/token-families.mjs"));
  assert.ok(
    vendored.equals(source),
    "the vendored copy drifted from csm-scan's token families — re-copy and re-verify",
  );
});

test("the csm-ddd redactor redacts a token-family-only JWT", () => {
  const jwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
  const out = redactText(`authorization: ${jwt}`);
  assert.ok(!out.includes(jwt), "the JWT must be redacted by the vendored families");
});
