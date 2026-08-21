// F-024 — markdown/HTML neutralization in repo-controlled fields.
//
// Before this fix escapeField left newlines and the markdown-significant token
// set untouched, so a repo-controlled description (`overview.description`,
// cross-observation descriptions) could inject report lines or smuggle
// `<img onerror=…>` HTML into NORMS.md. After the fix newlines are neutralized
// in every field rendered through escapeField, and the repo-controlled
// free-text context (`markdownSafe`) additionally escapes the HTML-significant
// token set.
//
// Seeded fixtures only.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createRenderContext } from "../lib/scan/render/base.mjs";
import { writeNORMS } from "../lib/scan/write.mjs";

test("F-024: escapeField neutralizes newlines in every field", () => {
  const ctx = createRenderContext();
  assert.equal(ctx.escapeField("line one\nline two"), "line one line two");
  assert.equal(ctx.escapeField("a\r\nb\rc"), "a b c");
  // Existing escaping behavior is preserved.
  assert.equal(ctx.escapeField("# a|b`c\\d"), "\\# a\\|b\\`c\\\\d");
  assert.equal(ctx.escapeField("# a|b", { inTable: true }), "# a\\|b");
});

test("F-024: markdownSafe contexts escape the HTML-significant token set", () => {
  const safe = createRenderContext({ markdownSafe: true });
  assert.equal(
    safe.escapeField("<img src=x onerror=alert(1)>"),
    "\\<img src=x onerror=alert(1)\\>",
  );
  assert.equal(safe.escapeField("<script>"), "\\<script\\>");
  // Default context does not escape angle brackets (structured fields).
  const plain = createRenderContext();
  assert.equal(plain.escapeField("<img>"), "<img>");
});

test("F-024: writeNORMS renders a hostile repo-controlled description on one neutral line", async () => {
  const findings = {
    generated: "2026-01-01",
    repos: [
      {
        overview: {
          name: "hostile-repo",
          path: "/repo/hostile-repo",
          languages: ["Python"],
          packageManager: "pip",
          totalFiles: 1,
          description: "top line\n# fake heading\n* spoof * <img src=x onerror=alert(1)>",
        },
        deep: [],
      },
    ],
  };
  const content = await writeNORMS(findings, "/tmp/opencode/f024-unused.md", {
    render: () => "",
    renderGlobal: () => "",
  });
  // The injected heading must not become a real report heading.
  assert.ok(
    !content.split("\n").some((line) => line.startsWith("# fake heading")),
    "an injected heading must not render as a heading",
  );
  // Every `<` is escaped (`\<`), so no unescaped `<img` can survive.
  assert.ok(content.includes("\\<img"), "the HTML angle bracket must be markdown-escaped");
  assert.ok(!/(?<!\\)<img/.test(content), "no unescaped <img may survive into the report");
  assert.ok(content.includes("**Description**"), "description bullet renders");
  // The description renders on a single line (no injected report lines).
  const descriptionLine = content.split("\n").find((line) => line.includes("**Description**"));
  assert.ok(
    descriptionLine && descriptionLine.includes("top line"),
    "description must stay on one line",
  );
  assert.ok(!descriptionLine.includes("\n"), "description must not contain a newline");
});
