// Single source of truth for the secret-token families shared between the
// deep security scanner (detection) and the report redactors (span redaction).
// F-025: the redaction vocabulary must never lag the scanner's detection
// vocabulary — the challenger verified `sk_live_…`, `xoxb-…`, `eyJ…` JWTs and
// `npm_…` passed through the sanitizer unredacted while the scanner detects
// exactly these families.
//
// Each entry is `{ name, re }` where `re` matches the full token span. The
// scanner uses `re.test` (presence); redactors build a per-family global
// copy for span replacement. Patterns are deliberately non-catastrophic
// (bounded literals / character classes, no nested quantifiers).
//
// ESM only. Zero npm deps. Pure DATA; no side effects on import.
export const SECRET_TOKEN_FAMILIES = Object.freeze([
  // F-003: prefix tokens accept the common env-var casings (UPPER, lower,
  // Mixed) via per-character classes while the VALUE groups stay
  // exact-case (uppercase/digits for access keys, base64 for secrets), so
  // prose like "aws access key id management" cannot match.
  {
    name: "AWS Access Key",
    re: /(?:AWS|aws)[_-]?[Aa][Cc][Cc][Ee][Ss][Ss][_-]?[Kk][Ee][Yy][_-]?(?:[Ii][Dd])?["'\s:=]+([A-Z0-9]{20})/,
  },
  {
    name: "AWS Secret Key",
    re: /(?:AWS|aws)[_-]?[Ss][Ee][Cc][Rr][Ee][Tt][_-]?(?:[Aa][Cc][Cc][Ee][Ss][Ss][_-]?)?[Kk][Ee][Yy][_-]?(?:[Ii][Dd])?["'\s:=]+([A-Za-z0-9/+=]{40})/,
  },
  {
    name: "GitHub Token",
    re: /(?:ghp|gho|ghu|ghs|ghr|github[_-]?pat)[_-\w]*["'\s:=]+([A-Za-z0-9_]{36,})/,
  },
  {
    name: "Generic API Key",
    re: /(?:api[_-]?key|apikey|API_KEY)["'\s:=]+\s*['"]([A-Za-z0-9_-]{20,})['"]/i,
  },
  {
    name: "Generic Token",
    re: /(?:token|secret|password|passwd)["'\s:=]+\s*['"]([^\s'"]{16,})['"]\s*$/im,
  },
  { name: "Private Key Header", re: /-----BEGIN[ ](?:RSA |EC |DSA |OPENSSH )?PRIVATE[ ]KEY-----/ },
  { name: "JWT Token", re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "Slack Token", re: /xox[abpos]-[\d]+-[\d]+-[\d]+-[A-Za-z0-9]+/ },
  { name: "Stripe Key", re: /(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{24,}/ },
  {
    name: "Heroku API Key",
    re: /[Hh][Ee][Rr][Oo][Kk][Uu][_\s-]*[Aa][Pp][Ii][_\s-]*[Kk][Ee][Yy]["'\s:=]+\s*['"]([A-Za-z0-9_-]{16,})['"]/,
  },
  { name: "MongoDB URI", re: /mongodb(?:\+srv)?:\/\/[^'"\s]+/i },
  { name: "Postgres URI", re: /postgres(?:ql)?:\/\/[^:]+:[^@]+@[^'"\s]+/i },
  { name: "Redis URI", re: /redis:\/\/[^'"\s]+/i },
  { name: "Basic Auth URL", re: /https?:\/\/[^:]+:[^@]+@[^'"\s]+/i },
  { name: "NPM Token", re: /npm_[A-Za-z0-9]{36}/ },
  {
    name: "Docker Registry Password",
    re: /(?:docker|registry)[_\s-]*(?:password|pass|pwd)["'\s:=]+\s*['"]([^'"]{8,})['"]/i,
  },
]);

/**
 * Build a global-flag copy of a family regex so a single-family span
 * redaction can replace every occurrence. Preserves the original flags and
 * adds `g` (a family already carrying `g` is returned as-is).
 * @param {RegExp} re
 * @returns {RegExp}
 */
export function spanMatcher(re) {
  if (re.global) return re;
  return new RegExp(re.source, `${re.flags}g`);
}
