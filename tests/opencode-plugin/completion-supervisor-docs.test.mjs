// T004: contract test for the completion-supervisor runbook. Proves the
// operator doc exists and documents each required section, the continuation
// environment switches, the exact install/rollback commands, and the explicit
// unverified warning about the re-entry mechanism.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const docPath = path.join(import.meta.dirname, "..", "..", "docs", "completion-supervisor.md");

const REQUIRED_SECTIONS = [
  "## Overview",
  "## Opt-in",
  "## Kill switches",
  "## Budget and no-progress stop",
  "## Mandatory pilot",
  "## Success criteria",
  "## Rollback",
];

const REQUIRED_ENV_VARS = [
  "CSM_CONTINUE_KILL",
  "CSM_CONTINUE_MODE",
  "CSM_CONTINUE_MAX",
  "CSM_CONTINUE_RECORD",
];

const ROLLBACK_COMMAND =
  "rm ~/.config/opencode/plugins/csm-continue.js ~/.config/opencode/plugins/csm-continue-core.mjs";

function readDoc() {
  assert.ok(existsSync(docPath), `missing doc: ${docPath}`);
  return readFileSync(docPath, "utf8");
}

test("the completion-supervisor runbook exists", () => {
  assert.ok(existsSync(docPath), `missing doc: ${docPath}`);
});

test("every required section marker is present", () => {
  const doc = readDoc();
  for (const marker of REQUIRED_SECTIONS) {
    assert.ok(doc.includes(marker), `missing section marker: ${marker}`);
  }
});

test("all continuation environment switches are documented", () => {
  const doc = readDoc();
  for (const name of REQUIRED_ENV_VARS) {
    assert.ok(doc.includes(name), `missing env var: ${name}`);
  }
});

test("the supervisor is documented as OFF by default", () => {
  const doc = readDoc();
  assert.match(doc, /OFF by default/);
});

test("the exact opt-in install command with --apply is documented", () => {
  const doc = readDoc();
  assert.ok(
    doc.includes("node scripts/install-opencode-plugin.mjs --apply"),
    "missing exact install --apply command",
  );
});

test("the rollback command deletes both installed plugin files", () => {
  const doc = readDoc();
  assert.ok(doc.includes(ROLLBACK_COMMAND), "missing exact rollback command");
});

test("the pilot defines a NO-GO threshold on stops-per-run", () => {
  const doc = readDoc();
  assert.match(doc, /stops-per-run/);
  assert.match(doc, /NO-GO/);
});

test("the re-entry mechanism is explicitly marked UNVERIFIED", () => {
  const doc = readDoc();
  assert.match(doc, /UNVERIFIED/);
  assert.match(doc, /session\.idle/);
  assert.match(doc, /client\.session\.prompt/);
});
