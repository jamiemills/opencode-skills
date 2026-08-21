// Cross-cutting detection tables.
//
// Single declarative source of truth for the dependency-name -> human label
// mappings used by the deep scanners (architecture/security/operations). Every
// table is keyed by ecosystem id (python, javascript, typescript, rust, shell)
// so Rust/Shell projects finally get DB/security/monitoring nodes instead of
// the historic JS/Python-only behaviour.
//
// Replaces the ad-hoc JS-only maps that previously lived inline in:
//   - architecture.mjs:detectDatabases / detectExternalApis (C4 nodes)
//   - security.mjs:AUTH_PACKAGES / VALIDATION_PACKAGES / RATE_LIMIT_PACKAGES
//   - operations.mjs:detectMonitoring
//
// ESM only. Zero npm deps. node: builtins only. Pure DATA + one helper; no
// filesystem or network access, no side effects on import.

import { compareAscii, deepFreeze } from "../contracts/evidence.mjs";
import { createProviderResult } from "../providers/base.mjs";

// ---------------------------------------------------------------------------
// Value shape contract
// ---------------------------------------------------------------------------
// Every entry is `{ label: string, type?: string }`.
//   - label : human-readable name shown in diagrams / reports.
//   - type  : optional category hint consumed by scanners.
//
// Key conventions:
//   - Keys are dependency names as they appear in manifests
//     (package.json "dependencies", pyproject [project.dependencies],
//     Cargo.toml [dependencies], etc.).
//   - A key ending in `*` is a PREFIX pattern: matchDep() treats the part
//     before the trailing `*` as a startsWith() stem. Used for families that
//     ship many packages under one org prefix (google-cloud-*, aws-sdk-*,
//     opentelemetry-*, @opentelemetry/*).

// ===========================================================================
// DATABASE_INDICATORS
// ===========================================================================

const DB_PY = {
  sqlalchemy: { label: "SQLAlchemy", type: "ORM" },
  psycopg2: { label: "psycopg", type: "Driver" },
  psycopg: { label: "psycopg", type: "Driver" },
  asyncpg: { label: "asyncpg", type: "Driver" },
  aiomysql: { label: "aiomysql", type: "Driver" },
  pymongo: { label: "PyMongo", type: "Driver" },
  motor: { label: "Motor", type: "Driver" },
  redis: { label: "redis-py", type: "Cache/Store" },
  "tortoise-orm": { label: "Tortoise ORM", type: "ORM" },
  databases: { label: "databases", type: "SQL library" },
  sqlmodel: { label: "SQLModel", type: "ORM" },
};

const DB_JS = {
  mongoose: { label: "MongoDB (Mongoose)", type: "ODM" },
  mongodb: { label: "MongoDB", type: "Driver" },
  sequelize: { label: "Sequelize", type: "ORM" },
  prisma: { label: "Prisma", type: "ORM" },
  "@prisma/client": { label: "Prisma", type: "ORM" },
  knex: { label: "Knex", type: "SQL builder" },
  typeorm: { label: "TypeORM", type: "ORM" },
  drizzle: { label: "Drizzle ORM", type: "ORM" },
  "drizzle-orm": { label: "Drizzle ORM", type: "ORM" },
  pg: { label: "PostgreSQL (pg)", type: "Driver" },
  mysql2: { label: "MySQL (mysql2)", type: "Driver" },
  redis: { label: "Redis", type: "Cache/Store" },
  ioredis: { label: "Redis (ioredis)", type: "Cache/Store" },
  "better-sqlite3": { label: "SQLite (better-sqlite3)", type: "Driver" },
  sqlite3: { label: "SQLite (sqlite3)", type: "Driver" },
  nano: { label: "CouchDB (nano)", type: "Driver" },
};

const DB_RS = {
  sqlx: { label: "SQLx", type: "Driver/ORM" },
  diesel: { label: "Diesel", type: "ORM" },
  rusqlite: { label: "rusqlite", type: "Driver" },
  "sea-orm": { label: "SeaORM", type: "ORM" },
  "tokio-postgres": { label: "tokio-postgres", type: "Driver" },
  redis: { label: "redis", type: "Cache/Store" },
  surrealdb: { label: "SurrealDB", type: "Driver" },
  refinery: { label: "Refinery", type: "Migration" },
};

export const DATABASE_INDICATORS = {
  python: DB_PY,
  javascript: DB_JS,
  typescript: { ...DB_JS }, // TS inherits the JS package ecosystem
  rust: DB_RS,
  shell: {}, // n/a
};

// ===========================================================================
// EXTERNAL_API_INDICATORS
// ===========================================================================

const API_PY = {
  anthropic: { label: "Anthropic API", type: "AI provider" },
  openai: { label: "OpenAI API", type: "AI provider" },
  boto3: { label: "AWS (boto3)", type: "Cloud SDK" },
  "google-cloud-storage": { label: "GCP (storage)", type: "Cloud SDK" },
  "google-cloud-pubsub": { label: "GCP (pubsub)", type: "Cloud SDK" },
  "google-cloud-bigquery": { label: "GCP (bigquery)", type: "Cloud SDK" },
  "google-cloud-*": { label: "GCP", type: "Cloud SDK" }, // prefix matcher
  requests: { label: "requests", type: "HTTP client" },
  httpx: { label: "HTTPX", type: "HTTP client" },
  twilio: { label: "Twilio", type: "Comms" },
  stripe: { label: "Stripe", type: "Payments" },
};

const API_JS = {
  axios: { label: "axios", type: "HTTP client" },
  fetch: { label: "fetch", type: "HTTP client (builtin marker)" },
  "node-fetch": { label: "node-fetch", type: "HTTP client" },
  "@grpc/grpc-js": { label: "gRPC (grpc-js)", type: "RPC" },
  "aws-sdk": { label: "AWS SDK", type: "Cloud SDK" },
  "aws-sdk-*": { label: "AWS SDK", type: "Cloud SDK" }, // prefix matcher
  stripe: { label: "Stripe", type: "Payments" },
  twilio: { label: "Twilio", type: "Comms" },
  // Also surfaced for architecture/C4 parity (already referenced by
  // architecture.mjs:detectExternalApis).
  openai: { label: "OpenAI API", type: "AI provider" },
  "@anthropic-ai/sdk": { label: "Anthropic API", type: "AI provider" },
};

const API_RS = {
  reqwest: { label: "reqwest", type: "HTTP client" },
  hyper: { label: "hyper", type: "HTTP client" },
  "aws-sdk-*": { label: "AWS SDK", type: "Cloud SDK" }, // prefix matcher
  tonic: { label: "tonic (gRPC)", type: "RPC" },
};

export const EXTERNAL_API_INDICATORS = {
  python: API_PY,
  javascript: API_JS,
  typescript: { ...API_JS },
  rust: API_RS,
  shell: {}, // n/a
};

// ===========================================================================
// AUTH_LIBS
// ===========================================================================

const AUTH_PY = {
  "flask-login": { label: "Flask-Login", type: "Session" },
  // F-030: framework-level entries are surfaced as a distinct capability
  // category, never as verified auth — depending on Django does not prove
  // `django.contrib.auth` is used. They cannot lift the security signal.
  django: { label: "Django (contrib.auth)", type: "Capability" },
  passlib: { label: "Passlib", type: "Hashing" },
  "python-jose": { label: "python-jose", type: "JWT" },
  jose: { label: "jose", type: "JWT" },
  authlib: { label: "AuthLib", type: "OAuth/JWT" },
  itsdangerous: { label: "itsdangerous", type: "Signing" },
  fastapi: { label: "FastAPI (security)", type: "Capability" },
  auth0: { label: "Auth0", type: "Identity provider" },
};

const AUTH_JS = {
  // Preserved verbatim from security.mjs:AUTH_PACKAGES so T109 maps cleanly.
  passport: { label: "Passport.js", type: "Framework auth" },
  "next-auth": { label: "NextAuth.js", type: "Framework auth" },
  "@auth/core": { label: "Auth.js", type: "Framework auth" },
  jsonwebtoken: { label: "JWT (jsonwebtoken)", type: "JWT" },
  jose: { label: "JWT (jose)", type: "JWT" },
  bcrypt: { label: "bcrypt", type: "Hashing" },
  bcryptjs: { label: "bcryptjs", type: "Hashing" },
  argon2: { label: "Argon2", type: "Hashing" },
  "express-session": { label: "Express Session", type: "Session" },
  clerk: { label: "Clerk", type: "Identity provider" },
  "@clerk": { label: "Clerk", type: "Identity provider" },
  auth0: { label: "Auth0", type: "Identity provider" },
  // Additional names retained from security.mjs for T109 continuity.
  "cookie-parser": { label: "Cookie-based auth", type: "Session/Cookies" },
  "openid-client": { label: "OpenID Client", type: "OpenID Connect" },
  "express-openid-connect": { label: "OpenID Connect", type: "OpenID Connect" },
};

const AUTH_RS = {
  argon2: { label: "argon2", type: "Hashing" },
  bcrypt: { label: "bcrypt", type: "Hashing" },
  jsonwebtoken: { label: "jsonwebtoken", type: "JWT" },
  jwt: { label: "jwt", type: "JWT" },
  oauth2: { label: "oauth2", type: "OAuth" },
  tonic: { label: "tonic (auth/interceptors)", type: "RPC auth" },
};

export const AUTH_LIBS = {
  python: AUTH_PY,
  javascript: AUTH_JS,
  typescript: { ...AUTH_JS },
  rust: AUTH_RS,
  shell: {}, // n/a
};

// ===========================================================================
// INPUT_VALIDATION_LIBS
// ===========================================================================

const VAL_PY = {
  pydantic: { label: "Pydantic", type: "Validation" },
  marshmallow: { label: "Marshmallow", type: "Validation" },
  cerberus: { label: "Cerberus", type: "Validation" },
  voluptuous: { label: "Voluptuous", type: "Validation" },
  colander: { label: "Colander", type: "Validation" },
  // F-030: a django dependency does not prove Django forms are used for
  // input validation; it stays a capability, never verified validation.
  django: { label: "Django (forms)", type: "Capability" },
};

const VAL_JS = {
  zod: { label: "Zod", type: "Validation" },
  joi: { label: "Joi", type: "Validation" },
  yup: { label: "Yup", type: "Validation" },
  "class-validator": { label: "class-validator", type: "Validation" },
  "@vinejs/vine": { label: "VineJS", type: "Validation" },
  ajv: { label: "AJV (JSON Schema)", type: "Validation" },
  superstruct: { label: "Superstruct", type: "Validation" },
  "io-ts": { label: "io-ts", type: "Validation" },
  valibot: { label: "Valibot", type: "Validation" },
  "express-validator": { label: "express-validator", type: "Validation" },
};

const VAL_RS = {
  validator: { label: "validator", type: "Validation" },
  garde: { label: "garde", type: "Validation" },
};

export const INPUT_VALIDATION_LIBS = {
  python: VAL_PY,
  javascript: VAL_JS,
  typescript: { ...VAL_JS },
  rust: VAL_RS,
  shell: {}, // n/a
};

// ===========================================================================
// RATE_LIMIT_LIBS
// ===========================================================================

const RL_PY = {
  slowapi: { label: "SlowAPI", type: "Rate limit" },
  "flask-limiter": { label: "Flask-Limiter", type: "Rate limit" },
  "django-ratelimit": { label: "django-ratelimit", type: "Rate limit" },
};

const RL_JS = {
  "express-rate-limit": { label: "express-rate-limit", type: "Rate limit" },
  "rate-limiter-flexible": { label: "rate-limiter-flexible", type: "Rate limit" },
  "@upstash/ratelimit": { label: "Upstash Rate Limit", type: "Rate limit" },
  bottleneck: { label: "Bottleneck", type: "Rate limit/Concurrency" },
};

const RL_RS = {
  governor: { label: "governor", type: "Rate limit" },
  tower: { label: "tower::limit", type: "Middleware rate limit" }, // tower crate's limit layer
  "leaky-bucket": { label: "leaky-bucket", type: "Rate limit" },
};

export const RATE_LIMIT_LIBS = {
  python: RL_PY,
  javascript: RL_JS,
  typescript: { ...RL_JS },
  rust: RL_RS,
  shell: {}, // n/a
};

// ===========================================================================
// MONITORING_LIBS
// ===========================================================================

const MON_PY = {
  structlog: { label: "structlog", type: "Logging" },
  loguru: { label: "Loguru", type: "Logging" },
  "sentry-sdk": { label: "Sentry (sentry-sdk)", type: "Error tracking" },
  "prometheus-client": { label: "prometheus-client", type: "Metrics" },
  "opentelemetry-api": { label: "OpenTelemetry", type: "Observability" },
  "opentelemetry-sdk": { label: "OpenTelemetry", type: "Observability" },
  "opentelemetry-*": { label: "OpenTelemetry", type: "Observability" }, // prefix matcher
  datadog: { label: "datadog", type: "Monitoring" },
  ddtrace: { label: "ddtrace", type: "APM" },
};

const MON_JS = {
  winston: { label: "Winston", type: "Logging" },
  pino: { label: "Pino", type: "Logging" },
  bunyan: { label: "Bunyan", type: "Logging" },
  "@sentry/node": { label: "Sentry (@sentry/node)", type: "Error tracking" },
  sentry: { label: "Sentry", type: "Error tracking" },
  "@opentelemetry/api": { label: "OpenTelemetry", type: "Observability" },
  "@opentelemetry/*": { label: "OpenTelemetry", type: "Observability" }, // prefix matcher
  "prom-client": { label: "prom-client", type: "Metrics" },
  datadog: { label: "Datadog", type: "Monitoring" },
  "dd-trace": { label: "Datadog APM", type: "APM" }, // parity with operations.mjs
};

const MON_RS = {
  tracing: { label: "tracing", type: "Logging/Tracing" },
  "tracing-subscriber": { label: "tracing-subscriber", type: "Logging" },
  opentelemetry: { label: "OpenTelemetry", type: "Observability" },
  sentry: { label: "sentry", type: "Error tracking" },
  metrics: { label: "metrics", type: "Metrics" },
  slog: { label: "slog", type: "Logging" },
  log: { label: "log", type: "Logging" },
};

export const MONITORING_LIBS = {
  python: MON_PY,
  javascript: MON_JS,
  typescript: { ...MON_JS },
  rust: MON_RS,
  shell: {}, // n/a
};

// ===========================================================================
// AUDIT_TOOLS  (security tooling, dep/command-name keyed, all ecosystems)
// ===========================================================================
// Cross-language scanners (semgrep, trufflehog, snyk, osv-scanner, gosec) are
// intentionally repeated in every ecosystem: they are CLIs that may be wired
// into any repo's CI regardless of primary language. `gosec` targets Go files
// specifically but is listed everywhere so a scanner can flag it wherever it
// appears (e.g. a mixed-language monorepo).

const AUDIT_CROSS_CUTTING = {
  semgrep: { label: "Semgrep", type: "SAST" },
  trufflehog: { label: "TruffleHog", type: "Secret scanning" },
  snyk: { label: "Snyk", type: "Dependency audit / SAST" },
  "osv-scanner": { label: "OSV-Scanner", type: "Dependency audit" },
  gosec: { label: "gosec", type: "SAST (Go)" },
};

const AUDIT_PY = {
  ...AUDIT_CROSS_CUTTING,
  "pip-audit": { label: "pip-audit", type: "Dependency audit" },
  safety: { label: "safety", type: "Dependency audit" },
  bandit: { label: "Bandit", type: "SAST" },
};

const AUDIT_JS = {
  ...AUDIT_CROSS_CUTTING,
  "npm-audit": { label: "npm audit", type: "Dependency audit (marker)" },
};

const AUDIT_RS = {
  ...AUDIT_CROSS_CUTTING,
  "cargo-audit": { label: "cargo-audit", type: "Dependency audit" },
  "cargo-deny": { label: "cargo-deny", type: "Supply chain / license" },
  rustsec: { label: "RustSec", type: "Advisory DB" },
};

export const AUDIT_TOOLS = {
  python: AUDIT_PY,
  javascript: AUDIT_JS,
  typescript: { ...AUDIT_JS },
  rust: AUDIT_RS,
  shell: { ...AUDIT_CROSS_CUTTING }, // cross-language scanners apply to shell repos
};

// ===========================================================================
// PRACTICE_TOOLS  (development-practice tooling, tool-name keyed)
// ===========================================================================
// Consumed by the practices dimension scanner and its provider adapter
// (`lib/scan/providers/practices.mjs`) when matching committed tool names in
// manifests, workflow steps, and hook configs. Unlike the ecosystem-keyed
// tables above, keys are tool names directly (a tool may appear in any
// ecosystem), so this is a single flat map of `{ label, type }` entries.

export const PRACTICE_TOOLS = Object.freeze({
  mutmut: { label: "Mutmut", type: "Mutation testing" },
  hypothesis: { label: "Hypothesis", type: "Property-based testing" },
  atheris: { label: "Atheris", type: "Fuzz testing" },
  "diff-cover": { label: "diff-cover", type: "Coverage gate" },
  "import-linter": { label: "import-linter", type: "Dependency lint" },
  deptry: { label: "deptry", type: "Dependency lint" },
  vulture: { label: "Vulture", type: "Dead code" },
  actionlint: { label: "actionlint", type: "Workflow lint" },
  commitlint: { label: "commitlint", type: "Commit lint" },
  gitlint: { label: "gitlint", type: "Commit lint" },
  "semantic-release": { label: "semantic-release", type: "Release automation" },
  "release-please": { label: "release-please", type: "Release automation" },
  renovate: { label: "Renovate", type: "Dependency automation" },
  sphinx: { label: "Sphinx", type: "Documentation" },
  mkdocs: { label: "MkDocs", type: "Documentation" },
  docusaurus: { label: "Docusaurus", type: "Documentation" },
  "pre-commit": { label: "pre-commit", type: "Hook runner" },
  lefthook: { label: "Lefthook", type: "Hook runner" },
  bandit: { label: "Bandit", type: "Security lint" },
  radon: { label: "Radon", type: "Complexity" },
  "eslint-config-airbnb": { label: "eslint-config-airbnb", type: "Style guide" },
  black: { label: "Black", type: "Formatter" },
  prettier: { label: "Prettier", type: "Formatter" },
});

// ===========================================================================
// Helpers
// ===========================================================================

const PYTHON_DETECTION_MAPS = new WeakSet([
  DB_PY,
  API_PY,
  AUTH_PY,
  VAL_PY,
  RL_PY,
  MON_PY,
  AUDIT_PY,
]);

function normalizeDepNames(deps) {
  if (!deps) return [];
  if (Array.isArray(deps)) {
    return deps.filter((d) => typeof d === "string" && d.length > 0);
  }
  if (typeof deps === "object") {
    return Object.keys(deps).filter((k) => typeof k === "string" && k.length > 0);
  }
  return [];
}

function normalizeDepName(name, pep503) {
  const lower = name.toLowerCase();
  return pep503 ? lower.replace(/[._-]+/g, "-") : lower;
}

/**
 * Match a set of dependency names against an ecosystem-keyed detection table.
 *
 * Callers pass an ECOSYSTEM SUB-OBJECT (e.g. `DATABASE_INDICATORS.rust`), not
 * the whole map. For ecosystem-aware lookups, resolve the sub-object first:
 *
 *     const hits = matchDep(pkgDeps, DATABASE_INDICATORS[eco] || {});
 *
 * @param {string[] | Record<string, unknown>} deps
 *   Either an array of dependency name strings, or a manifest deps object
 *   (`{ name: version }`), e.g. `pkg.dependencies` or a merge of
 *   `dependencies` + `devDependencies`.
 * @param {Record<string, { label: string, type?: string }>} map
 *   An ecosystem sub-object from one of the exported tables. Keys are exact
 *   dependency names; a trailing `*` denotes a prefix pattern.
 * @param {'python'} [mode]
 *   Use Python PEP 503 separator normalization for a custom map. Exported
 *   Python sub-objects are recognized automatically.
 * @returns {{ name: string, label: string, type?: string }[]}
 *   One entry per normalized dependency, in input order, de-duplicated. Each
 *   entry preserves the first matched dependency spelling in `name` plus the
 *   table's `label` and optional `type`. Returns `[]` for empty/null/unknown
 *   input (never throws).
 */
export function matchDep(deps, map, mode) {
  const sub = map && typeof map === "object" ? map : {};
  const names = normalizeDepNames(deps);
  const pep503 = mode === "python" || PYTHON_DETECTION_MAPS.has(sub);

  const exact = new Map();
  const prefixes = [];
  for (const [key, val] of Object.entries(sub)) {
    if (typeof key !== "string" || !key) continue;
    if (key.endsWith("*")) {
      prefixes.push({ stem: normalizeDepName(key.slice(0, -1), pep503), val });
    } else {
      exact.set(normalizeDepName(key, pep503), val);
    }
  }

  const out = [];
  const seen = new Set();
  for (const name of names) {
    const normalizedName = normalizeDepName(name, pep503);
    if (seen.has(normalizedName)) continue;
    seen.add(normalizedName);
    let val = exact.get(normalizedName);
    if (!val) {
      for (const p of prefixes) {
        if (normalizedName.startsWith(p.stem)) {
          val = p.val;
          break;
        }
      }
    }
    if (val) {
      out.push({ name, label: val.label, ...(val.type ? { type: val.type } : {}) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// T210 provider contribution point
// ---------------------------------------------------------------------------
// `detectionObservations` / `detectionProviderResult` expose the detection
// tables as inert provider observations keyed to the provider dimensions that
// consume them. They are ADDITIVE: the exported tables and `matchDep` are
// unchanged, so the focused detection tests stay byte-identical. Only
// categories allowlisted for each dimension are emitted; the same dependency
// names, labels, and types that `matchDep` returns are embedded verbatim.

const DETECTION_DIMENSIONS = Object.freeze([
  { dimensionId: "DIM-data-v1", category: "store", table: DATABASE_INDICATORS },
  { dimensionId: "DIM-operations-v1", category: "monitoring", table: MONITORING_LIBS },
  { dimensionId: "DIM-security-v1", category: "authentication", table: AUTH_LIBS },
  { dimensionId: "DIM-security-v1", category: "validation", table: INPUT_VALIDATION_LIBS },
  { dimensionId: "DIM-security-v1", category: "security_tool", table: AUDIT_TOOLS },
]);

function detectionObservation(category, matchedKey, details) {
  return { category, path: null, matchedKey, details, sourceKind: "manifest" };
}

/**
 * Derive provider observations from ecosystem-keyed detection tables.
 * Deterministic and pure; never throws.
 * @param {object} input - `{ ecosystem, deps }` where `deps` matches
 *   `matchDep`'s accepted shapes (array of names or a deps object).
 * @returns {object[]} `[{ dimensionId, observations }]` (frozen).
 */
export function detectionObservations({ ecosystem, deps } = {}) {
  if (typeof ecosystem !== "string" || ecosystem.length === 0) return [];
  const grouped = new Map();
  for (const { dimensionId, category, table } of DETECTION_DIMENSIONS) {
    const sub = table && table[ecosystem];
    if (!sub) continue;
    const hits = matchDep(deps, sub);
    for (const hit of hits) {
      const observations = grouped.get(dimensionId) ?? [];
      observations.push(
        detectionObservation(category, `${category}:${hit.name}`, {
          name: hit.name,
          label: hit.label,
          ...(hit.type ? { type: hit.type } : {}),
        }),
      );
      grouped.set(dimensionId, observations);
    }
  }
  const groups = [...grouped.entries()]
    .map(([dimensionId, observations]) => ({
      dimensionId,
      observations: observations
        .slice()
        .toSorted((left, right) =>
          compareAscii(
            `${left.category}\0${left.matchedKey}`,
            `${right.category}\0${right.matchedKey}`,
          ),
        ),
    }))
    .toSorted((left, right) => compareAscii(left.dimensionId, right.dimensionId));
  return deepFreeze(groups);
}

/**
 * Build immutable provider results from the detection tables. Inert:
 * consumed only by tests and future provider catalogs.
 * @param {object} input - `{ ecosystem, deps }`.
 * @returns {object[]} Deep-frozen provider results (possibly empty).
 */
export function detectionProviderResult({ ecosystem, deps } = {}) {
  if (typeof ecosystem !== "string" || ecosystem.length === 0) return [];
  const provider = `PRV-detection-${ecosystem}-v1`;
  return detectionObservations({ ecosystem, deps }).map(({ dimensionId, observations }) =>
    createProviderResult({ providerId: provider, dimensionId, observations }),
  );
}
