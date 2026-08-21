// Assurance & Supply Chain dimension — static parsers.
//
// T216 owns this module. It inventories dependency manifests, lockfiles, pins,
// dependency sources, licenses, SBOM/VEX/SARIF documents, tool configuration,
// tool results, accessibility artifacts, attestations, and standards
// references from bounded static artifacts. It NEVER resolves/installs
// packages, queries advisories, executes scanners, validates signatures,
// assesses license compatibility, or emits compliance/conformance/
// compatibility/vulnerability verdicts.
//
// Hard guarantees:
//   - Results are candidate records `{ category, path, status, details }`;
//     the model validates, privacy-filters, and freezes them.
//   - Standards references join ONLY exact schema identities through the T200
//     sidecar pack (`resolveAssuranceStandard`); unknown/restricted identities
//     never produce a standard record.
//   - SARIF and SBOM use the T206 projections (`projectSarif`, `projectSbom`);
//     VEX uses a minimal metadata projection (format, spec version, statement
//     count) with NO vulnerability identifiers or verdicts.
//   - Malformed result artifacts become diagnostics; valid peer evidence is
//     preserved (per-artifact atomicity). No copied control text or sensitive
//     result content is emitted.
//   - File/record caps are enforced deterministically and disclosed.
//
// ESM only. Zero npm deps. node: builtins only (imported here: none).
//
// Source-policy note (T201): this module imports only shared parsers, the
// T206 privacy projections, the standards pack, and the assurance model; it
// never touches node:fs / node:child_process / node:process / node:vm /
// node:module.

import { parseToml } from "../../shared/parse.mjs";
import { projectSarif, projectSbom } from "../../shared/privacy.mjs";
import { resolveAssuranceStandard } from "../../standards/assurance-pack.mjs";
import { ASSURANCE_LIMITS } from "./model.mjs";

const PIN_SCOPES = new Set(["lockfile", "manifest", "requirements"]);
const SOURCE_KINDS = new Set(["git", "index", "registry", "repository"]);
const ACCESSIBILITY_KINDS = new Set(["config", "statement"]);

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

// The parsers cap against the shared records array; the model performs the
// authoritative per-category truncation and discloses it. Parser-side bounds
// carry a small tolerance so a single manifest/other record cannot reduce the
// number of pins/sources/standards below the disclosed model cap.
const PARSER_PIN_LIMIT = ASSURANCE_LIMITS.pins + 16;
const PARSER_SOURCE_LIMIT = ASSURANCE_LIMITS.sources + 16;
const PARSER_STANDARD_LIMIT = ASSURANCE_LIMITS.standards + 16;

// ---------------------------------------------------------------------------
// Path classification
// ---------------------------------------------------------------------------

const LOCK_FILES = Object.freeze({
  "bun.lock": "bun",
  "bun.lockb": "bun",
  "Cargo.lock": "cargo",
  "composer.lock": "composer",
  "deno.lock": "deno",
  "Gemfile.lock": "gemfile",
  "go.sum": "go",
  "mix.lock": "mix",
  "npm-shrinkwrap.json": "npm",
  "package-lock.json": "npm",
  "Pipfile.lock": "pipfile",
  "pdm.lock": "pdm",
  "pnpm-lock.yaml": "pnpm",
  "poetry.lock": "poetry",
  "uv.lock": "uv",
  "yarn.lock": "yarn",
});

const TOOL_CONFIG_FILES = Object.freeze({
  ".bandit": "bandit",
  ".gitguardian.yml": "gitguardian",
  ".gitleaks.toml": "gitleaks",
  ".gitleaks.yaml": "gitleaks",
  ".gitleaksignore": "gitleaks",
  ".grype.yaml": "grype",
  ".nancy": "nancy",
  ".npmrc": "npm",
  ".osv-scanner.yml": "osv-scanner",
  ".osv-scanner.yaml": "osv-scanner",
  ".semgrep.yml": "semgrep",
  ".semgrep.yaml": "semgrep",
  ".snyk": "snyk",
  "dependency-check.properties": "dependency-check",
  "osv-scanner.toml": "osv-scanner",
  "osv-scanner.yaml": "osv-scanner",
  "safety.conf": "safety",
  "trivy.yaml": "trivy",
});

const TOOL_RESULT_FILES = Object.freeze({
  "bandit-results.json": ["bandit", "json"],
  "dependency-check-report.json": ["dependency-check", "json"],
  "gitleaks-report.json": ["gitleaks", "json"],
  "osv-scanner-results.json": ["osv-scanner", "json"],
  "semgrep-results.json": ["semgrep", "json"],
  "snyk-report.json": ["snyk", "json"],
  "snyk.json": ["snyk", "json"],
  "trivy-results.json": ["trivy", "json"],
});

const ACCESSIBILITY_FILES = Object.freeze({
  ".axe.yaml": ["config"],
  ".pa11yci.json": ["config"],
  "a11y.md": ["statement"],
  "accessibility-statement.md": ["statement"],
  "accessibility.md": ["statement"],
  "pa11y-ci.json": ["config"],
  "pa11y.json": ["config"],
  "wcag.md": ["statement"],
});

const LICENSE_FILES = /^(?:LICENSE|LICENCE|COPYING|COPYRIGHT|NOTICE|UNLICENSE)(?:[._-].*)?$/i;

const MANIFEST_DEEP = new Set([
  "Cargo.toml",
  "composer.json",
  "package.json",
  "pyproject.toml",
  "requirements.txt",
]);

function basenameOf(path) {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? "";
}

function extensionOf(path) {
  const base = basenameOf(path);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

function isDeepManifest(path) {
  const base = basenameOf(path);
  if (MANIFEST_DEEP.has(base)) return true;
  if (/^requirements(?:[-._].*)?\.txt$/i.test(base)) return true;
  if (base === "requirements.txt" || base === "requirements-dev.txt") return true;
  return false;
}

/**
 * Classify a repository-relative path into an assurance artifact kind.
 * @param {string} path
 * @returns {{ kind: string, format: string }|null} `kind` is one of
 *   `manifest`, `lock`, `sbom`, `vex`, `sarif`, `configuration`,
 *   `tool_result`, `accessibility`, `attestation`, or `license`; `format` is
 *   `json` or `text`. Returns null for non-assurance paths.
 */
export function classifyAssurancePath(path) {
  const base = basenameOf(path);
  const ext = extensionOf(path);

  if (Object.hasOwn(LOCK_FILES, base)) {
    if (base === "bun.lockb") return { kind: "lock", format: "binary" };
    return {
      kind: "lock",
      format:
        base === "deno.lock" ||
        base === "Pipfile.lock" ||
        base === "composer.lock" ||
        base === "package-lock.json" ||
        base === "npm-shrinkwrap.json"
          ? "json"
          : "text",
    };
  }
  if (isDeepManifest(path))
    return { kind: "manifest", format: /\.json$/i.test(base) ? "json" : "text" };
  if (
    base === "Gemfile" ||
    base === "go.mod" ||
    base === "Pipfile" ||
    base === "setup.cfg" ||
    base === "setup.py"
  ) {
    return { kind: "manifest", format: "text" };
  }
  if (Object.hasOwn(TOOL_CONFIG_FILES, base)) return { kind: "configuration", format: "text" };
  if (Object.hasOwn(TOOL_RESULT_FILES, base)) return { kind: "tool_result", format: "text" };
  if (Object.hasOwn(ACCESSIBILITY_FILES, base)) return { kind: "accessibility", format: "text" };
  if (LICENSE_FILES.test(base)) return { kind: "license", format: "text" };

  if (
    /\.sbom\.json$/i.test(base) ||
    base === "bom.json" ||
    base === "cyclonedx.json" ||
    base === "sbom.json" ||
    /\.cdx\.json$/i.test(base) ||
    /\.spdx\.json$/i.test(base) ||
    base === "spdx.json"
  ) {
    return { kind: "sbom", format: "json" };
  }
  if (base === "openvex.json" || /\.vex\.json$/i.test(base)) return { kind: "vex", format: "json" };
  if (ext === ".sarif" || /\.sarif\.json$/i.test(base)) return { kind: "sarif", format: "json" };
  if (
    /\.intoto\.jsonl$/i.test(base) ||
    /\.att$/i.test(base) ||
    /\.attestation(?:\.json)?$/i.test(base) ||
    /\.sigstore\.json$/i.test(base)
  ) {
    return { kind: "attestation", format: "text" };
  }
  if (/^provenance(?:\.intoto)?\.jsonl?$/i.test(base))
    return { kind: "attestation", format: "json" };
  return null;
}

export function discoverAssuranceArtifacts(files) {
  return [...files].filter((path) => classifyAssurancePath(path) !== null).toSorted();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function boundedToken(value, maximum = 128) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    /[^\x20-\x7e]/.test(value) ||
    value !== value.trim()
  )
    return null;
  return value;
}

function diagnostic(path, status, reason) {
  return { path, status, reason };
}

function candidate(category, path, status, details) {
  return { category, path, status, details };
}

function safeHost(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) return null;
  let candidateValue = value;
  if (candidateValue.startsWith("git+")) candidateValue = candidateValue.slice(4);
  if (candidateValue.startsWith("registry+")) candidateValue = candidateValue.slice(9);
  if (candidateValue.startsWith("ssh://")) candidateValue = candidateValue.slice(6);
  if (!/^https?:\/\//.test(candidateValue)) {
    const at = candidateValue.indexOf("@");
    const withoutUser = at === -1 ? candidateValue : candidateValue.slice(at + 1);
    const host = withoutUser.split("/")[0];
    if (/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(host)) return host.toLowerCase();
    return null;
  }
  let parsed;
  try {
    parsed = new URL(candidateValue);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(parsed.hostname)) return null;
  return parsed.hostname.toLowerCase();
}

function sourceRecord(path, kind, rawUrl, label) {
  if (!SOURCE_KINDS.has(kind)) return null;
  const host = safeHost(rawUrl);
  if (host === null) return null;
  const details = { host, kind, label: label ?? null };
  return candidate("source", path, "observed", details);
}

function pinRecord(path, name, version, scope) {
  if (name === null || version === null || !PIN_SCOPES.has(scope)) return null;
  if (boundedToken(name) === null || boundedToken(version) === null) return null;
  return candidate("pin", path, "observed", { package: name, scope, version });
}

function standardRecord(path, identity) {
  const standard = resolveAssuranceStandard(identity);
  if (standard === null) return null;
  return candidate("standard", path, "observed", {
    registryId: standard.registryId,
    editionKey: standard.editionKey,
    disposition: standard.disposition,
  });
}

function boundedPush(records, value, maximum) {
  if (records.length >= maximum) return false;
  if (value === null) return true;
  records.push(value);
  return true;
}

// ---------------------------------------------------------------------------
// Manifest parsers
// ---------------------------------------------------------------------------

function licenseIdentifier(value) {
  const token = String(value)
    .split(/\s+(?:AND|OR)\s+/i)[0]
    .trim();
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(token)
  )
    return null;
  return token;
}

function licenseFromDeclared(value, path, records) {
  if (typeof value === "string") {
    const id = licenseIdentifier(value);
    if (id !== null) {
      records.push(
        candidate("license", path, "observed", { declared: "manifest", identifier: id }),
      );
    }
    return;
  }
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.type === "string"
  ) {
    const id = licenseIdentifier(value.type);
    if (id !== null) {
      records.push(
        candidate("license", path, "observed", { declared: "manifest", identifier: id }),
      );
    }
  }
}

function parsePackageJson(value, path) {
  const records = [];
  const diagnostics = [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { records, diagnostics: [diagnostic(path, "malformed", "MALFORMED")] };
  }
  records.push(
    candidate("manifest", path, "observed", { format: "package_json", ecosystem: "javascript" }),
  );
  licenseFromDeclared(value.license, path, records);
  if (Array.isArray(value.licenses)) {
    for (const entry of value.licenses) licenseFromDeclared(entry?.type ?? entry, path, records);
  }
  const buckets = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
  for (const bucket of buckets) {
    const deps = value[bucket];
    if (deps === null || typeof deps !== "object" || Array.isArray(deps)) continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec === "string" && /^(?:git\+https?|https?):\/\//.test(spec)) {
        boundedPush(records, sourceRecord(path, "git", spec, "git"), PARSER_SOURCE_LIMIT);
      }
      if (typeof spec !== "string" || !EXACT_VERSION.test(spec)) continue;
      boundedPush(records, pinRecord(path, name, spec, "manifest"), PARSER_PIN_LIMIT);
    }
  }
  return { records, diagnostics };
}

function parseRequirements(text, path) {
  const records = [];
  const diagnostics = [];
  records.push(
    candidate("manifest", path, "observed", { format: "requirements", ecosystem: null }),
  );
  const lines = String(text ?? "").split(/\r?\n/);
  let pinCount = 0;
  for (const raw of lines) {
    let line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const hash = line.indexOf(" #");
    if (hash !== -1) line = line.slice(0, hash).trim();
    if (
      line.startsWith("-i") ||
      line.startsWith("--index-url") ||
      line.startsWith("--extra-index-url")
    ) {
      const url = line.split(/\s+/).pop();
      if (/^https?:\/\//.test(url) && boundedToken(url, 256) !== null) {
        boundedPush(records, sourceRecord(path, "index", url, "index"), PARSER_SOURCE_LIMIT);
      }
      continue;
    }
    const eq = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*==\s*([^\s;]+)/);
    if (eq && pinCount < ASSURANCE_LIMITS.pins) {
      const name = boundedToken(eq[1], 128);
      const version = boundedToken(eq[2], 128);
      if (name !== null && version !== null) {
        records.push(
          candidate("pin", path, "observed", { package: name, scope: "requirements", version }),
        );
        pinCount++;
      }
    }
  }
  return { records, diagnostics };
}

function parsePyproject(text, path) {
  const records = [];
  const diagnostics = [];
  let doc;
  try {
    doc = parseToml(text ?? "");
  } catch {
    return { records, diagnostics: [diagnostic(path, "malformed", "PARSE_UNSUPPORTED")] };
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    return { records, diagnostics: [diagnostic(path, "malformed", "MALFORMED")] };
  }
  records.push(
    candidate("manifest", path, "observed", { format: "pyproject_toml", ecosystem: "python" }),
  );
  const project = doc.project;
  if (project !== null && typeof project === "object" && !Array.isArray(project)) {
    licenseFromDeclared(project.license, path, records);
    if (Array.isArray(project.dependencies)) {
      let pinCount = 0;
      for (const spec of project.dependencies) {
        if (typeof spec !== "string" || pinCount >= ASSURANCE_LIMITS.pins) continue;
        const eq = spec.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*==\s*([^\s;,]+)/);
        if (eq) {
          const name = boundedToken(eq[1], 128);
          const version = boundedToken(eq[2], 128);
          if (name !== null && version !== null) {
            records.push(
              candidate("pin", path, "observed", { package: name, scope: "manifest", version }),
            );
            pinCount++;
          }
        }
      }
    }
  }
  const tool = doc.tool;
  if (tool !== null && typeof tool === "object" && !Array.isArray(tool)) {
    const uv = tool.uv;
    if (
      uv !== null &&
      typeof uv === "object" &&
      !Array.isArray(uv) &&
      typeof uv["index-url"] === "string"
    ) {
      boundedPush(
        records,
        sourceRecord(path, "index", uv["index-url"], "index"),
        PARSER_SOURCE_LIMIT,
      );
    }
    const pip = tool.pip;
    if (
      pip !== null &&
      typeof pip === "object" &&
      !Array.isArray(pip) &&
      typeof pip["index-url"] === "string"
    ) {
      boundedPush(
        records,
        sourceRecord(path, "index", pip["index-url"], "index"),
        PARSER_SOURCE_LIMIT,
      );
    }
    const poetry = tool.poetry;
    if (
      poetry !== null &&
      typeof poetry === "object" &&
      !Array.isArray(poetry) &&
      poetry.license != null
    ) {
      licenseFromDeclared(poetry.license, path, records);
    }
  }
  return { records, diagnostics };
}

function parseCargoToml(text, path) {
  const records = [];
  const diagnostics = [];
  let doc;
  try {
    doc = parseToml(text ?? "");
  } catch {
    return { records, diagnostics: [diagnostic(path, "malformed", "PARSE_UNSUPPORTED")] };
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    return { records, diagnostics: [diagnostic(path, "malformed", "MALFORMED")] };
  }
  records.push(
    candidate("manifest", path, "observed", { format: "cargo_toml", ecosystem: "rust" }),
  );
  const pkg = doc.package;
  if (pkg !== null && typeof pkg === "object" && !Array.isArray(pkg)) {
    licenseFromDeclared(pkg.license, path, records);
  }
  for (const bucket of ["dependencies", "dev-dependencies", "build-dependencies"]) {
    const deps = doc[bucket];
    if (deps === null || typeof deps !== "object" || Array.isArray(deps)) continue;
    for (const [name, value] of Object.entries(deps)) {
      let version = null;
      if (typeof value === "string") {
        version = value.startsWith("=") ? value.slice(1).trim() : null;
      } else if (value !== null && typeof value === "object" && typeof value.version === "string") {
        version = value.version.startsWith("=") ? value.version.slice(1).trim() : null;
      }
      if (version !== null && EXACT_VERSION.test(version)) {
        boundedPush(records, pinRecord(path, name, version, "manifest"), PARSER_PIN_LIMIT);
      }
    }
  }
  return { records, diagnostics };
}

function parseComposerJson(value, path) {
  const records = [];
  const diagnostics = [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { records, diagnostics: [diagnostic(path, "malformed", "MALFORMED")] };
  }
  records.push(
    candidate("manifest", path, "observed", { format: "composer_json", ecosystem: "php" }),
  );
  licenseFromDeclared(value.license, path, records);
  if (Array.isArray(value.license)) {
    for (const entry of value.license) licenseFromDeclared(entry, path, records);
  }
  return { records, diagnostics };
}

function parseManifest({ path, text, value, _format }) {
  const base = basenameOf(path);
  if (base === "package.json") return parsePackageJson(value, path);
  if (base === "requirements.txt" || /^requirements(?:[-._].*)?\.txt$/i.test(base))
    return parseRequirements(text, path);
  if (base === "pyproject.toml") return parsePyproject(text, path);
  if (base === "Cargo.toml") return parseCargoToml(text, path);
  if (base === "composer.json") return parseComposerJson(value, path);
  const formatName = {
    Gemfile: "gemfile",
    Pipfile: "pipfile",
    "go.mod": "go_mod",
    "setup.cfg": "setup_cfg",
    "setup.py": "setup_py",
  }[base];
  if (formatName !== undefined) {
    return {
      records: [candidate("manifest", path, "observed", { format: formatName, ecosystem: null })],
      diagnostics: [],
    };
  }
  return { records: [], diagnostics: [diagnostic(path, "unsupported", "UNSUPPORTED")] };
}

// ---------------------------------------------------------------------------
// Lockfile parsers
// ---------------------------------------------------------------------------

function parseNpmLock(value, path) {
  const records = [];
  const diagnostics = [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { records, diagnostics: [diagnostic(path, "malformed", "MALFORMED")] };
  }
  records.push(candidate("lock", path, "observed", { format: "npm" }));
  const packages = value.packages;
  if (packages !== null && typeof packages === "object" && !Array.isArray(packages)) {
    let pinCount = 0;
    for (const [key, entry] of Object.entries(packages)) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
      if (typeof entry.version !== "string") continue;
      const segments = key.split("/").filter(Boolean);
      const name = key === "" || segments.length === 0 ? null : segments[segments.length - 1];
      if (name !== null && boundedToken(name) !== null && pinCount < ASSURANCE_LIMITS.pins) {
        records.push(
          candidate("pin", path, "observed", {
            package: name,
            scope: "lockfile",
            version: entry.version,
          }),
        );
        pinCount++;
      }
      if (typeof entry.resolved === "string") {
        boundedPush(
          records,
          sourceRecord(path, "registry", entry.resolved, "registry"),
          PARSER_SOURCE_LIMIT,
        );
      }
    }
  }
  return { records, diagnostics };
}

function parseCargoLock(text, path) {
  const records = [];
  const diagnostics = [];
  let doc;
  try {
    doc = parseToml(text ?? "");
  } catch {
    return { records, diagnostics: [diagnostic(path, "malformed", "PARSE_UNSUPPORTED")] };
  }
  records.push(candidate("lock", path, "observed", { format: "cargo" }));
  const packages = Array.isArray(doc.package) ? doc.package : [];
  for (const pkg of packages) {
    if (pkg === null || typeof pkg !== "object" || Array.isArray(pkg)) continue;
    boundedPush(records, pinRecord(path, pkg.name, pkg.version, "lockfile"), PARSER_PIN_LIMIT);
    if (typeof pkg.source === "string") {
      boundedPush(
        records,
        sourceRecord(path, "registry", pkg.source, "crates.io"),
        PARSER_SOURCE_LIMIT,
      );
    }
  }
  return { records, diagnostics };
}

function parseUvLock(text, path) {
  const records = [];
  const diagnostics = [];
  let doc;
  try {
    doc = parseToml(text ?? "");
  } catch {
    return { records, diagnostics: [diagnostic(path, "malformed", "PARSE_UNSUPPORTED")] };
  }
  records.push(candidate("lock", path, "observed", { format: "uv" }));
  const packages = Array.isArray(doc.package) ? doc.package : [];
  for (const pkg of packages) {
    if (pkg === null || typeof pkg !== "object" || Array.isArray(pkg)) continue;
    boundedPush(records, pinRecord(path, pkg.name, pkg.version, "lockfile"), PARSER_PIN_LIMIT);
    if (
      pkg.source !== null &&
      typeof pkg.source === "object" &&
      !Array.isArray(pkg.source) &&
      typeof pkg.source.registry === "string"
    ) {
      boundedPush(
        records,
        sourceRecord(path, "index", pkg.source.registry, "index"),
        PARSER_SOURCE_LIMIT,
      );
    }
  }
  return { records, diagnostics };
}

function parsePoetryLock(text, path) {
  const records = [];
  const diagnostics = [];
  let doc;
  try {
    doc = parseToml(text ?? "");
  } catch {
    return { records, diagnostics: [diagnostic(path, "malformed", "PARSE_UNSUPPORTED")] };
  }
  records.push(candidate("lock", path, "observed", { format: "poetry" }));
  const packages = Array.isArray(doc.package) ? doc.package : [];
  for (const pkg of packages) {
    if (pkg === null || typeof pkg !== "object" || Array.isArray(pkg)) continue;
    boundedPush(records, pinRecord(path, pkg.name, pkg.version, "lockfile"), PARSER_PIN_LIMIT);
  }
  return { records, diagnostics };
}

function parsePipfileLock(value, path) {
  const records = [];
  const diagnostics = [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { records, diagnostics: [diagnostic(path, "malformed", "MALFORMED")] };
  }
  records.push(candidate("lock", path, "observed", { format: "pipfile" }));
  for (const bucket of ["default", "develop"]) {
    const deps = value[bucket];
    if (deps === null || typeof deps !== "object" || Array.isArray(deps)) continue;
    for (const [name, entry] of Object.entries(deps)) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
      boundedPush(records, pinRecord(path, name, entry.version, "lockfile"), PARSER_PIN_LIMIT);
    }
  }
  if (
    value._meta !== null &&
    typeof value._meta === "object" &&
    !Array.isArray(value._meta) &&
    Array.isArray(value._meta.sources)
  ) {
    for (const source of value._meta.sources) {
      if (source !== null && typeof source === "object" && typeof source.url === "string") {
        boundedPush(records, sourceRecord(path, "index", source.url, "index"), PARSER_SOURCE_LIMIT);
      }
    }
  }
  return { records, diagnostics };
}

function parseComposerLock(value, path) {
  const records = [];
  const diagnostics = [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { records, diagnostics: [diagnostic(path, "malformed", "MALFORMED")] };
  }
  records.push(candidate("lock", path, "observed", { format: "composer" }));
  for (const bucket of ["packages", "packages-dev"]) {
    const list = value[bucket];
    if (!Array.isArray(list)) continue;
    for (const pkg of list) {
      if (pkg === null || typeof pkg !== "object" || Array.isArray(pkg)) continue;
      boundedPush(records, pinRecord(path, pkg.name, pkg.version, "lockfile"), PARSER_PIN_LIMIT);
      const distUrl = pkg.dist?.url;
      const sourceUrl = pkg.source?.url;
      const url =
        typeof distUrl === "string" ? distUrl : typeof sourceUrl === "string" ? sourceUrl : null;
      if (url !== null)
        boundedPush(
          records,
          sourceRecord(path, "repository", url, "repository"),
          PARSER_SOURCE_LIMIT,
        );
    }
  }
  return { records, diagnostics };
}

function parseYarnLock(text, path) {
  const records = [];
  const diagnostics = [];
  records.push(candidate("lock", path, "observed", { format: "yarn" }));
  const lines = String(text ?? "").split(/\r?\n/);
  let currentName = null;
  let pinCount = 0;
  for (const line of lines) {
    const header = line.match(/^"?([A-Za-z0-9@][^:@]*?)(?:@[^:]+)?":$/);
    if (header && boundedToken(header[1]) !== null) {
      currentName = header[1];
      continue;
    }
    const version = line.match(/^\s+version "([^"]+)"/);
    if (version && currentName !== null && pinCount < ASSURANCE_LIMITS.pins) {
      records.push(
        candidate("pin", path, "observed", {
          package: currentName,
          scope: "lockfile",
          version: version[1],
        }),
      );
      pinCount++;
      continue;
    }
    const resolved = line.match(/^\s+resolved "([^"]+)"/);
    if (resolved) {
      boundedPush(
        records,
        sourceRecord(path, "registry", resolved[1], "registry"),
        PARSER_SOURCE_LIMIT,
      );
    }
  }
  return { records, diagnostics };
}

function parseLock({ path, text, value }) {
  const base = basenameOf(path);
  switch (base) {
    case "package-lock.json":
    case "npm-shrinkwrap.json":
      return parseNpmLock(value, path);
    case "Cargo.lock":
      return parseCargoLock(text, path);
    case "uv.lock":
      return parseUvLock(text, path);
    case "poetry.lock":
      return parsePoetryLock(text, path);
    case "Pipfile.lock":
      return parsePipfileLock(value, path);
    case "composer.lock":
      return parseComposerLock(value, path);
    case "yarn.lock":
      return parseYarnLock(text, path);
    case "pnpm-lock.yaml":
    case "pdm.lock":
      return {
        records: [
          candidate("lock", path, "observed", {
            format: base === "pnpm-lock.yaml" ? "pnpm" : "pdm",
          }),
        ],
        diagnostics: [],
      };
    case "deno.lock":
      return {
        records: [candidate("lock", path, "observed", { format: "deno" })],
        diagnostics: [],
      };
    case "go.sum":
    case "Gemfile.lock":
    case "mix.lock":
    case "bun.lock":
    case "bun.lockb":
      return {
        records: [
          candidate("lock", path, "observed", {
            format: {
              "go.sum": "go",
              "Gemfile.lock": "gemfile",
              "mix.lock": "mix",
              "bun.lock": "bun",
              "bun.lockb": "bun",
            }[base],
          }),
        ],
        diagnostics: [],
      };
    default:
      return { records: [], diagnostics: [diagnostic(path, "unsupported", "UNSUPPORTED")] };
  }
}

// ---------------------------------------------------------------------------
// SBOM / VEX / SARIF
// ---------------------------------------------------------------------------

function parseSbom(value, path) {
  const records = [];
  const diagnostics = [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { records, diagnostics: [diagnostic(path, "malformed", "MALFORMED")] };
  }
  let format = null;
  let specVersion = null;
  let projection;
  try {
    if (value.bomFormat === "CycloneDX") {
      format = "CycloneDX";
      specVersion = typeof value.specVersion === "string" ? value.specVersion : null;
      projection = projectSbom(value);
    } else if (typeof value.spdxVersion === "string") {
      format = "SPDX";
      specVersion = value.spdxVersion;
      projection = projectSbom(value);
    } else {
      return { records, diagnostics: [diagnostic(path, "unsupported", "UNKNOWN_SCHEMA")] };
    }
  } catch {
    return { records, diagnostics: [diagnostic(path, "malformed", "PROJECTION_FAILED")] };
  }
  records.push(candidate("sbom", path, "observed", { format, specVersion, projection }));
  if (format === "CycloneDX" && specVersion === "1.7") {
    boundedPush(records, standardRecord(path, "sbom:CycloneDX:1.7"), PARSER_STANDARD_LIMIT);
  } else if (format === "SPDX" && specVersion === "SPDX-2.3") {
    boundedPush(records, standardRecord(path, "sbom:SPDX:SPDX-2.3"), PARSER_STANDARD_LIMIT);
  }
  return { records, diagnostics };
}

function parseVex(value, path) {
  const records = [];
  const diagnostics = [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { records, diagnostics: [diagnostic(path, "malformed", "MALFORMED")] };
  }
  const context = value["@context"];
  const isOpenVex = typeof context === "string" && /openvex/i.test(context);
  if (!isOpenVex) {
    return { records, diagnostics: [diagnostic(path, "unsupported", "UNKNOWN_SCHEMA")] };
  }
  const specMatch = String(context).match(/v(\d+\.\d+(?:\.\d+)?)/);
  const specVersion = specMatch ? specMatch[1] : null;
  const statementCount = Array.isArray(value.statements) ? value.statements.length : 0;
  records.push(
    candidate("vex", path, "observed", { format: "OpenVEX", specVersion, statementCount }),
  );
  if (specVersion === "0.2.0") {
    boundedPush(records, standardRecord(path, "vex:OpenVEX:0.2.0"), PARSER_STANDARD_LIMIT);
  }
  return { records, diagnostics };
}

function parseSarif(value, path) {
  const records = [];
  const diagnostics = [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { records, diagnostics: [diagnostic(path, "malformed", "MALFORMED")] };
  }
  let projection;
  try {
    projection = projectSarif(value);
  } catch {
    return { records, diagnostics: [diagnostic(path, "malformed", "PROJECTION_FAILED")] };
  }
  const version = typeof value.version === "string" ? value.version : null;
  records.push(candidate("sarif", path, "observed", { projection, version }));
  if (version === "2.1.0") {
    boundedPush(records, standardRecord(path, "sarif:2.1.0"), PARSER_STANDARD_LIMIT);
  }
  return { records, diagnostics };
}

// ---------------------------------------------------------------------------
// Configuration / tool results / accessibility / attestation / license
// ---------------------------------------------------------------------------

function parseConfiguration(path) {
  const base = basenameOf(path);
  const tool = TOOL_CONFIG_FILES[base];
  if (tool === undefined) {
    return { records: [], diagnostics: [diagnostic(path, "unsupported", "UNSUPPORTED")] };
  }
  return { records: [candidate("configuration", path, "observed", { tool })], diagnostics: [] };
}

function parseToolResult(path) {
  const base = basenameOf(path);
  const entry = TOOL_RESULT_FILES[base];
  if (entry === undefined) {
    return { records: [], diagnostics: [diagnostic(path, "unsupported", "UNSUPPORTED")] };
  }
  const [tool, format] = entry;
  return {
    records: [candidate("tool_result", path, "observed", { format, tool })],
    diagnostics: [],
  };
}

function parseAccessibility({ path, text, value }) {
  const base = basenameOf(path);
  const kinds = ACCESSIBILITY_FILES[base];
  const kind = kinds !== undefined ? kinds[0] : "statement";
  const records = [];
  const diagnostics = [];
  const source = typeof text === "string" ? text : typeof value === "string" ? value : "";
  const declared = /WCAG\s*2\.2\b/i.test(source) ? "wcag:2.2" : null;
  if (!ACCESSIBILITY_KINDS.has(kind)) {
    return { records, diagnostics: [diagnostic(path, "unsupported", "UNSUPPORTED")] };
  }
  records.push(candidate("accessibility", path, "observed", { declared, kind }));
  if (declared === "wcag:2.2") {
    boundedPush(records, standardRecord(path, "accessibility:WCAG:2.2"), PARSER_STANDARD_LIMIT);
  }
  return { records, diagnostics };
}

function parseAttestation(path) {
  const base = basenameOf(path);
  if (/\.intoto\.jsonl$/i.test(base) || /^provenance(?:\.intoto)?\.jsonl?$/i.test(base)) {
    return {
      records: [
        candidate("attestation", path, "observed", { format: "in-toto", kind: "statement" }),
      ],
      diagnostics: [],
    };
  }
  if (/\.att$/i.test(base))
    return {
      records: [candidate("attestation", path, "observed", { format: "in-toto", kind: "link" })],
      diagnostics: [],
    };
  if (/\.attestation(?:\.json)?$/i.test(base)) {
    return {
      records: [
        candidate("attestation", path, "observed", { format: "in-toto", kind: "statement" }),
      ],
      diagnostics: [],
    };
  }
  if (/\.sigstore\.json$/i.test(base)) {
    return {
      records: [candidate("attestation", path, "observed", { format: "sigstore", kind: "bundle" })],
      diagnostics: [],
    };
  }
  return { records: [], diagnostics: [diagnostic(path, "unsupported", "UNSUPPORTED")] };
}

function parseLicense(path) {
  const base = basenameOf(path);
  if (!LICENSE_FILES.test(base)) {
    return { records: [], diagnostics: [diagnostic(path, "unsupported", "UNSUPPORTED")] };
  }
  return {
    records: [candidate("license", path, "observed", { declared: "file", identifier: null })],
    diagnostics: [],
  };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Extract assurance candidate records from one bounded artifact.
 * @param {object} input - `{ path, text, value, format, kind }`.
 * @returns {{ records: object[], diagnostics: object[] }} Candidate records
 *   (not yet frozen; the model validates and freezes them) and diagnostics.
 *   Never throws on content; malformed/unsupported content produces
 *   diagnostics.
 */
export function extractAssuranceArtifact({ path, text, value, format, kind = null }) {
  const effectiveKind = kind ?? classifyAssurancePath(path)?.kind ?? null;
  switch (effectiveKind) {
    case "manifest":
      return parseManifest({ path, text, value, format });
    case "lock":
      return parseLock({ path, text, value });
    case "sbom":
      return parseSbom(value, path);
    case "vex":
      return parseVex(value, path);
    case "sarif":
      return parseSarif(value, path);
    case "configuration":
      return parseConfiguration(path);
    case "tool_result":
      return parseToolResult(path);
    case "accessibility":
      return parseAccessibility({ path, text, value });
    case "attestation":
      return parseAttestation(path);
    case "license":
      return parseLicense(path);
    default:
      return { records: [], diagnostics: [diagnostic(path, "unsupported", "UNSUPPORTED")] };
  }
}
