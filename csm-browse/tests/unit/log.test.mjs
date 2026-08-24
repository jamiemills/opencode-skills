import test from "node:test";
import assert from "node:assert/strict";
import {
  compileNetworkFilter,
  maskCookieValue,
  projectCookies,
  MAX_NETWORK_FILTER_LENGTH,
} from "../../lib/verbs/log.mjs";

// F-062: cookie values are session credentials. The default `log cookies`
// output must never carry a full value; only the explicit --values opt-in
// (projectCookies revealValues) passes values through unchanged.

test("maskCookieValue: short values (<= 8 chars) collapse to ****", () => {
  assert.equal(maskCookieValue("a"), "****");
  assert.equal(maskCookieValue("abcd"), "****");
  assert.equal(maskCookieValue("abcd1234"), "****", "exactly 8 chars still masks fully");
});

test("maskCookieValue: long values keep only first4…last4", () => {
  assert.equal(maskCookieValue("abcd12345"), "abcd…2345", "9-char value");
  assert.equal(
    maskCookieValue("session=eyJ\x68bGciOiJIUzI1NiJ9.payload.sig-here"),
    "sess…here",
    "a realistic session token keeps only the ends",
  );
});

test("maskCookieValue: non-string and empty edge cases never throw or leak", () => {
  assert.equal(maskCookieValue(""), "");
  assert.equal(maskCookieValue(null), "");
  assert.equal(maskCookieValue(undefined), "");
  assert.equal(maskCookieValue(12345678), "");
  assert.equal(maskCookieValue({ value: "secret" }), "");
  assert.equal(maskCookieValue(["secret"]), "");
});

const COOKIES = [
  {
    name: "sid",
    domain: "example.test",
    path: "/",
    value: "super-secret-session-token-42",
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
    session: false,
    expires: 1700000000,
  },
  {
    name: "short",
    domain: "example.test",
    path: "/",
    value: "tiny",
    secure: false,
    httpOnly: false,
    session: true,
  },
];

test("projectCookies default: every value is masked, metadata survives", () => {
  const masked = projectCookies(COOKIES);
  assert.equal(masked.length, 2);
  assert.equal(masked[0].value, "supe…n-42");
  assert.equal(masked[1].value, "****");
  assert.equal(masked[0].name, "sid");
  assert.equal(masked[0].domain, "example.test");
  assert.equal(masked[0].httpOnly, true);
  assert.equal(masked[0].secure, true);
  assert.equal(masked[0].sameSite, "Lax");
  assert.equal(masked[0].expires, 1700000000);
  assert.equal(masked[1].session, true);
  for (const c of masked) {
    assert.ok(!c.value.includes("secret"), "no masked value may leak the credential body");
  }
});

test("projectCookies revealValues (--values opt-in): values pass through unchanged", () => {
  const revealed = projectCookies(COOKIES, { revealValues: true });
  assert.equal(revealed, COOKIES, "the opt-in returns the cookies untouched");
  assert.equal(revealed[0].value, "super-secret-session-token-42");
  assert.equal(revealed[1].value, "tiny");
});

test("projectCookies default never mutates the source cookies", () => {
  const source = [
    { name: "x", domain: "d", path: "/", value: "abcdefghi", secure: 1, httpOnly: 0, session: 1 },
  ];
  projectCookies(source);
  assert.equal(source[0].value, "abcdefghi", "the caller-provided cookie keeps its raw value");
});

test("compileNetworkFilter rejects malformed regexes with a CLI-safe error", () => {
  assert.throws(() => compileNetworkFilter("["), /invalid --filter regex/);
  assert.throws(
    () => compileNetworkFilter("x".repeat(MAX_NETWORK_FILTER_LENGTH + 1)),
    /at most 256/,
  );
});

test("compileNetworkFilter preserves case-insensitive URL matching for valid filters", () => {
  assert.equal(compileNetworkFilter("api/example").test("https://EXAMPLE.test/API/Example"), true);
});
