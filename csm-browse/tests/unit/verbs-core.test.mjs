import test from "node:test";
import assert from "node:assert/strict";
import { textExpression, htmlExpression, hasSensitiveAuthorization } from "../../lib/verbs/dom.mjs";
import {
  parseUrlArgs,
  assertAllowedNavigationUrl,
  redactNavigationOutputUrl,
} from "../../lib/verbs/nav.mjs";
import { typedResult } from "../../lib/verbs/input.mjs";

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

test("navigation allows only http and https URLs", () => {
  assert.equal(assertAllowedNavigationUrl("HTTP://example.test/a"), "http://example.test/a");
  assert.equal(assertAllowedNavigationUrl("https://example.test"), "https://example.test/");
  for (const url of ["javascript:alert(1)", "file:///tmp/secret", "data:text/plain,secret"]) {
    assert.throws(() => assertAllowedNavigationUrl(url), /protocol is not allowed/);
  }
  assert.throws(() => assertAllowedNavigationUrl("not a URL"), /Invalid URL/);
  assert.throws(
    () => assertAllowedNavigationUrl("not-a-url?token=secret#fragment"),
    (error) => error.message === "Invalid URL" && !error.message.includes("secret"),
  );
});

test("navigation output strips userinfo, query, and fragment", () => {
  assert.equal(
    redactNavigationOutputUrl("https://user:secret@example.test/path?token=secret#fragment"),
    "https://example.test/",
  );
});

test("sensitive DOM operations require explicit authorization", () => {
  assert.equal(hasSensitiveAuthorization(["main"]), false);
  assert.equal(hasSensitiveAuthorization(["main", "--allow-sensitive"]), true);
  assert.deepEqual(typedResult("#password"), { typed: true, selector: "#password" });
  assert.equal(JSON.stringify(typedResult("#password")).includes("secret"), false);
});
