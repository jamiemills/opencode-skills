import test from "node:test";
import assert from "node:assert/strict";
import { textExpression, htmlExpression } from "../../lib/verbs/dom.mjs";
import { parseUrlArgs } from "../../lib/verbs/nav.mjs";

test("text verb uses documented textContent and escapes selectors", () => {
  assert.match(textExpression(), /document\.body\?\.textContent/);
  assert.match(textExpression("#a'b\\c"), /textContent/);
  assert.ok(textExpression("#a'b\\c").includes("#a\\'b\\\\c"));
  assert.ok(!textExpression("#a'b\\c").includes("innerText"));
});

test("html verb returns outerHTML for a selector", () => {
  assert.equal(htmlExpression("main"), "document.querySelector('main')?.outerHTML || ''");
  assert.equal(htmlExpression(), "document.documentElement.outerHTML");
});

test("navigation accepts positional and --url forms", () => {
  assert.equal(parseUrlArgs(["https://example.test"]), "https://example.test");
  assert.equal(parseUrlArgs(["--url", "https://example.test"]), "https://example.test");
  assert.equal(parseUrlArgs(["--session", "sid", "https://example.test"]), "https://example.test");
});
