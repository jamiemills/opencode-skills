import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { commandBroker } from '../shared/command.mjs';
import { DESCRIPTORS, descriptorFor, detectEcosystems } from '../shared/ecosystem.mjs';
import { readManifest } from '../shared/manifest.mjs';
import {
  AUTH_LIBS,
  INPUT_VALIDATION_LIBS,
  RATE_LIMIT_LIBS,
  AUDIT_TOOLS,
  matchDep,
} from '../shared/detection.mjs';

// Canonical lockfile vocabulary across every ecosystem we recognize.
// Sourced from the descriptor table (single source of truth) plus a small set
// of ecosystems (Go/PHP/Elixir/Deno/Ruby) the descriptors do not yet model, so
// a recognized lockfile always lifts the security signal regardless of stack.
// `bun.lock` / `pdm.lock` arrive here via the JS/Python descriptor lockfile
// lists, so they are recognized without any extra hardcoding.
const EXTRA_LOCKFILES = ['go.sum', 'deno.lock', 'composer.lock', 'mix.lock', 'Gemfile.lock'];
const KNOWN_LOCKFILES = [
  ...new Set([
    ...EXTRA_LOCKFILES,
    ...Object.values(DESCRIPTORS).flatMap((d) => (Array.isArray(d.lockfiles) ? d.lockfiles : [])),
  ]),
];

// Bounds for the direct-read replacements of the former rg pipelines.
const SCAN_FILE_LIMIT = 400;
const SCAN_BYTE_LIMIT = 1024 * 1024;

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

async function listFiles(repoPath, overview, broker) {
  const fromOverview = overview && Array.isArray(overview.files) && overview.files.length > 0
    ? overview.files
    : null;
  if (fromOverview) return fromOverview;
  try {
    const result = await broker.execute('rg:files', { cwd: repoPath });
    const raw = result.ok || result.noMatch ? result.stdout : '';
    return raw
      .split('\n')
      .map((s) => s.trim().replace(/\\/g, '/'))
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

function readContent(absPath) {
  try {
    const content = readFileSync(absPath, 'utf-8');
    return content.length > SCAN_BYTE_LIMIT ? null : content;
  } catch {
    return null;
  }
}

// Prefer the survey's normalized manifest; fall back to reading it ourselves.
function resolveManifest(repoPath, overview) {
  if (overview?.manifest && typeof overview.manifest === 'object') return overview.manifest;
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
  for (const key of ['dependencies', 'devDependencies', 'optionalDeps']) {
    const bucket = manifest[key];
    if (bucket && typeof bucket === 'object') {
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
  if (typeof depNames === 'object') return Object.keys(depNames);
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

function detectAuth(depNames, ecosystems) {
  const frameworks = unionMatches(depNames, AUTH_LIBS, ecosystems);
  return { detected: frameworks.length > 0, frameworks };
}

function detectInputValidation(depNames, ecosystems) {
  const libraries = unionMatches(depNames, INPUT_VALIDATION_LIBS, ecosystems);
  return { detected: libraries.length > 0, libraries };
}

function detectRateLimiting(repoPath, depNames, ecosystems, files) {
  const libraries = unionMatches(depNames, RATE_LIMIT_LIBS, ecosystems);

  const codeRe = /rate[_\-]?limit|throttle|debounce/;
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

function detectSecretPatterns(repoPath, files) {
  const patterns = [
    { name: 'AWS Access Key', re: /(?:AWS|aws)[_\-]?access[_\-]?key[_\-]?id?["'\s:=]+([A-Z0-9]{20})/ },
    { name: 'AWS Secret Key', re: /(?:AWS|aws)[_\-]?secret[_\-]?(?:access[_\-]?)?key[_\-]?id?["'\s:=]+([A-Za-z0-9\/+=]{40})/ },
    { name: 'GitHub Token', re: /(?:ghp|gho|ghu|ghs|ghr|github[_\-]?pat)[_\-\w]*['"\s:=]+([A-Za-z0-9_]{36,})/ },
    { name: 'Generic API Key', re: /(?:api[_\-]?key|apikey|API_KEY)["'\s:=]+\s*['"]([A-Za-z0-9_\-]{20,})['"]/i },
    { name: 'Generic Token', re: /(?:token|secret|password|passwd)["'\s:=]+\s*['"]([^\s'"]{16,})['"]\s*$/im },
    { name: 'Private Key Header', re: /-----BEGIN[ ](?:RSA |EC |DSA |OPENSSH )?PRIVATE[ ]KEY-----/ },
    { name: 'JWT Token', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
    { name: 'Slack Token', re: /xox[abpos]-[\d]+-[\d]+-[\d]+-[A-Za-z0-9]+/ },
    { name: 'Stripe Key', re: /(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{24,}/ },
    { name: 'Heroku API Key', re: /[Hh][Ee][Rr][Oo][Kk][Uu][_\s-]*[Aa][Pp][Ii][_\s-]*[Kk][Ee][Yy]["'\s:=]+\s*['"]([A-Za-z0-9_-]{16,})['"]/ },
    { name: 'MongoDB URI', re: /mongodb(?:\+srv)?:\/\/[^'"\s]+/i },
    { name: 'Postgres URI', re: /postgres(?:ql)?:\/\/[^:]+:[^@]+@[^'"\s]+/i },
    { name: 'Redis URI', re: /redis:\/\/[^'"\s]+/i },
    { name: 'Basic Auth URL', re: /https?:\/\/[^:]+:[^@]+@[^'"\s]+/i },
    { name: 'NPM Token', re: /npm_[A-Za-z0-9]{36}/ },
    { name: 'Docker Registry Password', re: /(?:docker|registry)[_\s-]*(?:password|pass|pwd)["'\s:=]+\s*['"]([^'"]{8,})['"]/i },
  ];

  const findings = [];
  const bounded = files.slice(0, SCAN_FILE_LIMIT);
  const tallies = patterns.map(({ name, re }) => ({ name, re, count: 0, samples: [] }));

  for (const f of bounded) {
    const content = readContent(join(repoPath, f));
    if (content == null) continue;
    for (const tally of tallies) {
      if (tally.re.test(content)) {
        tally.count++;
        if (tally.samples.length < 3) tally.samples.push(f);
      }
    }
  }

  for (const tally of tallies) {
    if (tally.count > 0) {
      findings.push({ pattern: tally.name, files: tally.samples, totalFiles: tally.count });
    }
  }

  return findings;
}

function detectSecurityHeaders(repoPath, files) {
  const patterns = [
    { name: 'CORS', re: /(?:cors|Access-Control-Allow-Origin)/i },
    { name: 'CSP', re: /Content-Security-Policy/i },
    { name: 'HSTS', re: /Strict-Transport-Security/i },
    { name: 'XSS Protection', re: /X-XSS-Protection/i },
    { name: 'Frame Options', re: /X-Frame-Options/i },
    { name: 'Content Type Options', re: /X-Content-Type-Options/i },
    { name: 'Helmet.js', re: /helmet/i },
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

  if (hasFile(repoPath, overview, '.gitleaks.toml')) pushUnique('.gitleaks.toml');
  if (hasFile(repoPath, overview, '.gitleaksignore')) pushUnique('.gitleaksignore');
  if (hasFile(repoPath, overview, 'SECURITY.md')) {
    pushUnique('SECURITY.md');
  } else if (hasFile(repoPath, overview, '.github/SECURITY.md')) {
    pushUnique('.github/SECURITY.md');
  }

  // bandit config: standalone file or pyproject [tool.bandit] section. When a
  // config is present the bandit DEP (matched below via AUDIT_TOOLS) is dropped
  // to avoid a redundant duplicate entry for the same tool.
  let banditConfig = false;
  if (hasFile(repoPath, overview, '.bandit')) {
    pushUnique('.bandit');
    banditConfig = true;
  }
  if (!banditConfig && hasFile(repoPath, overview, 'pyproject.toml')) {
    try {
      const txt = readFileSync(join(repoPath, 'pyproject.toml'), 'utf-8');
      if (/^\s*\[tool\.bandit\]/m.test(txt)) {
        pushUnique('bandit config');
        banditConfig = true;
      }
    } catch {}
  }

  for (const m of auditMatches) {
    if (m.package === 'bandit' && banditConfig) continue;
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

const PACKAGE_AUDIT_PATTERN = /\b(?:npm\s+audit|yarn\s+audit|cargo(?:\s+|-)audit|pip-audit|snyk|audit)\b/i;
const FILE_AUDIT_PATTERN = /\b(?:bandit|safety|gitleaks|pip-audit|cargo(?:\s+|-)audit|cargo(?:\s+|-)deny|trufflehog|semgrep)\b/gi;

// Best-effort references in Makefile and GitHub Actions files. These are
// evidence of a textual reference only; this scanner does not parse whether a
// workflow step or recipe executes the referenced tool.
function scanAuditReferences(repoPath, overview) {
  const targets = [];
  if (hasFile(repoPath, overview, 'Makefile')) targets.push({ source: 'makefile', location: 'Makefile' });

  const wfDir = join(repoPath, '.github', 'workflows');
  try {
    if (existsSync(wfDir)) {
      for (const f of readdirSync(wfDir).sort()) {
        if (f.endsWith('.yml') || f.endsWith('.yaml')) {
          targets.push({ source: 'workflow', location: `.github/workflows/${f}` });
        }
      }
    }
  } catch {}

  const evidence = [];
  for (const target of targets) {
    try {
      const txt = readFileSync(join(repoPath, target.location), 'utf-8');
      for (const match of txt.matchAll(FILE_AUDIT_PATTERN)) {
        evidence.push({ ...target, tool: match[0] });
      }
    } catch {}
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
    const pkg = readJSON(join(repoPath, 'package.json'));
    if (pkg?.scripts && typeof pkg.scripts === 'object') {
      for (const [name, command] of Object.entries(pkg.scripts).sort(([a], [b]) => a.localeCompare(b))) {
        if (typeof command !== 'string') continue;
        const match = command.match(PACKAGE_AUDIT_PATTERN);
        if (match) {
          pushUnique({
            source: 'package-script',
            location: `package.json#scripts.${name}`,
            tool: match[0],
          });
        }
      }
    }
  } catch {}

  for (const match of Array.isArray(auditMatches) ? auditMatches : []) {
    if (typeof match?.package === 'string' && match.package) {
      pushUnique({ source: 'dependency', location: 'manifest', tool: match.package });
    }
  }

  for (const entry of scanAuditReferences(repoPath, overview)) pushUnique(entry);
  return evidence;
}

export async function scan(repoPath, overview, broker = commandBroker) {
  const manifest = resolveManifest(repoPath, overview);
  const depNames = collectDepNames(manifest);
  const ecosystems = resolveEcosystems(overview, manifest);
  const files = await listFiles(repoPath, overview, broker);

  const secrets = detectSecretPatterns(repoPath, files);
  const auth = detectAuth(depNames, ecosystems);
  const secHeaders = detectSecurityHeaders(repoPath, files);
  const validation = detectInputValidation(depNames, ecosystems);
  const rateLimit = detectRateLimiting(repoPath, depNames, ecosystems, files);

  // AUDIT_TOOLS is consulted once; securityTools and auditEvidence reuse it.
  const auditMatches = unionMatches(depNames, AUDIT_TOOLS, ecosystems);
  const securityTools = detectSecurityTools(repoPath, overview, auditMatches);

  const envExample = hasFile(repoPath, overview, '.env.example') ||
    hasFile(repoPath, overview, '.env.sample') ||
    hasFile(repoPath, overview, '.env.template');

  const gitignore = hasFile(repoPath, overview, '.gitignore');
  let gitignoreCoversEnv = false;
  if (gitignore) {
    try {
      const content = readFileSync(join(repoPath, '.gitignore'), 'utf-8');
      gitignoreCoversEnv = /\.env/.test(content);
    } catch {}
  }

  const hasLockfile = detectHasLockfile(repoPath, overview, ecosystems);
  const auditEvidence = detectAuditEvidence(repoPath, overview, auditMatches);
  const hasAuditScript = auditEvidence.length > 0;

  const dependabot = hasFile(repoPath, overview, '.github/dependabot.yml') ||
    hasFile(repoPath, overview, '.github/dependabot.yaml');

  // Signal: 'high' when there is a lot to surface (secret hits, recognized
  // auth/validation frameworks, or audit evidence); 'medium' when
  // baseline hygiene exists (lockfile, rate limiting, security artifacts, env
  // example, dependabot); 'low' otherwise. A recognized lockfile therefore
  // always lifts the signal to at least 'medium' — the original bug treated
  // uv.lock as "no lockfile" and depressed the signal to 'low'.
  const strongSignal =
    secrets.length > 0 || auth.detected || hasAuditScript || validation.detected;
  const mediumSignal =
    hasLockfile || rateLimit.detected || securityTools.length > 0 || envExample || dependabot;
  const signal = strongSignal ? 'high' : mediumSignal ? 'medium' : 'low';

  return {
    dimension: 'security',
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
      dependabot,
      securityTools,
    },
  };
}
