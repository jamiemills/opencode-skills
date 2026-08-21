import { existsSync, readdirSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { dirname, join } from "node:path";
import { commandBroker } from "../shared/command.mjs";
import { enumerateHiddenFiles } from "../shared/enum.mjs";
import { DESCRIPTORS, descriptorFor, detectEcosystems } from "../shared/ecosystem.mjs";
import { readManifest } from "../shared/manifest.mjs";
import { readBoundedFile } from "../shared/reads.mjs";
import { SECRET_TOKEN_FAMILIES } from "../shared/token-families.mjs";
import { validatePluginRegexSource } from "../plugins/schema.mjs";
import {
  AUTH_LIBS,
  INPUT_VALIDATION_LIBS,
  RATE_LIMIT_LIBS,
  AUDIT_TOOLS,
  matchDep,
} from "../shared/detection.mjs";

// Canonical lockfile vocabulary across every ecosystem we recognize.
// Sourced from the descriptor table (single source of truth) plus a small set
// of ecosystems (Go/PHP/Elixir/Deno/Ruby) the descriptors do not yet model, so
// a recognized lockfile always lifts the security signal regardless of stack.
// `bun.lock` / `pdm.lock` arrive here via the JS/Python descriptor lockfile
// lists, so they are recognized without any extra hardcoding.
const EXTRA_LOCKFILES = ["go.sum", "deno.lock", "composer.lock", "mix.lock", "Gemfile.lock"];
const KNOWN_LOCKFILES = [
  ...new Set([
    ...EXTRA_LOCKFILES,
    ...Object.values(DESCRIPTORS).flatMap((d) => (Array.isArray(d.lockfiles) ? d.lockfiles : [])),
  ]),
];

// Bounds for the direct-read replacements of the former rg pipelines.
const SCAN_FILE_LIMIT = 400;
const SCAN_BYTE_LIMIT = 1024 * 1024;

// F-002: within the bounded scan window, likely-config files are read before
// source files before everything else, so a secret in a config file deep in
// the alphabetical listing still lands inside the cap. Dotfiles, env-style
// basenames, and config extensions are tier 0; source extensions tier 1; the
// rest tier 2. The sort is stable (index tiebreak), so alphabetical order is
// preserved within each tier.
const LIKELY_CONFIG_EXTENSIONS = new Set([
  ".env",
  ".yml",
  ".yaml",
  ".toml",
  ".ini",
  ".conf",
  ".cfg",
  ".cnf",
  ".properties",
  ".json",
  ".xml",
  ".tf",
  ".tfvars",
  ".config",
  ".secrets",
]);
const LIKELY_SOURCE_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".php",
  ".pl",
  ".lua",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".ps1",
  ".bat",
  ".sql",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cs",
  ".swift",
  ".scala",
  ".dart",
  ".vue",
  ".svelte",
]);

function fileScanTier(rel) {
  const base = String(rel).replace(/\\/g, "/").split("/").pop() || "";
  const lower = base.toLowerCase();
  if (
    lower.startsWith(".") ||
    lower.startsWith("dockerfile") ||
    lower.startsWith("compose.") ||
    lower.startsWith("docker-compose")
  ) {
    return 0;
  }
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : "";
  if (LIKELY_CONFIG_EXTENSIONS.has(ext)) return 0;
  if (LIKELY_SOURCE_EXTENSIONS.has(ext)) return 1;
  return 2;
}

function prioritizeForScan(files) {
  return files
    .map((file, index) => ({ file, index, tier: fileScanTier(file) }))

    .toSorted((a, b) => a.tier - b.tier || a.index - b.index)
    .map(({ file }) => file);
}

// Dependabot config file names checked for the configured fact.
const DEPENDABOT_CONFIG_FILES = [".github/dependabot.yml", ".github/dependabot.yaml"];

// First-party auth subsystem cluster names matched against directory and
// module basenames in the enumerated source tree (T009/b15).
const FIRST_PARTY_AUTH_CLUSTERS = ["auth", "token", "oauth", "session", "encryption", "cookies"];

// Bounds for the branch-evidence fact (T009/b2): never claim dating/activity.
const BRANCH_EVIDENCE_LIMIT = 20;
const GITLEAKS_PATH_LIMIT = 200;

function readJSON(path) {
  try {
    return JSON.parse(
      readBoundedFile(path, { byteLimit: SCAN_BYTE_LIMIT, containmentRoot: dirname(path) }) ??
        "null",
    );
  } catch {
    return null;
  }
}

async function listFiles(repoPath, overview, broker) {
  const fromOverview =
    overview && Array.isArray(overview.files) && overview.files.length > 0 ? overview.files : null;
  if (fromOverview) return fromOverview;
  try {
    const result = await broker.execute("rg:files", { cwd: repoPath });
    const raw = result.ok || result.noMatch ? result.stdout : "";
    return raw
      .split("\n")
      .map((s) => s.trim().replace(/\\/g, "/"))
      .filter(Boolean)
      .toSorted();
  } catch {
    return [];
  }
}

// F-018: hidden/gitignored candidates for the secret pass only. The survey
// enumeration prunes dotfiles and gitignored files, so they are enumerated
// separately (bounded by the caller) and never feed the other detectors.
// Everything the visible enumeration already listed is excluded, so this
// list carries only files the main window could never see.
async function listHiddenSecretCandidates(repoPath, broker, visibleSet) {
  const { files, failed } = await enumerateHiddenFiles(repoPath, broker);
  return { candidates: files.filter((f) => !visibleSet.has(f)), failed };
}

// F-022/F-062: bounded whole-file read with a statSync size gate. A file
// above the bound is never allocated; unreadable or oversize files read as
// null so a bounded scan is never mistaken for full coverage.
function readContent(absPath, byteLimit = SCAN_BYTE_LIMIT, containmentRoot = null) {
  return readBoundedFile(absPath, { byteLimit, containmentRoot });
}

// Prefer the survey's normalized manifest; fall back to reading it ourselves.
function resolveManifest(repoPath, overview) {
  if (overview?.manifest && typeof overview.manifest === "object") return overview.manifest;
  return readManifest(repoPath);
}

// Resolve the ranked ecosystem list using the same convention as the other deep
// scanners: prefer the survey's computed `overview.ecosystems.all`, then the
// manifest's declared ecosystems, finally infer from languages + manifest.
function resolveEcosystems(overview, manifest) {
  const ov = overview || {};
  const mf = manifest || {};
  if (ov.ecosystems && Array.isArray(ov.ecosystems.all) && ov.ecosystems.all.length) {
    return ov.ecosystems.all;
  }
  if (Array.isArray(mf.ecosystems) && mf.ecosystems.length) {
    return mf.ecosystems;
  }
  return detectEcosystems(ov, mf).all;
}

// Flat set of dependency names across every manifest dep bucket. Replaces the
// old JS-only `{ ...pkg.dependencies, ...pkg.devDependencies }` shape so Python
// (pyproject [dependency-groups] + requirements.txt), Rust (Cargo + workspace
// union), and JS (package.json) deps are all visible to the detection tables.
function collectDepNames(manifest) {
  const names = new Set();
  if (!manifest) return names;
  for (const key of ["dependencies", "devDependencies", "optionalDeps"]) {
    const bucket = manifest[key];
    if (bucket && typeof bucket === "object") {
      for (const name of Object.keys(bucket)) names.add(name);
    }
  }
  return names;
}

// matchDep accepts an array of names OR a {name:version} object; a Set is
// neither (typeof Set === 'object' but Object.keys(set) is empty), so normalize
// any of those shapes into a plain string array before handing it over.
function toNameArray(depNames) {
  if (!depNames) return [];
  if (Array.isArray(depNames)) return depNames;
  if (depNames instanceof Set) return Array.from(depNames);
  if (typeof depNames === "object") return Object.keys(depNames);
  return [];
}

// File-presence check. `overview.files` (the survey's single enumeration) is
// consulted first; we fall back to existsSync because the enumerator prunes
// dotfiles (rg --files hides them by default) and binary lockfiles (*.lockb),
// both of which this dimension must still recognize.
function hasFile(repoPath, overview, rel) {
  const files = overview?.files;
  if (Array.isArray(files) && files.includes(rel)) return true;
  try {
    return existsSync(join(repoPath, rel));
  } catch {
    return false;
  }
}

// Match `depNames` against an ecosystem-keyed detection table (from
// shared/detection.mjs) across every DETECTED ecosystem, unioning and
// de-duplicating by dependency name. Results are reshaped to the
// `{ package, label, type? }` form consumed by write.mjs (which reads
// `.package` / `.label`) — matchDep itself returns `{ name, label, type? }`.
function unionMatches(depNames, table, ecosystems) {
  const names = toNameArray(depNames);
  const out = [];
  const seen = new Set();
  for (const eco of ecosystems) {
    const subMap = table && table[eco];
    if (!subMap) continue;
    const hits = matchDep(names, subMap);
    for (const h of hits) {
      if (seen.has(h.name)) continue;
      seen.add(h.name);
      out.push({ package: h.name, label: h.label, ...(h.type ? { type: h.type } : {}) });
    }
  }
  return out;
}

// First-party auth subsystem detection (T009/b15): scan the enumerated source
// tree for module clusters named auth/token/oauth/session/encryption/cookies
// (directory or module basenames). A basename matches when it equals a cluster
// name or starts with `<cluster>_` / `<cluster>-` (e.g. oauth_handler.py,
// token_manager.py). Deterministic, sorted, privacy-safe.
function detectFirstPartyAuth(files) {
  const clusters = new Set();
  const evidence = [];
  const seen = new Set();
  const isCluster = (candidate) =>
    FIRST_PARTY_AUTH_CLUSTERS.find(
      (name) =>
        candidate === name || candidate.startsWith(`${name}_`) || candidate.startsWith(`${name}-`),
    );
  for (const rel of Array.isArray(files) ? files : []) {
    const normalized = String(rel).replace(/\\/g, "/");
    const segments = normalized.split("/");
    const leaf = segments[segments.length - 1] || "";
    const baseName = leaf.includes(".") ? leaf.slice(0, leaf.lastIndexOf(".")) : leaf;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const candidate = i === segments.length - 1 ? baseName : segment;
      const cluster = isCluster(candidate.toLowerCase());
      if (cluster) {
        clusters.add(cluster);
        if (!seen.has(normalized) && evidence.length < 5) {
          seen.add(normalized);
          evidence.push(normalized);
        }
      }
    }
  }
  return {
    detected: clusters.size > 0,
    clusters: [...clusters].toSorted(),
    evidence: evidence.toSorted(),
  };
}

// F-030: framework-level detection entries (e.g. `django`, `fastapi`) carry a
// distinct `Capability` type — depending on Django does not prove contrib.auth
// is used. Only specific auth/validation subsystems count toward `detected`;
// capability entries still surface in the inventory but never lift the signal.
const CAPABILITY_TYPE = "Capability";

function detectAuth(depNames, ecosystems, files) {
  const frameworks = unionMatches(depNames, AUTH_LIBS, ecosystems);
  const verified = frameworks.filter((f) => f.type !== CAPABILITY_TYPE);
  const firstParty = detectFirstPartyAuth(files);
  return { detected: verified.length > 0, frameworks, firstParty };
}

function detectInputValidation(depNames, ecosystems) {
  const libraries = unionMatches(depNames, INPUT_VALIDATION_LIBS, ecosystems);
  return { detected: libraries.some((l) => l.type !== CAPABILITY_TYPE), libraries };
}

function detectRateLimiting(repoPath, depNames, ecosystems, files) {
  const libraries = unionMatches(depNames, RATE_LIMIT_LIBS, ecosystems);

  const codeRe = /rate[_-]?limit|throttle|debounce/;
  let codeReferences = 0;
  for (const f of files.slice(0, SCAN_FILE_LIMIT)) {
    const content = readContent(join(repoPath, f));
    if (content && codeRe.test(content)) codeReferences++;
  }

  return {
    detected: libraries.length > 0 || codeReferences > 0,
    libraries,
    codeReferences,
  };
}

export function isSecretPatternName(name) {
  return secretPatterns().some((p) => p.name === name);
}

// F-025: the detection vocabulary is the single source for the report
// redactors too (shared/token-families.mjs) so a family the scanner flags can
// never pass through the sanitizer unredacted.
function secretPatterns() {
  return SECRET_TOKEN_FAMILIES;
}

// Tally pattern hits over a bounded file list. Returns one
// `{ name, re, count, samples }` record per pattern (including zero-hit ones)
// so two passes (visible + hidden) can be merged before findings are built.
function tallySecretPatterns(repoPath, files) {
  const tallies = secretPatterns().map(({ name, re }) => ({ name, re, count: 0, samples: [] }));
  for (const f of files) {
    const content = readContent(join(repoPath, f));
    if (content == null) continue;
    for (const tally of tallies) {
      if (tally.re.test(content)) {
        tally.count++;
        if (tally.samples.length < 3) tally.samples.push(f);
      }
    }
  }
  return tallies;
}

// Merge a second pass's tallies (e.g. the hidden/gitignored enumeration)
// into an existing tally list, preserving pattern order and the 3-sample cap.
function mergeSecretTallies(target, extra) {
  for (const tally of target) {
    const incoming = extra.find(({ name }) => name === tally.name);
    if (!incoming || incoming.count === 0) continue;
    tally.count += incoming.count;
    for (const sample of incoming.samples) {
      if (tally.samples.length >= 3) break;
      if (!tally.samples.includes(sample)) tally.samples.push(sample);
    }
  }
  return target;
}

function findingsFromTallies(tallies) {
  const findings = [];
  for (const tally of tallies) {
    if (tally.count > 0) {
      findings.push({ pattern: tally.name, files: tally.samples, totalFiles: tally.count });
    }
  }
  return findings;
}

function detectSecurityHeaders(repoPath, files) {
  const patterns = [
    { name: "CORS", re: /(?:cors|Access-Control-Allow-Origin)/i },
    { name: "CSP", re: /Content-Security-Policy/i },
    { name: "HSTS", re: /Strict-Transport-Security/i },
    { name: "XSS Protection", re: /X-XSS-Protection/i },
    { name: "Frame Options", re: /X-Frame-Options/i },
    { name: "Content Type Options", re: /X-Content-Type-Options/i },
    { name: "Helmet.js", re: /helmet/i },
  ];

  const detections = [];
  const bounded = files.slice(0, SCAN_FILE_LIMIT);
  for (const { name, re } of patterns) {
    let count = 0;
    for (const f of bounded) {
      const content = readContent(join(repoPath, f));
      if (content && re.test(content)) count++;
    }
    if (count > 0) {
      detections.push({ name, fileCount: count });
    }
  }

  return detections;
}

// Recognized security artifacts: secret-scanning configs, disclosure policy,
// and audit tooling. Dep-keyed audit tools (cargo-audit/cargo-deny/rustsec,
// semgrep/trufflehog/snyk/osv-scanner, pip-audit/safety/bandit, ...) are
// resolved once in scan() via shared/detection.mjs AUDIT_TOOLS.
function detectSecurityTools(repoPath, overview, auditMatches) {
  const tools = [];
  const pushUnique = (t) => {
    if (t && !tools.includes(t)) tools.push(t);
  };

  if (hasFile(repoPath, overview, ".gitleaks.toml")) pushUnique(".gitleaks.toml");
  if (hasFile(repoPath, overview, ".gitleaksignore")) pushUnique(".gitleaksignore");
  if (hasFile(repoPath, overview, "SECURITY.md")) {
    pushUnique("SECURITY.md");
  } else if (hasFile(repoPath, overview, ".github/SECURITY.md")) {
    pushUnique(".github/SECURITY.md");
  }

  // bandit config: standalone file or pyproject [tool.bandit] section. When a
  // config is present the bandit DEP (matched below via AUDIT_TOOLS) is dropped
  // to avoid a redundant duplicate entry for the same tool.
  let banditConfig = false;
  if (hasFile(repoPath, overview, ".bandit")) {
    pushUnique(".bandit");
    banditConfig = true;
  }
  if (!banditConfig && hasFile(repoPath, overview, "pyproject.toml")) {
    // F-022/F-023: bounded, contained read of the well-known config name.
    const txt = readBoundedFile(join(repoPath, "pyproject.toml"), { containmentRoot: repoPath });
    if (txt != null && /^\s*\[tool\.bandit\]/m.test(txt)) {
      pushUnique("bandit config");
      banditConfig = true;
    }
  }

  for (const m of auditMatches) {
    if (m.package === "bandit" && banditConfig) continue;
    pushUnique(m.package);
  }

  return tools;
}

function detectHasLockfile(repoPath, overview, ecosystems) {
  for (const name of KNOWN_LOCKFILES) {
    if (hasFile(repoPath, overview, name)) return true;
  }
  // Descriptor-driven check for the actually-detected ecosystems: catches any
  // lockfile name the global list might have missed for an in-scope stack.
  for (const id of ecosystems) {
    const d = descriptorFor(id);
    if (d?.lockfiles) {
      for (const lf of d.lockfiles) {
        if (hasFile(repoPath, overview, lf)) return true;
      }
    }
  }
  return false;
}

const PACKAGE_AUDIT_PATTERN =
  /\b(?:npm\s+audit|yarn\s+audit|cargo(?:\s+|-)audit|pip-audit|snyk|audit)\b/i;
const FILE_AUDIT_PATTERN =
  /\b(?:bandit|safety|gitleaks|pip-audit|cargo(?:\s+|-)audit|cargo(?:\s+|-)deny|trufflehog|semgrep)\b/gi;

// Best-effort references in Makefile and GitHub Actions files. These are
// evidence of a textual reference only; this scanner does not parse whether a
// workflow step or recipe executes the referenced tool.
function scanAuditReferences(repoPath, overview) {
  const targets = [];
  if (hasFile(repoPath, overview, "Makefile"))
    targets.push({ source: "makefile", location: "Makefile" });

  const wfDir = join(repoPath, ".github", "workflows");
  try {
    if (existsSync(wfDir)) {
      for (const f of readdirSync(wfDir).toSorted()) {
        if (f.endsWith(".yml") || f.endsWith(".yaml")) {
          targets.push({ source: "workflow", location: `.github/workflows/${f}` });
        }
      }
    }
  } catch {}

  const evidence = [];
  for (const target of targets) {
    // F-022/F-023: bounded, contained read of well-known audit-reference files.
    const txt = readBoundedFile(join(repoPath, target.location), { containmentRoot: repoPath });
    if (txt == null) continue;
    for (const match of txt.matchAll(FILE_AUDIT_PATTERN)) {
      evidence.push({ ...target, tool: match[0] });
    }
  }
  return evidence;
}

// Preserve the source of every audit signal. `hasAuditScript` remains a
// compatibility field below, but means only that this array is non-empty.
function detectAuditEvidence(repoPath, overview, auditMatches) {
  const evidence = [];
  const seen = new Set();
  const pushUnique = (entry) => {
    if (!entry || !entry.source || !entry.location || !entry.tool) return;
    const key = `${entry.source}\0${entry.location}\0${entry.tool.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    evidence.push(entry);
  };

  try {
    const pkg = readJSON(join(repoPath, "package.json"));
    if (pkg?.scripts && typeof pkg.scripts === "object") {
      for (const [name, command] of Object.entries(pkg.scripts).toSorted(([a], [b]) =>
        a.localeCompare(b),
      )) {
        if (typeof command !== "string") continue;
        const match = command.match(PACKAGE_AUDIT_PATTERN);
        if (match) {
          pushUnique({
            source: "package-script",
            location: `package.json#scripts.${name}`,
            tool: match[0],
          });
        }
      }
    }
  } catch {}

  for (const match of Array.isArray(auditMatches) ? auditMatches : []) {
    if (typeof match?.package === "string" && match.package) {
      pushUnique({ source: "dependency", location: "manifest", tool: match.package });
    }
  }

  for (const entry of scanAuditReferences(repoPath, overview)) pushUnique(entry);
  return evidence;
}

// Dependabot branch-evidence (T009/b2): when no .github/dependabot.yml exists,
// issue git:branch-list through the broker and cross-reference dependabot/*
// branch prefixes. Never claims branch dating/activity (no for-each-ref). A
// capped/truncated or failed broker result yields status 'unverified' rather
// than a stale "not configured". A clean git repo with no dependabot branches
// keeps the current not-configured fact.
async function detectDependabot(repoPath, overview, broker) {
  const configured = DEPENDABOT_CONFIG_FILES.some((rel) => hasFile(repoPath, overview, rel));
  if (configured) {
    return { configured: true, status: "configured", branches: [], branchCount: 0 };
  }
  let branches = [];
  let status = "unverified";
  try {
    const result = await broker.execute("git:branch-list", { cwd: repoPath });
    if (result.ok) {
      branches = parseDependabotBranches(result.stdout);
      status = branches.length > 0 ? "inferred" : "not-configured";
    }
  } catch {
    status = "unverified";
  }
  return { configured: false, status, branches, branchCount: branches.length };
}

// Parse `git branch -a` stdout and return matched dependabot/* branch names.
// Normalises `* ` markers, leading whitespace, and `remotes/<remote>/`
// prefixes; remote-tracking and local branches of the same name collapse into
// one entry. Deterministic (sorted), bounded.
function parseDependabotBranches(stdout) {
  const seen = new Set();
  for (const rawLine of String(stdout).split("\n")) {
    const cleaned = rawLine.replace(/^\*\s*/, "").trim();
    if (!cleaned) continue;
    const withoutRemote = cleaned.replace(/^remotes\/[^/]+\//, "");
    if (!withoutRemote.startsWith("dependabot/")) continue;
    seen.add(withoutRemote);
    if (seen.size >= BRANCH_EVIDENCE_LIMIT) break;
  }
  return [...seen].toSorted();
}

// Gitleaks context (T009/c6): read the .gitleaks.toml allowlist policy
// (exact-file exception entries and stopwords) and the .gitleaksignore entry
// count. Where the policy declares exact-file fixture exceptions, matching
// secret-pattern findings are labelled fixture-allowlisted (inferred). Never
// emits secret values; only counts and the allowlisted pattern names.
function detectGitleaksContext(repoPath, overview, secrets) {
  const context = {
    configPresent: hasFile(repoPath, overview, ".gitleaks.toml"),
    allowlistPathCount: 0,
    stopwordCount: 0,
    ignorePresent: hasFile(repoPath, overview, ".gitleaksignore"),
    ignoreEntryCount: 0,
    fixtureAllowlisted: [],
  };

  if (context.configPresent) {
    // F-023: the well-known config name is attacker-controlled as a symlink;
    // only read it when it resolves inside the repository.
    const content = readContent(join(repoPath, ".gitleaks.toml"), SCAN_BYTE_LIMIT, repoPath);
    if (content) {
      const { paths, stopwords } = parseGitleaksAllowlist(content);
      context.allowlistPathCount = paths.length;
      context.stopwordCount = stopwords.length;
      const matchers = compileGitleaksPaths(paths);
      // F-002: scan-level watchdog over the allowlist matching loop. Every
      // matcher is now bounded (validated regex or literal glob), so this is a
      // defense-in-depth guard: if evaluation ever exceeds the budget, labeling
      // stops and the truncation is disclosed instead of hanging the scanner.
      let watchdogTripped = false;
      for (const finding of Array.isArray(secrets) ? secrets : []) {
        if (!finding || !Array.isArray(finding.files) || finding.files.length === 0) continue;
        const verdict = matchGitleaksPaths(matchers, finding.files, GITLEAKS_MATCH_BUDGET_MS);
        if (verdict.watchdogTripped) {
          watchdogTripped = true;
          break;
        }
        if (verdict.matched) {
          finding.fixtureAllowlisted = true;
          context.fixtureAllowlisted.push(finding.pattern);
        }
      }
      if (watchdogTripped) context.watchdogTripped = true;
    }
  }

  if (context.ignorePresent) {
    // F-023: containment before the well-known ignore file read.
    const content = readContent(join(repoPath, ".gitleaksignore"), SCAN_BYTE_LIMIT, repoPath);
    if (content) {
      context.ignoreEntryCount = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#")).length;
    }
  }

  context.fixtureAllowlisted = [...new Set(context.fixtureAllowlisted)].toSorted();
  return context;
}

// Parse the `[allowlist]` section of a .gitleaks.toml for the `paths` and
// `stopwords` arrays. Entries are single- or triple-quoted literal strings.
// Bounded to the policy length so a pathological config cannot explode memory.
function parseGitleaksAllowlist(content) {
  // F-002: a bounded non-greedy lookahead; the old `\n*$` alternative enabled
  // needless backtracking over the whole (up-to-1MB) block.
  const allowlistMatch = content.match(/\[allowlist\][\s\S]*?(?=\n\[|$)/);
  const block = allowlistMatch ? allowlistMatch[0] : "";
  return {
    paths: extractTomlArray(block, "paths"),
    stopwords: extractTomlArray(block, "stopwords"),
  };
}

function extractTomlArray(block, key) {
  const re = new RegExp(`\\b${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`);
  const match = block.match(re);
  if (!match) return [];
  const entries = [];
  for (const quoted of match[1].matchAll(/'''([\s\S]*?)'''|"([^"]*)"|'([^']*)'/g)) {
    const value = quoted[1] ?? quoted[2] ?? quoted[3];
    const trimmed = value.trim();
    if (trimmed && entries.length < GITLEAKS_PATH_LIMIT) entries.push(trimmed);
  }
  return entries;
}

// Length cap for a single allowlist path entry; the shared regex-complexity
// policy also caps sources at 128 chars, so the entry is rejected up front.
const GITLEAKS_PATH_PATTERN_LIMIT = 128;

// Match budget for the gitleaks allowlist labeling loop (F-002 watchdog).
const GITLEAKS_MATCH_BUDGET_MS = 1000;

// Compile the allowlist path patterns to test secret finding file paths
// against. F-002: a repo-controlled allowlist `paths` entry is NEVER compiled
// as a raw regex — a catastrophic pattern like `(a+)+$` would hang the
// single-threaded scanner. Each entry is routed through the shared T203
// regex-complexity policy (validatePluginRegexSource, the same validator the
// plugin rules use); sources that pass compile from the validated source and
// sources the policy rejects fall back to literal-glob matching, which is
// linear and cannot backtrack. Entries above the length cap are skipped.
function compileGitleaksPaths(paths) {
  const matchers = [];
  for (const pattern of paths) {
    const source = typeof pattern === "string" ? pattern.trim() : "";
    if (source.length === 0 || source.length > GITLEAKS_PATH_PATTERN_LIMIT) continue;
    let validated;
    try {
      validated = validatePluginRegexSource(source);
    } catch {
      matchers.push(literalGlobMatcher(source));
      continue;
    }
    try {
      matchers.push(new RegExp(validated, "u"));
    } catch {
      matchers.push(literalGlobMatcher(source));
    }
  }
  return matchers;
}

function escapeRegexLiteral(source) {
  return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Literal-glob matcher for allowlist entries the complexity policy rejects:
// `*` matches any run of characters, everything else is literal. Bounded and
// linear — no regex engine, no backtracking. A policy-rejected entry cannot
// label a finding as allowlisted unless it matches as a literal glob.
function literalGlobMatcher(source) {
  if (!source.includes("*")) {
    const needle = source;
    return { test: (file) => file === needle };
  }
  const re = new RegExp(`^${source.split("*").map(escapeRegexLiteral).join(".*")}$`);
  return { test: (file) => re.test(file) };
}

// Test a finding's file list against the compiled matchers under a wall-clock
// budget. Returns `{ matched, watchdogTripped }`; the loop stops as soon as a
// file matches (the allowlist labels the whole finding).
function matchGitleaksPaths(matchers, files, budgetMs) {
  const deadline = performance.now() + budgetMs;
  for (const file of files) {
    for (const matcher of matchers) {
      if (performance.now() > deadline) return { matched: false, watchdogTripped: true };
      if (matcher.test(file)) return { matched: true, watchdogTripped: false };
    }
  }
  return { matched: false, watchdogTripped: false };
}

export async function scan(repoPath, overview, broker = commandBroker) {
  const manifest = resolveManifest(repoPath, overview);
  const depNames = collectDepNames(manifest);
  const ecosystems = resolveEcosystems(overview, manifest);
  const files = await listFiles(repoPath, overview, broker);

  // F-002: prioritize likely-config/source files inside the cap and disclose
  // the truncation so a bounded scan is never mistaken for full coverage.
  const scanned = prioritizeForScan(files).slice(0, SCAN_FILE_LIMIT);
  const filesSkipped = Math.max(0, files.length - scanned.length);

  // F-018: bounded hidden/gitignored pass feeding only the secret patterns.
  // A failed enumeration is disclosed so an empty hidden window is never
  // mistaken for "no hidden files".
  const { candidates: hiddenCandidates, failed: hiddenEnumerationFailed } =
    await listHiddenSecretCandidates(repoPath, broker, new Set(files));
  const hiddenScanned = hiddenCandidates.slice(0, SCAN_FILE_LIMIT);
  const hiddenFilesSkipped = Math.max(0, hiddenCandidates.length - hiddenScanned.length);

  const tallies = tallySecretPatterns(repoPath, scanned);
  mergeSecretTallies(tallies, tallySecretPatterns(repoPath, hiddenScanned));
  const secrets = findingsFromTallies(tallies);

  const auth = detectAuth(depNames, ecosystems, files);
  const secHeaders = detectSecurityHeaders(repoPath, scanned);
  const validation = detectInputValidation(depNames, ecosystems);
  const rateLimit = detectRateLimiting(repoPath, depNames, ecosystems, scanned);

  // AUDIT_TOOLS is consulted once; securityTools and auditEvidence reuse it.
  const auditMatches = unionMatches(depNames, AUDIT_TOOLS, ecosystems);
  const securityTools = detectSecurityTools(repoPath, overview, auditMatches);

  const dependabot = await detectDependabot(repoPath, overview, broker);
  const gitleaks = detectGitleaksContext(repoPath, overview, secrets);

  const envExample =
    hasFile(repoPath, overview, ".env.example") ||
    hasFile(repoPath, overview, ".env.sample") ||
    hasFile(repoPath, overview, ".env.template");

  const gitignore = hasFile(repoPath, overview, ".gitignore");
  let gitignoreCoversEnv = false;
  if (gitignore) {
    const content = readBoundedFile(join(repoPath, ".gitignore"), { containmentRoot: repoPath });
    if (content != null) gitignoreCoversEnv = /\.env/.test(content);
  }

  const hasLockfile = detectHasLockfile(repoPath, overview, ecosystems);
  const auditEvidence = detectAuditEvidence(repoPath, overview, auditMatches);
  const hasAuditScript = auditEvidence.length > 0;

  // Signal: 'high' when there is a lot to surface (secret hits, recognized
  // auth/validation frameworks, or audit evidence); 'medium' when
  // baseline hygiene exists (lockfile, rate limiting, security artifacts, env
  // example, dependabot); 'low' otherwise. A recognized lockfile therefore
  // always lifts the signal to at least 'medium' — the original bug treated
  // uv.lock as "no lockfile" and depressed the signal to 'low'.
  const strongSignal = secrets.length > 0 || auth.detected || hasAuditScript || validation.detected;
  const mediumSignal =
    hasLockfile ||
    rateLimit.detected ||
    securityTools.length > 0 ||
    envExample ||
    dependabot.configured;
  const signal = strongSignal ? "high" : mediumSignal ? "medium" : "low";

  return {
    dimension: "security",
    signal,
    findings: {
      secrets: {
        count: secrets.length,
        findings: secrets,
      },
      auth,
      securityHeaders: secHeaders,
      inputValidation: validation,
      rateLimiting: rateLimit,
      envExample,
      gitignoreEnvProtected: gitignoreCoversEnv,
      hasLockfile,
      auditEvidence,
      hasAuditScript,
      dependabot: dependabot.configured,
      dependabotEvidence: dependabot,
      gitleaks,
      securityTools,
      // F-002/F-018 disclosure: what the bounded secret/header/rate-limit
      // window actually read, including the separate hidden/gitignored pass
      // that feeds only secret-pattern detection. `hiddenEnumerationFailed`
      // marks a pass that could not enumerate at all (rg failure), so an
      // empty hidden window is never misread as full hidden coverage.
      scanCoverage: {
        scannedFiles: scanned.length,
        filesSkipped,
        hiddenScanned: hiddenScanned.length,
        hiddenFilesSkipped,
        ...(hiddenEnumerationFailed ? { hiddenEnumerationFailed: true } : {}),
      },
    },
  };
}
