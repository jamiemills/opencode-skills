// F-029 — practices.mjs kind tokens are escaped via escapeField.
//
// Before this fix kindTokenList interpolated kind tokens (ruff codes, deny-rule
// ids, hook stages) raw inside backticks even though the model admits backticks
// and pipes. After the fix each token passes through escapeField({ inTable: true }).

import assert from "node:assert/strict";
import { test } from "node:test";

import { renderPractices, createPracticesRenderer } from "../lib/scan/render/practices.mjs";
import { DEFAULT_RENDER_CONTEXT } from "../lib/scan/render/base.mjs";

function modelWithKinds(kinds) {
  return {
    summary: { filesInspected: 1 },
    entries: [
      {
        category: "style_guide",
        matchedKey: "style_guide:ruff-select:ruff",
        path: "pyproject.toml",
        count: kinds.length,
        kinds,
      },
    ],
    diagnostics: [],
    searchSpace: {
      complete: true,
      supported: true,
      readable: true,
      capped: false,
      error: false,
      malformed: false,
      filesInspected: 1,
    },
  };
}

test("F-029: kind tokens containing backticks and pipes are escaped, not interpolated raw", () => {
  const hostile = "D212`|evil";
  const markdown = renderPractices(
    "repo",
    modelWithKinds([hostile, "E501"]),
    DEFAULT_RENDER_CONTEXT,
  );
  assert.ok(!markdown.includes("D212`|evil"), "the raw kind token must not be interpolated");
  // The escaped inner form: backtick -> \` and pipe -> \| (inside the code span).
  assert.ok(
    markdown.includes("D212\\`\\|evil"),
    "backtick and pipe inside a kind token must be escaped",
  );
});

test("F-029: the practices renderer escapes kinds through its context", () => {
  const renderer = createPracticesRenderer({ context: DEFAULT_RENDER_CONTEXT });
  const markdown = renderer.render(modelWithKinds(["A001", "B`002"]));
  assert.ok(markdown.includes("B\\`002"), "backtick inside a kind token must be escaped");
});
