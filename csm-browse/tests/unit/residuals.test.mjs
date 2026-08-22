import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { freshSessionsRoot, removeRoot } from "./helpers/env.mjs";

const root = await freshSessionsRoot("csm-browse-residuals-");
const { redactTelemetry } = await import("../../lib/security.mjs");

after(async () => {
  await removeRoot(root);
});

// T003 residual (c): the browse error-print path must never leak the
// per-session token. browse.mjs routes err.message through redactTelemetry
// (the exported prose redaction entrypoint, which applies redactProse +
// redactPairs + redactUrl); these tests pin both the behavior on a
// fabricated URL-bearing error and the wrap at the print sites.
const SECRET = "SECRET_TOKEN_VALUE_123";

test("error-message redaction scrubs a tokenized wsUrl embedded in prose", () => {
  const message = `CDP connect failed: ws://127.0.0.1:9222/devtools/page/abc?token=${SECRET} (handshake timeout)`;
  const out = redactTelemetry(message);
  assert.ok(!out.includes(SECRET), `verbatim token leaked: ${out}`);
  assert.ok(out.includes("token=[REDACTED]"), `redaction marker missing: ${out}`);
  // Ordinary diagnostics around the URL survive.
  assert.ok(out.includes("CDP connect failed:") && out.includes("(handshake timeout)"), out);
});

test("error-message redaction scrubs a bare tokenized wsUrl", () => {
  const out = redactTelemetry(`ws://127.0.0.1:9222/devtools/page/abc?token=${SECRET}`);
  assert.ok(!out.includes(SECRET), `verbatim token leaked: ${out}`);
  assert.ok(/token=(\[REDACTED\]|%5BREDACTED%5D)/.test(out), `redaction marker missing: ${out}`);
});

test("browse.mjs prints every err.message through redactTelemetry", async () => {
  const source = await readFile(
    fileURLToPath(new URL("../../scripts/browse.mjs", import.meta.url)),
    "utf-8",
  );
  assert.ok(
    source.includes("console.error(redactTelemetry(err.message));"),
    "the verb-run catch must print redactTelemetry(err.message)",
  );
  assert.ok(
    !/\bconsole\.error\((?:`[^`]*\$\{)?err\.message/.test(source),
    "no console.error may interpolate a raw err.message",
  );
  assert.ok(
    /import \{ redactTelemetry \} from ["']\.\.\/lib\/security\.mjs["'];/.test(source),
    "redactTelemetry must be imported",
  );
});
