import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { dirname } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// T001 inventory contract: docs/config-inventory.md must exist, name all 14
// skills, carry the eight required sections per skill, and contain no secret
// values from the gitignored root .env (values are loaded at runtime only —
// they are never written into this file).

const REPO = path.resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOC = path.join(REPO, "docs", "config-inventory.md");

const SKILLS = [
  "csm-autoresearch",
  "csm-bdd-tdd",
  "csm-browse",
  "csm-build",
  "csm-ddd",
  "csm-deep-research",
  "csm-grill",
  "csm-make-tests",
  "csm-orchestrate",
  "csm-plan",
  "csm-review",
  "csm-review-python",
  "csm-scan",
  "csm-upload",
];

const REQUIRED_SECTIONS = [
  "Defaults and magic values",
  "CLI flags and options",
  "Environment variables",
  "Output paths and artifacts",
  "Side effects",
  "Classification",
  "Existing config mechanisms",
  "Adapter seam",
];

function skillSections(content) {
  const sections = new Map();
  let current = null;
  let body = [];
  for (const line of content.split("\n")) {
    const h2 = /^## (.+)$/.exec(line);
    if (h2) {
      if (current) sections.set(current, body.join("\n"));
      current = h2[1].trim();
      body = [];
    } else if (current) {
      body.push(line);
    }
  }
  if (current) sections.set(current, body.join("\n"));
  return sections;
}

function subsectionTitles(body) {
  const titles = [];
  for (const line of body.split("\n")) {
    const h3 = /^### (.+)$/.exec(line);
    if (h3) titles.push(h3[1].trim());
  }
  return titles;
}

test("inventory document exists and is non-empty", () => {
  assert.ok(fs.existsSync(DOC), `missing ${DOC}`);
  const stat = fs.statSync(DOC);
  assert.ok(stat.size > 1000, `inventory document is suspiciously small (${stat.size} bytes)`);
});

test("inventory names all 14 skills as sections", () => {
  const content = fs.readFileSync(DOC, "utf8");
  const sections = skillSections(content);
  for (const skill of SKILLS) {
    assert.ok(
      sections.has(skill),
      `inventory must have a '## ${skill}' section (found: ${[...sections.keys()].join(", ")})`,
    );
  }
});

test("every skill section has all required subsections", () => {
  const content = fs.readFileSync(DOC, "utf8");
  const sections = skillSections(content);
  for (const skill of SKILLS) {
    const titles = subsectionTitles(sections.get(skill) ?? "");
    for (const required of REQUIRED_SECTIONS) {
      assert.ok(
        titles.includes(required),
        `section '## ${skill}' is missing '### ${required}' (has: ${titles.join(", ")})`,
      );
    }
  }
});

test("inventory contains no values from the root .env", () => {
  const envPath = path.join(REPO, ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(DOC, "utf8");
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const parsed = /^([A-Za-z0-9_.-]+)=(.*)$/.exec(line.trim());
    if (!parsed) continue;
    const value = parsed[2].trim();
    if (value.length < 8) continue;
    assert.ok(
      !content.includes(value),
      `inventory leaks a .env value for '${parsed[1]}' (matched ${value.length} chars)`,
    );
  }
});
