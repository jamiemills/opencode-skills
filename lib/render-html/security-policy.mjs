"use strict";

export const HTML_RENDERER = Object.freeze({ id: "csm-render-html/1", revision: 1 });
export const HTML_MEDIA_TYPE = "text/html";
export const HTML_CSP =
  "default-src 'none'; base-uri 'none'; connect-src 'none'; font-src 'none'; form-action 'none'; frame-ancestors 'none'; img-src 'none'; object-src 'none'; script-src 'none'; style-src 'none'";

export const ALLOWED_ELEMENTS = Object.freeze([
  "article",
  "code",
  "dd",
  "dl",
  "dt",
  "h1",
  "h2",
  "head",
  "html",
  "li",
  "main",
  "meta",
  "ol",
  "p",
  "pre",
  "section",
  "title",
  "ul",
  "a",
  "body",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "span",
]);

export const ALLOWED_ATTRIBUTES = Object.freeze([
  "aria-label",
  "aria-labelledby",
  "class",
  "charset",
  "content",
  "href",
  "http-equiv",
  "id",
  "lang",
  "name",
  "rel",
  "role",
  "scope",
]);

export const HTML_VOID_ELEMENTS = Object.freeze(["meta"]);

export const HTML_RENDERER_POLICY = Object.freeze({
  csp: HTML_CSP,
  allowedElements: ALLOWED_ELEMENTS,
  allowedAttributes: ALLOWED_ATTRIBUTES,
  voidElements: HTML_VOID_ELEMENTS,
});

export function validateUrlPolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy))
    throw new TypeError("validated profile URL policy is required");
  if (!["deny", "allowlist"].includes(policy.mode))
    throw new TypeError("invalid profile URL policy mode");
  if (
    !Array.isArray(policy.schemes) ||
    policy.schemes.some((scheme) => !["http", "https"].includes(scheme))
  )
    throw new TypeError("invalid profile URL policy schemes");
  return policy;
}
