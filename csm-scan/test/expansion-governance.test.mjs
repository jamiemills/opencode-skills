// T215 Governance & Ownership dimension — focused test suite.
//
// Covers the CODEOWNERS parser (supported subset, last-match precedence,
// malformed patterns), the deterministic privacy-safe model, path
// classification, ADR metadata and explicit-link extraction, the T210 provider,
// the inert renderer, and the end-to-end scanner against plain fixtures and
// real Git repositories. Includes privacy canaries (opaque identities),
// aggregate counts, dates-without-verdicts, caps, no-inference, and
// malformed-peer independence.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  GOVERNANCE_CATEGORIES,
  GOVERNANCE_DIMENSION_ID,
  GOVERNANCE_LIMITS,
  GOVERNANCE_STATUSES,
  GovernanceModelError,
  buildGovernanceModel,
  classifyGovernancePath,
  encodeMatchedKey,
  extractMarkdownLinks,
  parseAdrMetadata,
} from "../lib/scan/deep/governance/model.mjs";
import {
  CODEOWNERS_DIALECT,
  defaultOwners,
  isOwnerToken,
  parseCodeowners,
  patternMatches,
  resolveOwners,
} from "../lib/scan/deep/governance/codeowners.mjs";
import { scan } from "../lib/scan/deep/governance/scanner.mjs";
import {
  GOVERNANCE_PROVIDER_ID,
  governanceObservations,
  governanceProviderResult,
} from "../lib/scan/providers/governance.mjs";
import { createGovernanceRenderer, renderGovernance } from "../lib/scan/render/governance.mjs";
import { EXISTING_TEN_RENDERER_MAP } from "../lib/scan/render/existing-ten.mjs";
import { PROVIDER_CATEGORIES } from "../lib/scan/contracts/provider.mjs";
import { createCommandBroker } from "../lib/scan/shared/command.mjs";
import { createRecordingRunner } from "./helpers/recording-runner.mjs";
import { withFixture } from "./harness.mjs";
import { makeGitRepo, cleanupGitRepo } from "./helpers/git-fixture.mjs";

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const LIB_ROOT = join(TEST_ROOT, "..", "lib");

const SEARCH_OK = Object.freeze({
  supported: true,
  readable: true,
  complete: true,
  capped: false,
  error: false,
  malformed: false,
  ambiguous: false,
  filesInspected: 3,
  fileLimit: 100,
  bytesInspected: 300,
  byteLimit: 10_000,
  recordsInspected: 5,
  recordLimit: 1_000,
  omittedCount: 0,
});

const BANNED_VOICE = Object.freeze([
  "should",
  "must",
  "ought",
  "shall",
  "poor",
  "good",
  "bad",
  "weak",
  "strong",
  "better",
  "worse",
  "best",
  "worst",
  "recommended",
  "recommendation",
  "ideally",
  "unfortunately",
  "concern",
  "concerning",
  "problem",
  "anti-pattern",
  "smell",
  "suboptimal",
  "inadequate",
  "insufficient",
  "contradiction",
  "inconsistent",
  "inconsistency",
  "conflict",
  "lacking",
]);

function findVoiceHits(markdown) {
  const pattern = new RegExp(`\\b(?:${BANNED_VOICE.join("|")})\\b`, "gi");
  const prose = markdown.replace(/`[^`\n]*`/g, (match) => " ".repeat(match.length));
  return [...prose.matchAll(pattern)].map((match) => match[0].toLowerCase());
}

function inertGitBroker() {
  return createCommandBroker({
    runner: createRecordingRunner(() => ({ status: 128, stdout: "", stderr: "" })),
  });
}

function modelOf(artifacts, ownership = [], extra = {}) {
  return buildGovernanceModel({
    artifacts,
    ownership,
    searchSpace: SEARCH_OK,
    ...extra,
  });
}

function policyArtifact(path, kind = "governance") {
  return {
    category: "policy",
    dialect: kind,
    path,
    line: null,
    status: "observed",
    details: { kind },
  };
}

// ---------------------------------------------------------------------------
// model.mjs — constants, schema, errors
// ---------------------------------------------------------------------------

test("T215 model: category and status snapshots are exact, frozen, and allowlisted", () => {
  assert.deepEqual(GOVERNANCE_CATEGORIES, [
    "contribution",
    "decision",
    "funding",
    "ownership",
    "policy",
    "reference",
    "release",
    "review",
    "runbook",
    "support",
  ]);
  assert.deepEqual(GOVERNANCE_STATUSES, ["observed", "unverified", "unsupported"]);
  assert.equal(GOVERNANCE_DIMENSION_ID, "DIM-governance-v1");
  assert.equal(CODEOWNERS_DIALECT, "codeowners");
  assert.equal(Object.isFrozen(GOVERNANCE_LIMITS), true);
  assert.equal(Object.isFrozen(GOVERNANCE_CATEGORIES), true);
  for (const category of GOVERNANCE_CATEGORIES) {
    assert.ok(PROVIDER_CATEGORIES["DIM-governance-v1"].includes(category), category);
  }
});

test("T215 model: invalid artifacts, statuses, categories, and paths fail with typed errors", () => {
  assert.throws(
    () => modelOf([{ ...policyArtifact("a.md"), category: "language" }]),
    (error) => error instanceof GovernanceModelError && error.code === "UNKNOWN_CATEGORY",
  );
  assert.throws(
    () => modelOf([{ ...policyArtifact("a.md"), category: "ownership" }]),
    GovernanceModelError,
    "ownership entries must come from parsed CODEOWNERS",
  );
  assert.throws(
    () => modelOf([{ ...policyArtifact("a.md"), status: "observed-evil" }]),
    GovernanceModelError,
  );
  assert.throws(
    () => modelOf([{ ...policyArtifact("a.md"), path: "/etc/passwd" }]),
    GovernanceModelError,
  );
  assert.throws(
    () => modelOf([{ ...policyArtifact("a.md"), path: "../escape" }]),
    GovernanceModelError,
  );
  assert.throws(
    () => modelOf([{ ...policyArtifact("a.md"), dialect: "nonsense" }]),
    GovernanceModelError,
  );
  assert.throws(
    () => modelOf([policyArtifact("a.md")], [], { isGit: "yes" }),
    GovernanceModelError,
  );
});

test("T215 model: deterministic deep-frozen output with exact summary and search space", () => {
  const artifacts = [policyArtifact("CODE_OF_CONDUCT.md", "code-of-conduct")];
  const first = modelOf(artifacts);
  const second = modelOf([...artifacts].toReversed());
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.entries), true);
  assert.equal(Object.isFrozen(first.entries[0]), true);
  assert.equal(Object.isFrozen(first.entries[0].source), true);
  assert.equal(Object.isFrozen(first.searchSpace), true);
  assert.throws(() => first.entries.push({}), TypeError);
  assert.throws(() => (first.entries[0].source.path = "mutated"), TypeError);
  assert.equal(first.summary.entries, 1);
  assert.equal(first.summary.byCategory.policy, 1);
  assert.equal(first.summary.byCategory.ownership, 0);
  assert.equal(first.summary.assigneeCount, 0);
  assert.equal(first.summary.assignmentCount, 0);
  assert.equal(first.entries[0].matchedKey, "policy:CODE_OF_CONDUCT.md");
  assert.deepEqual(Object.keys(first.searchSpace).toSorted(), [
    "ambiguous",
    "byteLimit",
    "bytesInspected",
    "capped",
    "complete",
    "error",
    "fileLimit",
    "filesInspected",
    "malformed",
    "omittedCount",
    "readable",
    "recordLimit",
    "recordsInspected",
    "supported",
  ]);
});

test("T215 model: privacy violations downgrade to unverified PRIVACY diagnostics", () => {
  const artifacts = [
    policyArtifact("CODE_OF_CONDUCT.md", "code-of-conduct"),
    {
      category: "reference",
      dialect: "link",
      path: "CONTRIBUTING.md",
      line: 2,
      status: "observed",
      details: { kind: "link", url: "https://alice:secret@example.test/leak" },
    },
  ];
  const model = modelOf(artifacts);
  assert.deepEqual(
    model.entries.map(({ category }) => category),
    ["policy"],
  );
  assert.ok(model.diagnostics.some(({ reason }) => reason === "PRIVACY"));
  const serialized = JSON.stringify(model);
  assert.equal(serialized.includes("alice:secret"), false);
});

test("T215 model: a multi-word ADR status downgrades to a diagnostic without crashing peers", () => {
  const artifacts = [
    {
      category: "decision",
      dialect: "adr",
      path: "doc/adr/0001-review.md",
      line: 1,
      status: "observed",
      details: { kind: "adr", id: "0001", date: null, status: "Under Review" },
    },
    policyArtifact("CODE_OF_CONDUCT.md", "code-of-conduct"),
  ];
  const model = modelOf(artifacts);
  assert.ok(
    model.entries.some(({ path }) => path === "CODE_OF_CONDUCT.md"),
    "a valid peer artifact survives the downgraded ADR",
  );
  assert.deepEqual(
    model.diagnostics.map(({ path, status, reason }) => ({ path, status, reason })),
    [{ path: "doc/adr/0001-review.md", status: "unverified", reason: "MALFORMED" }],
  );
  const serialized = JSON.stringify(model);
  assert.equal(
    serialized.includes("Under Review"),
    false,
    "the multi-word status never reaches the model",
  );
});

test("T215 model: encodeMatchedKey percent-encodes every non-token character", () => {
  assert.equal(encodeMatchedKey("policy:CODE_OF_CONDUCT.md"), "policy:CODE_OF_CONDUCT.md");
  assert.equal(encodeMatchedKey("rule:.github/CODEOWNERS:*.js"), "rule:.github/CODEOWNERS:%2A.js");
  assert.equal(encodeMatchedKey("rule:docs\\ main:*"), "rule:docs%5C%20main:%2A");
  assert.equal(
    encodeMatchedKey("reference:a.md:1:https://example.test/x%20y"),
    "reference:a.md:1:https://example.test/x%20y",
  );
  assert.equal(encodeMatchedKey("x'y"), "x%27y");
  assert.equal(encodeMatchedKey("a?b"), "a%3Fb");
  assert.throws(() => encodeMatchedKey(""), GovernanceModelError);
});

// ---------------------------------------------------------------------------
// codeowners.mjs — parsing, precedence, malformed patterns
// ---------------------------------------------------------------------------

test("T215 codeowners: comments, blanks, and valid rules parse with last-match precedence", () => {
  const parsed = parseCodeowners(
    [
      "# owners",
      "",
      "* @global-owner",
      "/docs/ @docs-team",
      "*.js @js-team",
      "README.md @readme-owner",
      "docs/* @docs-inner",
      "",
    ].join("\n"),
    ".github/CODEOWNERS",
  );
  assert.equal(parsed.malformedLines, 0);
  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(parsed.rules.length, 5);
  assert.deepEqual(parsed.rules[0], {
    pattern: "*",
    anchored: false,
    owners: ["@global-owner"],
    line: 3,
  });
  assert.deepEqual(parsed.rules[1], {
    pattern: "docs/",
    anchored: true,
    owners: ["@docs-team"],
    line: 4,
  });
  assert.equal(parsed.rules[2].pattern, "*.js");
  assert.equal(parsed.patterns, 5);

  assert.deepEqual(resolveOwners("src/app.js", parsed.rules), ["@js-team"]);
  assert.deepEqual(resolveOwners("src/other", parsed.rules), ["@global-owner"]);
  assert.deepEqual(resolveOwners("README.md", parsed.rules), ["@readme-owner"]);
  assert.deepEqual(
    resolveOwners("docs/x/y.md", parsed.rules),
    ["@docs-team"],
    "nested paths match the directory rule, not the single-segment docs/* rule",
  );
  assert.deepEqual(resolveOwners("docs/README.md", parsed.rules), ["@docs-inner"]);
  assert.deepEqual(defaultOwners(parsed.rules), ["@global-owner"]);
});

test("T215 codeowners: last-match semantics honour file order", () => {
  const first = parseCodeowners("* @global\n*.js @js-team\n", "CODEOWNERS");
  assert.deepEqual(resolveOwners("src/app.js", first.rules), ["@js-team"]);
  const reordered = parseCodeowners("*.js @js-team\n* @global\n", "CODEOWNERS");
  assert.deepEqual(
    resolveOwners("src/app.js", reordered.rules),
    ["@global"],
    "the last matching pattern wins regardless of specificity",
  );
  assert.deepEqual(resolveOwners("src/other", reordered.rules), ["@global"]);
});

test("T215 codeowners: duplicate patterns are shadowed by their last occurrence", () => {
  const parsed = parseCodeowners("*.js @first\n*.js @second\n", "CODEOWNERS");
  assert.equal(parsed.rules.length, 1);
  assert.deepEqual(parsed.rules[0].owners, ["@second"]);
  assert.deepEqual(resolveOwners("app.js", parsed.rules), ["@second"]);
});

test("T215 codeowners: pattern matcher supports the documented subset", () => {
  assert.equal(patternMatches("*.js", "src/app.js"), true);
  assert.equal(patternMatches("*.js", "app.js"), true);
  assert.equal(patternMatches("*.js", "src/app.ts"), false);
  assert.equal(patternMatches("docs/", "docs/readme.md"), true);
  assert.equal(patternMatches("docs/", "a/docs/readme.md"), true);
  assert.equal(patternMatches("/docs/", "docs/readme.md"), true);
  assert.equal(patternMatches("/docs/", "a/docs/readme.md"), false);
  assert.equal(patternMatches("docs/*", "a/docs/readme.md"), true);
  assert.equal(
    patternMatches("docs/*", "docs/sub/readme.md"),
    false,
    "single-star matches one segment",
  );
  assert.equal(patternMatches("**/x", "x"), true);
  assert.equal(patternMatches("**/x", "a/b/x"), true);
  assert.equal(patternMatches("a/**/b", "a/b"), true);
  assert.equal(patternMatches("a/**/b", "a/x/y/b"), true);
  assert.equal(patternMatches("?", "a"), true);
  assert.equal(patternMatches("?", "ab"), false);
  assert.equal(patternMatches("a\\ b", "a b"), true);
  assert.equal(patternMatches("\\#file", "#file"), true);
});

test("T215 codeowners: malformed patterns produce typed diagnostics and retain valid lines", () => {
  const parsed = parseCodeowners(
    [
      "!docs/ @x", // negation unsupported
      "/", // empty pattern
      "*.js", // no owners
      "*.py @", // invalid owner token
      "*.rs @valid @", // partial owners: one valid, one invalid
      "*.go @ok", // valid
      "\\", // trailing escape: no tokens
      "",
    ].join("\n"),
    "CODEOWNERS",
  );
  assert.equal(parsed.rules.length, 2);
  assert.deepEqual(parsed.rules[0].owners, ["@valid"]);
  assert.deepEqual(parsed.rules[1].owners, ["@ok"]);
  assert.equal(parsed.malformedLines, 6);
  const reasons = parsed.diagnostics.map(({ reason }) => reason).toSorted();
  assert.deepEqual(reasons, [
    "MALFORMED_LINE",
    "NO_OWNERS",
    "OWNER_UNSUPPORTED",
    "PARTIAL_OWNERS",
    "PATTERN_UNSUPPORTED",
    "PATTERN_UNSUPPORTED",
  ]);
  const statuses = parsed.diagnostics.map(({ status }) => status).toSorted();
  assert.deepEqual(statuses, [
    "unsupported",
    "unsupported",
    "unverified",
    "unverified",
    "unverified",
    "unverified",
  ]);
});

test("T215 codeowners: owner token validation covers users, teams, and emails", () => {
  assert.equal(isOwnerToken("@alice"), true);
  assert.equal(isOwnerToken("@alice-smith"), true);
  assert.equal(isOwnerToken("@org/platform"), true);
  assert.equal(isOwnerToken("alice@example.com"), true);
  assert.equal(isOwnerToken("@"), false);
  assert.equal(isOwnerToken("alice"), false);
  assert.equal(isOwnerToken("@a b"), false);
});

// ---------------------------------------------------------------------------
// model.mjs — ownership aggregation and opaque identities
// ---------------------------------------------------------------------------

test("T215 model: raw owners become opaque report-local labels with aggregate counts", () => {
  const parsed = parseCodeowners(
    [
      "* @alice-smith",
      "*.js @alice-smith",
      "/docs/ @acme/platform",
      "README.md bob@example.com",
      "",
    ].join("\n"),
    ".github/CODEOWNERS",
  );
  const model = modelOf(
    [],
    [
      {
        path: ".github/CODEOWNERS",
        rules: parsed.rules,
        diagnostics: parsed.diagnostics,
        malformedLines: 0,
      },
    ],
  );
  assert.equal(model.summary.assigneeCount, 3);
  assert.equal(model.summary.assignmentCount, 4);
  assert.equal(model.summary.patterns, 4);
  assert.equal(model.ownership.files, 1);
  assert.deepEqual(
    model.ownership.assignees.map(({ label }) => label),
    ["Owner-001", "Owner-002", "Owner-003"],
  );
  const serialized = JSON.stringify(model);
  for (const canary of ["alice-smith", "@acme", "platform", "bob@example.com", "@"]) {
    assert.equal(serialized.includes(canary), false, `raw owner leaked: ${canary}`);
  }
  const labels = model.ownership.rules.flatMap((rule) => rule.labels);
  assert.ok(labels.every((label) => /^Owner-\d{3}$/.test(label)));
  const ownershipEntry = model.entries.find(({ category }) => category === "ownership");
  assert.equal(ownershipEntry.details.kind, "codeowners");
  assert.equal(ownershipEntry.details.patterns, 4);
  assert.ok(ownershipEntry.details.defaultLabels.length > 0);
  assert.ok(ownershipEntry.details.defaultLabels.every((label) => /^Owner-\d{3}$/.test(label)));
});

test("T215 model: multiple CODEOWNERS files share one deterministic label universe", () => {
  const first = parseCodeowners("*.js @a\n", ".github/CODEOWNERS");
  const second = parseCodeowners("docs/ @b\n", "docs/CODEOWNERS");
  const model = modelOf(
    [],
    [
      {
        path: ".github/CODEOWNERS",
        rules: first.rules,
        diagnostics: first.diagnostics,
        malformedLines: 0,
      },
      {
        path: "docs/CODEOWNERS",
        rules: second.rules,
        diagnostics: second.diagnostics,
        malformedLines: 0,
      },
    ],
  );
  assert.equal(model.ownership.files, 2);
  assert.equal(model.summary.assigneeCount, 2);
  assert.deepEqual(
    model.entries.filter(({ category }) => category === "ownership").map(({ path }) => path),
    [".github/CODEOWNERS", "docs/CODEOWNERS"],
  );
});

// ---------------------------------------------------------------------------
// model.mjs — caps
// ---------------------------------------------------------------------------

test("T215 model: caps truncate deterministically and are disclosed", () => {
  const flood = Array.from({ length: GOVERNANCE_LIMITS.maxEntries + 20 }, (_, index) =>
    policyArtifact(`docs/policy/${index}.md`),
  );
  const model = modelOf(flood);
  assert.equal(model.summary.capped.entries, true);
  assert.equal(model.entries.length, GOVERNANCE_LIMITS.maxEntries);

  const parsed = parseCodeowners(
    Array.from(
      { length: GOVERNANCE_LIMITS.maxRules + 20 },
      (_, index) => `p${String(index).padStart(4, "0")} @u`,
    ).join("\n"),
    "CODEOWNERS",
  );
  const cappedRules = modelOf(
    [],
    [
      {
        path: "CODEOWNERS",
        rules: parsed.rules,
        diagnostics: parsed.diagnostics,
        malformedLines: 0,
      },
    ],
  );
  assert.equal(cappedRules.summary.capped.rules, true);
  assert.equal(cappedRules.ownership.rules.length, GOVERNANCE_LIMITS.maxRules);

  const linkFlood = Array.from({ length: GOVERNANCE_LIMITS.maxLinks + 20 }, (_, index) => ({
    category: "reference",
    dialect: "link",
    path: "CONTRIBUTING.md",
    line: index + 1,
    status: "observed",
    details: { kind: "link", url: `https://example.test/${index}` },
  }));
  const cappedLinks = modelOf(linkFlood);
  assert.equal(cappedLinks.summary.capped.links, true);
});

// ---------------------------------------------------------------------------
// model.mjs — path classification, ADR, links
// ---------------------------------------------------------------------------

test("T215 classify: known artifacts, ADR directories, runbooks, and others", () => {
  assert.deepEqual(classifyGovernancePath(".github/CODEOWNERS"), {
    category: "ownership",
    dialect: "codeowners",
    parse: "codeowners",
  });
  assert.deepEqual(classifyGovernancePath("CODEOWNERS"), {
    category: "ownership",
    dialect: "codeowners",
    parse: "codeowners",
  });
  assert.deepEqual(classifyGovernancePath("docs/CODEOWNERS"), {
    category: "ownership",
    dialect: "codeowners",
    parse: "codeowners",
  });
  assert.deepEqual(classifyGovernancePath(".github/FUNDING.yml"), {
    category: "funding",
    dialect: "funding",
    parse: null,
  });
  assert.deepEqual(classifyGovernancePath("CODE_OF_CONDUCT.md"), {
    category: "policy",
    dialect: "code-of-conduct",
    parse: "links",
  });
  assert.deepEqual(classifyGovernancePath(".github/PULL_REQUEST_TEMPLATE.md"), {
    category: "review",
    dialect: "pr-template",
    parse: null,
  });
  assert.deepEqual(classifyGovernancePath("doc/adr/0001-x.md"), {
    category: "decision",
    dialect: "adr",
    parse: "adr",
  });
  assert.deepEqual(classifyGovernancePath("docs/architecture/decisions/0002-y.md"), {
    category: "decision",
    dialect: "adr",
    parse: "adr",
  });
  assert.deepEqual(classifyGovernancePath("decisions/0003-z.md"), {
    category: "decision",
    dialect: "adr",
    parse: "adr",
  });
  assert.deepEqual(classifyGovernancePath("runbook.md"), {
    category: "runbook",
    dialect: "runbook",
    parse: "links",
  });
  assert.deepEqual(classifyGovernancePath("docs/runbooks/ops.md"), {
    category: "runbook",
    dialect: "runbook",
    parse: "links",
  });
  assert.equal(classifyGovernancePath("src/app.js"), null);
  assert.equal(classifyGovernancePath("README.md"), null);
});

test("T215 ADR: heading metadata, date and status are declared facts without verdicts", () => {
  const metadata = parseAdrMetadata(
    ["# 1. Record architecture decisions", "Date: 2023-01-15", "Status: Accepted", ""].join("\n"),
    "doc/adr/0001-record-architecture.md",
  );
  assert.deepEqual(metadata, { id: "0001", date: "2023-01-15", status: "Accepted", line: 1 });

  const block = parseAdrMetadata(
    ["# ADR 0002: Use S3", "## Status", "Proposed", ""].join("\n"),
    "doc/adr/0002-use-s3.md",
  );
  assert.deepEqual(block, { id: "0002", date: null, status: "Proposed", line: 1 });

  const bare = parseAdrMetadata("notes\n", "doc/adr/0003-bare.md");
  assert.deepEqual(bare, { id: "0003", date: null, status: null, line: null });
});

test("T215 ADR: multi-word statuses are dropped, never extracted as unsafe facts", () => {
  const inline = parseAdrMetadata(
    ["# 1. Review", "Status: Under Review", ""].join("\n"),
    "doc/adr/0001-review.md",
  );
  assert.deepEqual(inline, { id: "0001", date: null, status: null, line: 1 });
  const block = parseAdrMetadata(
    ["# ADR 0002: Use S3", "## Status", "Under Review", ""].join("\n"),
    "doc/adr/0002-use-s3.md",
  );
  assert.deepEqual(block, { id: "0002", date: null, status: null, line: 1 });
  const kept = parseAdrMetadata(
    ["# 1. Review", "Status: In-Review", ""].join("\n"),
    "doc/adr/0003-review.md",
  );
  assert.equal(kept.status, "In-Review", "single-token hyphenated statuses remain declared facts");
});

test("T215 links: explicit markdown and autolink URLs are extracted and sanitized", () => {
  const { links, capped } = extractMarkdownLinks(
    "See [guidelines](https://example.test/docs) and <https://example.test/auto>.\n" +
      "[cred](https://user:secret@example.test/api) and [rel](./relative) and [anchor](#top).\n",
    "CONTRIBUTING.md",
  );
  assert.equal(capped, false);
  assert.deepEqual(links, [
    { url: "https://example.test/docs", line: 1 },
    { url: "https://example.test/auto", line: 1 },
    { url: "https://example.test/api", line: 2 },
  ]);
  assert.equal(
    JSON.stringify(links).includes("user:secret"),
    false,
    "credentials never survive sanitization",
  );
});

// ---------------------------------------------------------------------------
// providers/governance.mjs — T210-compatible provider
// ---------------------------------------------------------------------------

test("T215 provider: emits only DIM-governance categories via the provider foundation", () => {
  const parsed = parseCodeowners("* @alice\n", ".github/CODEOWNERS");
  const model = modelOf(
    [policyArtifact("CODE_OF_CONDUCT.md", "code-of-conduct")],
    [
      {
        path: ".github/CODEOWNERS",
        rules: parsed.rules,
        diagnostics: parsed.diagnostics,
        malformedLines: 0,
      },
    ],
  );
  const results = governanceProviderResult(model);
  assert.equal(results.length, 1);
  assert.equal(results[0].providerId, GOVERNANCE_PROVIDER_ID);
  assert.equal(results[0].dimensionId, "DIM-governance-v1");
  const categories = [
    ...new Set(results[0].observations.map(({ category }) => category)),
  ].toSorted();
  assert.deepEqual(categories, ["ownership", "policy"]);
  for (const observation of results[0].observations) {
    assert.ok(PROVIDER_CATEGORIES["DIM-governance-v1"].includes(observation.category));
    assert.ok(Object.isFrozen(observation));
  }
  assert.equal(Object.isFrozen(results[0]), true);
});

test("T215 provider: deterministic, immutable, and empty for empty/foreign input", () => {
  const parsed = parseCodeowners("*.js @alice\n", ".github/CODEOWNERS");
  const model = modelOf(
    [],
    [
      {
        path: ".github/CODEOWNERS",
        rules: parsed.rules,
        diagnostics: parsed.diagnostics,
        malformedLines: 0,
      },
    ],
  );
  const first = governanceProviderResult(model);
  const second = governanceProviderResult(model);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(governanceProviderResult(null), []);
  assert.deepEqual(governanceProviderResult({}), []);
  assert.deepEqual(governanceProviderResult({ entries: [] }), [
    {
      providerId: GOVERNANCE_PROVIDER_ID,
      dimensionId: "DIM-governance-v1",
      observations: [],
    },
  ]);
  assert.deepEqual(governanceObservations(null), []);
});

test("T215 provider: observations carry opaque labels and encoded matched keys only", () => {
  const parsed = parseCodeowners("*.js @alice\n", ".github/CODEOWNERS");
  const model = modelOf(
    [],
    [
      {
        path: ".github/CODEOWNERS",
        rules: parsed.rules,
        diagnostics: parsed.diagnostics,
        malformedLines: 0,
      },
    ],
  );
  const [{ observations }] = governanceObservations(model);
  const serialized = JSON.stringify(observations);
  assert.equal(serialized.includes("@alice"), false);
  assert.equal(serialized.includes("alice"), false);
  assert.ok(
    observations.some(({ matchedKey }) => matchedKey.startsWith("rule:.github/CODEOWNERS:%2A.js")),
    "rule matched keys percent-encode the wildcard",
  );
  assert.ok(observations.some(({ matchedKey }) => matchedKey.startsWith("assignee:Owner-")));
});

test("T215 provider: over-long links and patterns stay within the foundation key bound", () => {
  const longUrl = `https://example.test/${"a".repeat(300)}`;
  const rules = [
    {
      pattern: "b".repeat(200),
      anchored: false,
      owners: ["@alice"],
      line: 1,
    },
  ];
  const model = modelOf(
    [
      {
        category: "reference",
        dialect: "link",
        path: "CONTRIBUTING.md",
        line: 1,
        status: "observed",
        details: { kind: "link", url: longUrl },
      },
      policyArtifact("CODE_OF_CONDUCT.md", "code-of-conduct"),
    ],
    [{ path: ".github/CODEOWNERS", rules, diagnostics: [], malformedLines: 0 }],
  );
  const results = governanceProviderResult(model);
  assert.equal(results.length, 1);
  for (const observation of results[0].observations) {
    assert.ok(observation.matchedKey.length <= 128, observation.matchedKey);
  }
  assert.ok(
    results[0].observations.some(({ matchedKey }) => /^rule:[a-f0-9]{8}$/.test(matchedKey)),
    "an over-long pattern falls back to a stable short hash",
  );
  assert.ok(
    results[0].observations.some(({ matchedKey }) => /^reference:[a-f0-9]{8}$/.test(matchedKey)),
    "an over-long link falls back to a stable short hash",
  );
  assert.ok(
    results[0].observations.some(({ category }) => category === "policy"),
    "the whole provider result is never invalidated by one over-long key",
  );
});

test("T215 model: a >512-char link URL (STRING_LIMIT) downgrades to a diagnostic without crashing peers", () => {
  const longUrl = `https://example.test/${"x".repeat(498)}`;
  assert.equal(longUrl.length, 519);
  const model = modelOf([
    {
      category: "reference",
      dialect: "link",
      path: "CONTRIBUTING.md",
      line: 1,
      status: "observed",
      details: { kind: "link", url: longUrl },
    },
    policyArtifact("CODE_OF_CONDUCT.md", "code-of-conduct"),
  ]);
  assert.ok(
    model.entries.some(({ path }) => path === "CODE_OF_CONDUCT.md"),
    "a valid peer artifact survives the downgraded over-long link",
  );
  assert.deepEqual(
    model.diagnostics.map(({ path, status, reason }) => ({ path, status, reason })),
    [{ path: "CONTRIBUTING.md", status: "unverified", reason: "STRING_LIMIT" }],
  );
  assert.equal(
    JSON.stringify(model).includes(longUrl),
    false,
    "the over-long URL never reaches the model",
  );
  assert.equal(
    governanceProviderResult(model).length,
    1,
    "the provider result is never invalidated",
  );
});

test("T215 provider: a ~489-char link URL stays within the foundation key bound", () => {
  const longUrl = `https://example.test/${"y".repeat(468)}`;
  assert.equal(longUrl.length, 489);
  const model = modelOf([
    {
      category: "reference",
      dialect: "link",
      path: "CONTRIBUTING.md",
      line: 1,
      status: "observed",
      details: { kind: "link", url: longUrl },
    },
  ]);
  const results = governanceProviderResult(model);
  assert.equal(results.length, 1);
  const reference = results[0].observations.find(({ category }) => category === "reference");
  assert.ok(reference, "the ~489-char link survives the model and reaches the provider");
  assert.match(
    reference.matchedKey,
    /^reference:[a-f0-9]{8}$/,
    "an over-long raw key falls back to the stable short hash before encoding",
  );
  assert.ok(reference.matchedKey.length <= 128, reference.matchedKey);
  assert.equal(
    JSON.stringify(results).includes(longUrl),
    false,
    "the raw URL is never duplicated into the provider key",
  );
});

// ---------------------------------------------------------------------------
// render/governance.mjs — inert renderer
// ---------------------------------------------------------------------------

test("T215 renderer: neutral markdown with opaque labels and dates without verdicts", () => {
  const parsed = parseCodeowners("* @global\n*.js @js\n", ".github/CODEOWNERS");
  const model = modelOf(
    [
      {
        category: "decision",
        dialect: "adr",
        path: "doc/adr/0001-x.md",
        line: 1,
        status: "observed",
        details: { kind: "adr", id: "0001", date: "2023-01-15", status: "Accepted" },
      },
      policyArtifact("CODE_OF_CONDUCT.md", "code-of-conduct"),
      {
        category: "reference",
        dialect: "link",
        path: "CONTRIBUTING.md",
        line: 1,
        status: "observed",
        details: { kind: "link", url: "https://example.test/docs" },
      },
    ],
    [
      {
        path: ".github/CODEOWNERS",
        rules: parsed.rules,
        diagnostics: parsed.diagnostics,
        malformedLines: 0,
      },
    ],
  );
  const markdown = createGovernanceRenderer().render(model);
  assert.match(markdown, /^## Governance & Ownership/);
  assert.match(markdown, /never inferred from commits/);
  assert.match(markdown, /CODEOWNERS/);
  assert.match(markdown, /Owner-\d{3}/);
  assert.match(markdown, /0001 \| Accepted \| 2023-01-15/);
  assert.match(markdown, /https:\/\/example\.test\/docs/);
  assert.equal(markdown.includes("@global"), false);
  assert.equal(markdown.includes("@js"), false);
  assert.equal(markdown.includes("\r"), false);
  assert.deepEqual(findVoiceHits(markdown), []);
});

test("T215 renderer: empty model renders a factual no-detected line and disclosed caps", () => {
  const empty = modelOf([]);
  const markdown = createGovernanceRenderer().render(empty);
  assert.match(
    markdown,
    /No governance or ownership artifacts detected in 3 inspected file\(s\)\./,
  );
  assert.deepEqual(findVoiceHits(markdown), []);

  const cappedModel = modelOf(
    Array.from({ length: GOVERNANCE_LIMITS.maxEntries + 1 }, (_, index) =>
      policyArtifact(`p${index}.md`),
    ),
  );
  const cappedMarkdown = createGovernanceRenderer().render(cappedModel);
  assert.match(cappedMarkdown, /inventory entry total capped/);
});

test("T215 renderer: no-detected line requires a clean search space; otherwise only diagnostics", () => {
  const incomplete = modelOf([], [], {
    searchSpace: {
      supported: true,
      readable: false,
      complete: false,
      capped: false,
      error: true,
      malformed: false,
      ambiguous: false,
      filesInspected: 2,
      fileLimit: 100,
      bytesInspected: 100,
      byteLimit: 10_000,
      recordsInspected: 1,
      recordLimit: 1_000,
      omittedCount: 0,
    },
    diagnostics: [
      { path: "CODE_OF_CONDUCT.md", line: null, status: "unverified", reason: "UNREADABLE" },
    ],
  });
  const markdown = createGovernanceRenderer().render(incomplete);
  assert.equal(
    markdown.includes("No governance or ownership artifacts detected"),
    false,
    "a partial search space must never claim nothing was detected",
  );
  assert.match(markdown, /UNREADABLE \(unverified\)/);
  assert.deepEqual(findVoiceHits(markdown), []);
});

test("T215 renderer: deterministic byte-identical output and invalid context rejection", () => {
  const model = modelOf([policyArtifact("CODE_OF_CONDUCT.md", "code-of-conduct")]);
  const first = renderGovernance("x", model);
  const second = renderGovernance("x", model);
  assert.equal(first, second);
  assert.equal(renderGovernance("x", null), "");
  assert.throws(() => createGovernanceRenderer({ context: {} }), /escapeField/);
  assert.equal(Object.isFrozen(createGovernanceRenderer()), true);
});

test("T215 inertness: governance renderer is never registered in the existing-ten map", async () => {
  assert.deepEqual(Object.keys(EXISTING_TEN_RENDERER_MAP).toSorted(), [
    "architecture",
    "config",
    "conventions",
    "documentation",
    "git",
    "operations",
    "security",
    "stack",
    "structure",
    "testing",
  ]);
  assert.equal(EXISTING_TEN_RENDERER_MAP.governance, undefined);
  const existingTen = await readFile(join(LIB_ROOT, "scan", "render", "existing-ten.mjs"), "utf8");
  assert.equal(
    existingTen.includes("render/governance.mjs"),
    false,
    "existing-ten must not import the governance renderer",
  );
  const write = await readFile(join(LIB_ROOT, "scan", "write.mjs"), "utf8");
  assert.equal(
    write.includes("render/governance.mjs"),
    false,
    "write must not import the governance renderer",
  );
  assert.equal(
    write.includes("providers/governance.mjs"),
    false,
    "write must not import the governance provider",
  );
});

// ---------------------------------------------------------------------------
// scanner.mjs — plain fixtures (non-Git)
// ---------------------------------------------------------------------------

test("T215 scanner: inventory of policy/contribution/review/release/support/funding artifacts", async () => {
  const files = {
    "CODE_OF_CONDUCT.md": "code of conduct",
    "SECURITY.md": "security policy",
    "GOVERNANCE.md": "governance notes",
    "CONTRIBUTING.md": "contributing guide",
    "RELEASING.md": "releasing guide",
    "CHANGELOG.md": "## 1.0.0",
    "SUPPORT.md": "support notes",
    "FUNDING.yml": "github: [sponsors]",
    "runbook.md": "runbook",
    ".github/PULL_REQUEST_TEMPLATE.md": "## What",
    ".github/ISSUE_TEMPLATE/bug.md": "## Bug",
    "src/app.js": "x",
  };
  await withFixture("gov-policies", files, async (dir) => {
    const { dimension, signal, findings } = await scan(dir, {}, inertGitBroker());
    assert.equal(dimension, "governance");
    assert.equal(signal, "high");
    assert.equal(findings.summary.isGit, false);
    const byCategory = findings.summary.byCategory;
    assert.equal(byCategory.policy, 3);
    assert.equal(byCategory.contribution, 1);
    assert.equal(byCategory.release, 2);
    assert.equal(byCategory.support, 1);
    assert.equal(byCategory.funding, 1);
    assert.equal(byCategory.runbook, 1);
    assert.equal(byCategory.review, 2);
    const paths = findings.entries.map(({ path }) => path);
    assert.ok(paths.includes(".github/PULL_REQUEST_TEMPLATE.md"));
    assert.ok(paths.includes(".github/ISSUE_TEMPLATE/bug.md"));
    assert.ok(paths.includes("runbook.md"));
  });
});

test("T215 scanner: ADR entries carry declared id, date, and status", async () => {
  const files = {
    "doc/adr/0001-record-architecture.md": [
      "# 1. Record architecture decisions",
      "Date: 2023-01-15",
      "Status: Accepted",
      "",
    ].join("\n"),
    "docs/architecture/decisions/0002-use-s3.md": "# ADR 0002: Use S3\n",
    "src/app.js": "x",
  };
  await withFixture("gov-adr", files, async (dir) => {
    const { findings } = await scan(dir, {}, inertGitBroker());
    const decisions = findings.entries
      .filter(({ category }) => category === "decision")
      .toSorted((left, right) => left.path.localeCompare(right.path));
    assert.equal(decisions.length, 2);
    const first = decisions[0];
    assert.equal(first.details.id, "0001");
    assert.equal(first.details.date, "2023-01-15");
    assert.equal(first.details.status, "Accepted");
    assert.equal(first.source.line, 1);
    const second = decisions[1];
    assert.equal(second.details.id, "0002");
    assert.equal(second.details.date, null);
    assert.equal(second.details.status, null);
  });
});

test("T215 scanner: an ADR with a multi-word status never crashes and peers survive", async () => {
  const files = {
    "doc/adr/0001-review.md": ["# 1. Review", "Status: Under Review", ""].join("\n"),
    "CODE_OF_CONDUCT.md": "code",
  };
  await withFixture("gov-adr-multiword", files, async (dir) => {
    const { findings } = await scan(dir, {}, inertGitBroker());
    const decisions = findings.entries.filter(({ category }) => category === "decision");
    assert.equal(decisions.length, 1, "the ADR survives as an entry");
    assert.equal(decisions[0].details.status, null, "multi-word status is not persisted");
    assert.ok(
      findings.entries.some(({ path }) => path === "CODE_OF_CONDUCT.md"),
      "a valid governance artifact survives beside the ADR",
    );
  });
});

test("T215 scanner: malformed peers never erase valid evidence", async () => {
  const files = {
    ".github/CODEOWNERS": "* @global\n*.js @js-team\n",
    "docs/CODEOWNERS": "!docs/ @x\n*.js\n",
    "CODE_OF_CONDUCT.md": "code",
  };
  await withFixture("gov-malformed", files, async (dir) => {
    const { findings } = await scan(dir, {}, inertGitBroker());
    assert.equal(findings.ownership.files, 2);
    assert.equal(findings.summary.patterns, 2);
    assert.ok(findings.entries.some(({ path }) => path === ".github/CODEOWNERS"));
    const reasons = findings.diagnostics.map(({ reason }) => reason).toSorted();
    assert.deepEqual(reasons, ["NO_OWNERS", "PATTERN_UNSUPPORTED"]);
    assert.equal(findings.summary.diagnostics, 2);
  });
});

test("T215 scanner: credential URLs and personal data never reach the model, provider, or markdown", async () => {
  const files = {
    ".github/CODEOWNERS": ["* @alice-smith", "*.py alice@example.com", ""].join("\n"),
    "CODE_OF_CONDUCT.md": "See [Alice Smith](https://example.test/conduct).\n",
    "CONTRIBUTING.md":
      "Please [contribute](https://user:secret@example.test/api).\nContact security@example.com.\n",
    "SECURITY.md": "Report issues privately.\n",
    "src/app.py": "x",
  };
  await withFixture("gov-privacy", files, async (dir) => {
    const { findings } = await scan(dir, {}, inertGitBroker());
    const modelJson = JSON.stringify(findings);
    for (const canary of [
      "alice-smith",
      "alice@example.com",
      "user:secret",
      "Alice Smith",
      "security@example.com",
      "@",
    ]) {
      assert.equal(modelJson.includes(canary), false, `model leaked: ${canary}`);
    }
    const providerJson = JSON.stringify(governanceProviderResult(findings));
    for (const canary of ["alice-smith", "alice@example.com", "user:secret", "Alice Smith", "@"]) {
      assert.equal(providerJson.includes(canary), false, `provider leaked: ${canary}`);
    }
    const markdown = renderGovernance("x", findings);
    for (const canary of ["alice-smith", "alice@example.com", "user:secret", "Alice Smith", "@"]) {
      assert.equal(markdown.includes(canary), false, `markdown leaked: ${canary}`);
    }
    const references = findings.entries.filter(({ category }) => category === "reference");
    assert.equal(
      references.length,
      2,
      "credential links are sanitized, never dropped with their credentials",
    );
    assert.deepEqual(references.map(({ details }) => details.url).toSorted(), [
      "https://example.test/api",
      "https://example.test/conduct",
    ]);
    assert.deepEqual(
      findings.entries
        .filter(({ category }) => category === "contribution")
        .map(({ path }) => path),
      ["CONTRIBUTING.md"],
      "a contribution guide without links is still inventoried",
    );
  });
});

test("T215 scanner: deterministic repeated runs are byte-identical and search space is T202-compatible", async () => {
  const files = {
    ".github/CODEOWNERS": "* @alice\n",
    "CODE_OF_CONDUCT.md": "See [docs](https://example.test/docs).\n",
    "doc/adr/0001-x.md": "# 1. X\nDate: 2022-05-01\nStatus: Accepted\n",
  };
  await withFixture("gov-determinism", files, async (dir) => {
    const broker = inertGitBroker();
    const first = await scan(dir, {}, broker);
    const second = await scan(dir, {}, broker);
    assert.equal(JSON.stringify(first.findings), JSON.stringify(second.findings));
    assert.equal(Object.isFrozen(first.findings), true);
    assert.deepEqual(Object.keys(first.findings.searchSpace).toSorted(), [
      "ambiguous",
      "byteLimit",
      "bytesInspected",
      "capped",
      "complete",
      "error",
      "fileLimit",
      "filesInspected",
      "malformed",
      "omittedCount",
      "readable",
      "recordLimit",
      "recordsInspected",
      "supported",
    ]);
  });
});

test("T215 scanner: per-file link cap yields a CAP diagnostic and bounded entries", async () => {
  const links = Array.from(
    { length: GOVERNANCE_LIMITS.maxLinksPerFile + 10 },
    (_, index) => `[doc ${index}](https://example.test/${index})`,
  );
  const files = { "CONTRIBUTING.md": `${links.join("\n")}\n` };
  await withFixture("gov-linkcap", files, async (dir) => {
    const { findings } = await scan(dir, {}, inertGitBroker());
    assert.ok(findings.diagnostics.some(({ reason }) => reason === "CAP"));
    const references = findings.entries.filter(({ category }) => category === "reference");
    assert.equal(references.length, GOVERNANCE_LIMITS.maxLinksPerFile);
  });
});

// ---------------------------------------------------------------------------
// scanner.mjs — real Git repository (no-inference, broker-only)
// ---------------------------------------------------------------------------

test("T215 scanner: git usage is broker-only and commit identities never infer ownership", async () => {
  const dir = makeGitRepo({
    commits: [
      {
        message: "feat: initial",
        files: {
          ".github/CODEOWNERS": "* @alice\n",
          "CODE_OF_CONDUCT.md": "code",
          "doc/adr/0001-x.md": "# 1. X\nDate: 2024-01-01\nStatus: Accepted\n",
          "src/app.js": "x",
        },
        user: "Alice Example",
        email: "alice@example.com",
      },
      {
        message: "fix: second",
        files: { "b.txt": "y" },
        user: "Bob Other",
        email: "bob@example.com",
      },
    ],
    remote: "https://github.com/acme/demo.git",
  });
  try {
    const calls = [];
    const broker = createCommandBroker({
      runner: {
        async run(executable, argv, options) {
          calls.push({ executable, argv: [...argv], shell: options.shell });
          return (await import("../lib/scan/shared/command.mjs")).defaultRunner.run(
            executable,
            argv,
            options,
          );
        },
      },
    });
    const { findings } = await scan(dir, {}, broker);
    assert.equal(findings.summary.isGit, true);
    assert.equal(findings.summary.defaultBranch, "main");
    assert.deepEqual(
      calls.map((call) => call.argv.join(" ")),
      ["rev-parse --show-toplevel", "rev-parse --abbrev-ref HEAD"],
    );
    assert.ok(calls.every((call) => call.shell === false));
    assert.equal(
      calls.some((call) => call.argv.includes("log")),
      false,
      "no commit history may be requested",
    );
    assert.equal(
      calls.some((call) => call.argv.includes("shortlog")),
      false,
      "no contributor data may be requested",
    );
    const modelJson = JSON.stringify(findings);
    for (const canary of ["Alice", "Bob", "alice@example.com", "bob@example.com", "@"]) {
      assert.equal(modelJson.includes(canary), false, `git identity leaked: ${canary}`);
    }
  } finally {
    cleanupGitRepo(dir);
  }
});

test("T215 scanner: empty repository yields a low signal with a complete search space", async () => {
  const files = { "src/app.js": "x" };
  await withFixture("gov-empty", files, async (dir) => {
    const { dimension, signal, findings } = await scan(dir, {}, inertGitBroker());
    assert.equal(dimension, "governance");
    assert.equal(signal, "low");
    assert.equal(findings.summary.entries, 0);
    assert.equal(findings.entries.length, 0);
    assert.equal(findings.searchSpace.complete, true);
    assert.deepEqual(findings.diagnostics, []);
  });
});

test("T215 scanner: an unreadable governance artifact becomes a diagnostic, never a crash", async () => {
  const files = {
    "CODE_OF_CONDUCT.md": Buffer.from([0xff, 0xfe, 0x00]),
    "CONTRIBUTING.md": "valid\n",
    "src/app.js": "x",
  };
  await withFixture("gov-unreadable", files, async (dir) => {
    const { findings } = await scan(dir, {}, inertGitBroker());
    assert.ok(findings.diagnostics.some(({ reason }) => reason === "MALFORMED"));
    assert.ok(findings.entries.some(({ path }) => path === "CONTRIBUTING.md"));
  });
});

test("T215 scanner: an unreadable-only fixture never emits the no-detected line", async () => {
  const files = {
    "CODE_OF_CONDUCT.md": Buffer.from([0xff, 0xfe, 0x00]),
    "src/app.js": "x",
  };
  await withFixture("gov-unreadable-only", files, async (dir) => {
    const { findings } = await scan(dir, {}, inertGitBroker());
    assert.equal(findings.summary.entries, 0);
    assert.equal(findings.searchSpace.complete, false);
    assert.equal(findings.searchSpace.malformed, true);
    const markdown = renderGovernance("x", findings);
    assert.equal(
      markdown.includes("No governance or ownership artifacts detected"),
      false,
      "a malformed search space must not claim nothing was detected",
    );
    assert.match(markdown, /MALFORMED \(unverified\)/);
  });
});

test("T215 scanner: over-long links and patterns reach the provider as bounded keys", async () => {
  const files = {
    ".github/CODEOWNERS": `${"a".repeat(200)} @alice\n`,
    "CONTRIBUTING.md": `[docs](https://example.test/${"b".repeat(180)})\n`,
  };
  await withFixture("gov-overlong", files, async (dir) => {
    const { findings } = await scan(dir, {}, inertGitBroker());
    assert.ok(findings.entries.some(({ category }) => category === "reference"));
    const results = governanceProviderResult(findings);
    assert.equal(results.length, 1);
    for (const observation of results[0].observations) {
      assert.ok(observation.matchedKey.length <= 128, observation.matchedKey);
    }
  });
});

test("T215 scanner: a 519-char link URL never aborts the scan and peers survive", async () => {
  const longUrl = `https://example.test/${"x".repeat(498)}`;
  assert.equal(longUrl.length, 519);
  const files = {
    "CONTRIBUTING.md": `See [docs](${longUrl}).\n`,
    "CODE_OF_CONDUCT.md": "code",
    "src/app.js": "x",
  };
  await withFixture("gov-longurl-519", files, async (dir) => {
    const { findings } = await scan(dir, {}, inertGitBroker());
    assert.ok(
      findings.entries.some(({ path }) => path === "CODE_OF_CONDUCT.md"),
      "a valid governance artifact survives beside the over-long link",
    );
    assert.ok(
      findings.entries.some(({ path }) => path === "CONTRIBUTING.md"),
      "the contributing guide is still inventoried",
    );
    assert.equal(
      findings.entries.some(({ category }) => category === "reference"),
      false,
      "the over-long link is skipped at extraction, never a model entry",
    );
    const results = governanceProviderResult(findings);
    assert.equal(results.length, 1);
    for (const observation of results[0].observations) {
      assert.ok(observation.matchedKey.length <= 128, observation.matchedKey);
    }
  });
});

test("T215 scanner: a ~489-char link URL never aborts the scan and peers survive", async () => {
  const longUrl = `https://example.test/${"y".repeat(468)}`;
  assert.equal(longUrl.length, 489);
  const files = {
    "CONTRIBUTING.md": `[docs](${longUrl})\n`,
    ".github/CODEOWNERS": "* @alice\n",
    "src/app.js": "x",
  };
  await withFixture("gov-longurl-489", files, async (dir) => {
    const { findings } = await scan(dir, {}, inertGitBroker());
    assert.ok(
      findings.entries.some(({ path }) => path === ".github/CODEOWNERS"),
      "a CODEOWNERS peer survives beside the over-long link",
    );
    assert.equal(
      findings.entries.some(({ category }) => category === "reference"),
      false,
      "the over-long link is skipped at extraction, never a model entry",
    );
    const results = governanceProviderResult(findings);
    assert.equal(results.length, 1);
    for (const observation of results[0].observations) {
      assert.ok(observation.matchedKey.length <= 128, observation.matchedKey);
    }
  });
});
