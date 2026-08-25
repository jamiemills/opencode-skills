"use strict";

import {
  SECRET_TOKEN_FAMILIES,
  spanMatcher,
} from "../../../csm-scan/lib/scan/shared/token-families.mjs";

const ABSOLUTE_PATH_RE = /(?:[A-Za-z]:\\[^\s"'`,;)\]]+|(?<![A-Za-z0-9/])\/(?!\/)[^\s"'`,;)\]]+)/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SECRET_TOKEN_RE =
  /(?:sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/g;
const ASSIGN_SECRET_RE =
  /^\s*(?:[A-Z0-9_]*?(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*=\s*(.+)$/gm;
const WEBHOOK_TOKEN_RE =
  /https?:\/\/hooks\.[^/\s]+\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9_-]{8,}/g;
const HANDLE_RE = /@[A-Za-z0-9][A-Za-z0-9_.-]{1,63}/g;

export const PRIVACY_LIMITS = Object.freeze({
  maxStringBytes: 4096,
  maxCollectionItems: 200,
  maxDepth: 8,
});

export function redactText(text) {
  let out = String(text);
  out = out.replace(ABSOLUTE_PATH_RE, "<redacted-path>");
  out = out.replace(EMAIL_RE, "<redacted-email>");
  out = out.replace(SECRET_TOKEN_RE, "<redacted-secret>");
  for (const { re } of SECRET_TOKEN_FAMILIES) {
    out = out.replace(spanMatcher(re), "<redacted-secret>");
  }
  out = out.replace(WEBHOOK_TOKEN_RE, "<redacted-secret>");
  out = out.replace(HANDLE_RE, "<redacted-identity>");
  out = out.replace(
    ASSIGN_SECRET_RE,
    (_m, value) => `${_m.slice(0, _m.indexOf(value))}<redacted-secret>`,
  );
  return out;
}

function boundedText(value, limits) {
  let text = redactText(value);
  if (Buffer.byteLength(text, "utf8") <= limits.maxStringBytes) return text;
  const suffix = "<redacted-oversize>";
  const budget = Math.max(0, limits.maxStringBytes - Buffer.byteLength(suffix, "utf8"));
  while (Buffer.byteLength(text, "utf8") > budget) text = text.slice(0, -1);
  return `${text}${suffix}`;
}

function serializeValue(value, limits, depth, seen) {
  if (typeof value === "string") return boundedText(value, limits);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "object" || depth >= limits.maxDepth || seen.has(value)) {
    return "<redacted-unsupported>";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value
      .slice(0, limits.maxCollectionItems)
      .map((item) => serializeValue(item, limits, depth + 1, seen));
  }
  const out = {};
  for (const [key, item] of Object.entries(value).slice(0, limits.maxCollectionItems)) {
    out[boundedText(key, limits)] = serializeValue(item, limits, depth + 1, seen);
  }
  seen.delete(value);
  return out;
}

// The single funnel for values that can cross into a DDD report or graph.
export function serializePrivacy(value, options = {}) {
  const limits = { ...PRIVACY_LIMITS, ...options };
  return serializeValue(value, limits, 0, new WeakSet());
}

export function containsAbsoluteRootPath(text) {
  const hit = String(text).match(/^(?:[A-Za-z]:\\|\/(?:home|Users|tmp|var|etc|opt|usr)\/)/m);
  return hit !== null;
}

export function redactEvidenceRecords(records) {
  return serializePrivacy(records);
}
