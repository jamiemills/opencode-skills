"use strict";

import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractRepository } from "../lib/ddd/extract.mjs";
import { synthesize } from "../lib/ddd/synthesize.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRepo = join(here, "fixtures", "repos", "sample-repo");

test("synthesis turns the sample extraction into hypotheses, seams, and ordering", async () => {
  const extraction = await extractRepository({ root: fixtureRepo });
  const result = synthesize(extraction);

  assert.ok(result.capabilities.length >= 2, "expected planning+scanning capabilities");
  for (const cap of result.capabilities) {
    assert.ok(cap.claimId && cap.hypothesisId);
    assert.ok(["core", "supporting", "isolated"].includes(cap.classification));
  }

  for (const hypothesis of result.contextHypotheses) {
    assert.equal(hypothesis.claimKind, "context_hypothesis");
    assert.notEqual(hypothesis.status, "observed", "context hypotheses may never claim observed");
    assert.match(hypothesis.note, /validation/i);
  }

  const scanImport = extraction.inventory.consumers.find((c) => c.key.includes("planning"));
  if (scanImport) {
    assert.ok(
      result.edges.some((e) => e.relation === "upstream-downstream" || e.relation === "conformist"),
    );
  }
});

test("conflicting terminology produces an explicit ambiguity record", async () => {
  const extraction = await extractRepository({ root: fixtureRepo });
  const result = synthesize(extraction);
  const ambiguousTerms = result.terms.filter((t) => t.ambiguous);
  if (ambiguousTerms.length > 0) {
    for (const ambiguity of result.ambiguities) {
      assert.equal(ambiguity.status, "unverified");
      assert.match(ambiguity.note, /AMBIGUITY/);
    }
  }
  assert.ok(result.terms.length > 0);
});

test("every seam carries all five fields and every ordering entry cites evidence and uncertainty", async () => {
  const extraction = await extractRepository({ root: fixtureRepo });
  const result = synthesize(extraction);
  assert.ok(
    result.seams.length >= 1,
    "sample fixture must expose at least one seam (planWork is imported)",
  );
  for (const seam of result.seams) {
    for (const field of [
      "enablingPoint",
      "observableBehavior",
      "sideEffects",
      "redirectableSlice",
      "rollbackOption",
    ]) {
      assert.equal(typeof seam[field], "string", `${field} required`);
      assert.ok(seam[field].length > 0);
    }
  }
  for (const slice of result.slices) {
    assert.ok(slice.evidenceIds.length >= 1, "ordering entries cite evidence");
    assert.match(slice.note, /UNCERTAINTY:/);
  }
  assert.equal(result.ordering.length, result.seams.length);
  const ranks = result.ordering.map((o) => o.rank);
  assert.deepEqual(ranks, ranks.toSorted());
});

test("no synthesis claim lacks a basis and statuses stay in vocabulary", async () => {
  const extraction = await extractRepository({ root: fixtureRepo });
  const result = synthesize(extraction);
  const allowed = new Set([
    "observed",
    "inferred",
    "not_detected",
    "unsupported",
    "unverified",
    "not_applicable",
  ]);
  for (const claim of result.claims) {
    if (!claim.claimKind) continue;
    assert.ok(claim.basis, `claim ${claim.id} lacks basis`);
    assert.ok(allowed.has(claim.status), `claim ${claim.id} bad status ${claim.status}`);
    if (claim.claimKind === "context_hypothesis") assert.notEqual(claim.status, "observed");
  }
});

test("synthesis is deterministic across runs on identical input", async () => {
  const first = synthesize(await extractRepository({ root: fixtureRepo }));
  const second = synthesize(await extractRepository({ root: fixtureRepo }));
  assert.deepEqual(JSON.stringify(first), JSON.stringify(second));
});
