"use strict";

import {
  SECRET_TOKEN_FAMILIES,
  spanMatcher,
} from "../../../csm-scan/lib/scan/shared/token-families.mjs";

const ABSOLUTE_PATH_RE =
  /(?:[A-Za-z]:\\[^\s"'`,;)\]]+|(?:\/(?:home|Users|tmp|var|etc|opt|usr)\/[^\s"'`,;)\]]+))/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SECRET_TOKEN_RE =
  /(?:sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/g;
const ASSIGN_SECRET_RE =
  /^\s*(?:[A-Z0-9_]*?(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*=\s*(.+)$/gm;
const WEBHOOK_TOKEN_RE =
  /https?:\/\/hooks\.[^/\s]+\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9_-]{8,}/g;

export function redactText(text) {
  let out = String(text);
  out = out.replace(ABSOLUTE_PATH_RE, "<redacted-path>");
  out = out.replace(EMAIL_RE, "<redacted-email>");
  out = out.replace(SECRET_TOKEN_RE, "<redacted-secret>");
  for (const { re } of SECRET_TOKEN_FAMILIES) {
    out = out.replace(spanMatcher(re), "<redacted-secret>");
  }
  out = out.replace(WEBHOOK_TOKEN_RE, "<redacted-secret>");
  out = out.replace(
    ASSIGN_SECRET_RE,
    (_m, value) => `${_m.slice(0, _m.indexOf(value))}<redacted-secret>`,
  );
  return out;
}

export function containsAbsoluteRootPath(text) {
  const hit = String(text).match(/^(?:[A-Za-z]:\\|\/(?:home|Users|tmp|var|etc|opt|usr)\/)/m);
  return hit !== null;
}

export function redactEvidenceRecords(records) {
  return records.map((record) => ({
    ...record,
    locator: redactText(record.locator),
    matchedKey: redactText(record.matchedKey),
  }));
}
