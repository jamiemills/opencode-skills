import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { commandBroker } from '../shared/command.mjs';
import { descriptorFor, detectEcosystems } from '../shared/ecosystem.mjs';
import { countComments } from '../shared/comments.mjs';

// Per-ecosystem file sample for comment analysis. Mirrors conventions.mjs so
// documentation.commentRatio and conventions.commentDensity are computed over
// the SAME sample; counting is delegated to shared/comments.mjs (single source
// of truth) so the two deep scanners agree exactly (T111 systemic fix).
const COMMENT_FILES_PER_ECO = 20;
const SUPPORTED_COMMENT_ECOS = ['python', 'javascript', 'typescript', 'rust', 'shell'];
const TODO_FILE_LIMIT = 400;
const TODO_BYTE_LIMIT = 1024 * 1024;

// Reference-artifact detection (T012): QUALITY_GATES.md-style reference docs
// and SECURITY.md become part of the documentation inventory.
const REFERENCE_DOC_NAMES = ['QUALITY_GATES.md', 'quality-gates.md', 'quality_gates.md', 'QUALITY_GATE.md', 'REFERENCE.md'];
const REFERENCE_DOC_MIN_LINES = 100;
const RFC2119_RE = /\bRFC\s*2119\b/i;
const NORMATIVE_KEYWORD_RE = /\b(?:MUST|SHOULD)\b/;
const GATE_ID_RE = /[a-z][a-z0-9-]*(\.[a-z0-9-]+)+/g;
const GATE_ID_MIN_DISTINCT = 3;
const REPLICATION_CARDS_RE = /agent\s+replication\s+cards?/i;

// Doc-toolchain detection (T012): doc-validation scripts referenced in
// Makefile / opencode config. Bounded pattern scan of small config files.
const DOC_TOOLCHAIN_SOURCES = ['Makefile', 'makefile', 'opencode.json', 'opencode.jsonc'];
const DOC_TOOLCHAIN_BYTE_LIMIT = 128 * 1024;
const DOC_TOOLCHAIN_PATTERN = /\b(?:check-config|docs-check|docs_check|pre-push-docs|doc-toolchain|validate-docs)[a-z0-9_.-]*/gi;

const SECURITY_PURPOSE_TOKENS = [
  { re: /responsible disclosure/i, purpose: 'responsible disclosure' },
  { re: /report/i, purpose: 'vulnerability reporting' },
  { re: /token|cookie|secret/i, purpose: 'token handling' },
];

function readFile(path) {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

// Returns the repo-relative name of the first existing candidate (T005:
// findings carry repo-relative paths so NORMS.md never embeds host absolute
// paths). Callers that read the file join it with repoPath themselves.
function findFile(repoPath, names) {
  for (const name of names) {
    if (existsSync(join(repoPath, name))) return name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

// Order matters: more specific tokens first so that, e.g., a license badge
// whose URL also contains "github" is classified as 'license' rather than 'ci'.
// Each rule tests the captured shields.io URL only (never the whole document),
// which eliminates the false positives the old whole-document includes() caused.
const BADGE_URL_RULES = [
  { re: /codecov|coveralls|coverage/, type: 'coverage' },
  { re: /license/, type: 'license' },
  { re: /pypi|pypi\.org/, type: 'pypi' },
  { re: /npm/, type: 'npm' },
  { re: /version/, type: 'version' },
  { re: /github|actions|\bci\b|workflow|build|travis|circleci/, type: 'ci' },
];

function classifyBadgeUrl(url) {
  const u = String(url || '').toLowerCase();
  for (const rule of BADGE_URL_RULES) {
    if (rule.re.test(u)) return rule.type;
  }
  return null;
}

function detectBadges(content) {
  if (!content) return { count: 0, types: [] };
  const badgeRe = /!\[[^\]]*\]\((https:\/\/img\.shields\.io\/[^)]+)\)/g;
  const types = [];
  let count = 0;
  let m;
  while ((m = badgeRe.exec(content)) !== null) {
    count++;
    const t = classifyBadgeUrl(m[1]);
    if (t && !types.includes(t)) types.push(t);
  }
  return { count, types };
}

// ---------------------------------------------------------------------------
// README structure / changelog / ADRs
// ---------------------------------------------------------------------------

function checkReadmeStructure(content) {
  if (!content) return { hasSetup: false, hasArchitecture: false, hasApi: false, hasContributing: false };
  const lower = content.toLowerCase();
  return {
    hasSetup: /(installation|setup|getting started|quickstart)/i.test(lower),
    hasArchitecture: /\barchitecture\b/i.test(lower),
    hasApi: /\bapi\b/i.test(lower) && (lower.includes('documentation') || lower.includes('reference')),
    hasContributing: /\bcontributing\b/i.test(lower),
    hasLicense: /\blicense\b/i.test(lower),
    sections: (content.match(/^#{1,3}\s+/gm) || []).length,
  };
}

function checkChangelog(repoPath) {
  const clPath = findFile(repoPath, ['CHANGELOG.md', 'Changelog.md', 'CHANGES.md', 'HISTORY.md']);
  if (!clPath) return { present: false, format: 'none' };

  let format = 'free-form';
  try {
    const content = readFileSync(join(repoPath, clPath), 'utf-8');
    const kep = /keep a changelog/i.test(content);
    const semver = /\b(added|changed|deprecated|removed|fixed|security)\b/i.test(content);
    const versions = /\d+\.\d+\.\d+/g;
    const verMatches = content.match(versions);
    const hasVersionHeaders = verMatches && verMatches.length >= 2;

    if (kep && semver) format = 'Keep a Changelog';
    else if (hasVersionHeaders && semver) format = 'Semantic versioning with change categories';
    else if (hasVersionHeaders) format = 'Versioned entries';
    else format = 'free-form';
  } catch {}

  return { present: true, format, path: clPath };
}

function detectADRs(repoPath) {
  const patterns = ['docs/adr', 'doc/adr', 'adr', 'decisions', 'docs/decisions', 'doc/architecture/decisions'];
  const dirs = [];
  for (const pat of patterns) {
    const full = join(repoPath, pat);
    if (existsSync(full)) {
      const stat = statSync(full);
      if (stat.isDirectory()) {
        let count = 0;
        try {
          for (const entry of readdirSync(full)) {
            if (entry.endsWith('.md')) count++;
          }
        } catch {}
        dirs.push({ path: pat, count });
      }
    }
  }
  return dirs;
}

// ---------------------------------------------------------------------------
// Comment ratio (ecosystem-aware via shared/comments.mjs)
// ---------------------------------------------------------------------------
// T111 systemic fix: counting is delegated to shared/comments.mjs
// `countComments` (the single source of truth) and the file sampling mirrors
// conventions.mjs (resolveEcosystems + listFiles + filterByExt + slice(0, N)
// per ecosystem). documentation.commentRatio and conventions.commentDensity
// therefore scan the SAME files with the SAME counter and agree exactly.

function resolveEcosystems(overview) {
  const ov = overview || {};
  if (ov.ecosystems && (ov.ecosystems.primary || (Array.isArray(ov.ecosystems.all) && ov.ecosystems.all.length > 0))) {
    return ov.ecosystems;
  }
  return detectEcosystems(ov, ov.manifest || {});
}

function resolveAllEcosystems(overview) {
  const ecos = resolveEcosystems(overview);
  if (Array.isArray(ecos.all) && ecos.all.length > 0) return [...ecos.all];
  if (ecos.primary) return [ecos.primary];
  return [];
}

async function listSourceFiles(repoPath, overview, broker) {
  const fromOverview = overview && Array.isArray(overview.files) && overview.files.length > 0
    ? overview.files
    : null;
  if (fromOverview) return fromOverview;
  try {
    const result = await broker.execute('rg:files', { cwd: repoPath });
    const raw = result.ok || result.noMatch ? result.stdout : '';
    return raw.split('\n').map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean).toSorted();
  } catch {
    return [];
  }
}

// Mirrors conventions.mjs filterByExt so the file selection is identical.
function filterByExt(files, extensions) {
  const set = new Set(extensions);
  const out = [];
  for (const f of files) {
    const base = f.split('/').pop() || '';
    const dot = base.lastIndexOf('.');
    if (dot <= 0) continue; // skip dotfiles and extensionless names
    if (set.has(base.slice(dot).toLowerCase())) out.push(f);
  }
  return out;
}

function computeCommentRatio(repoPath, overview, files) {
  const all = resolveAllEcosystems(overview);

  let totalLines = 0;
  let commentLines = 0;

  for (const eco of all) {
    if (!SUPPORTED_COMMENT_ECOS.includes(eco)) continue;
    const desc = descriptorFor(eco);
    if (!desc) continue;
    const subset = filterByExt(files, desc.extensions).slice(0, COMMENT_FILES_PER_ECO);
    for (const f of subset) {
      const content = readFile(join(repoPath, f));
      if (!content) continue;
      const r = countComments(content, eco);
      commentLines += r.commentLines;
      totalLines += r.totalLines;
    }
  }

  const ratio = totalLines > 0 ? parseFloat(((commentLines / totalLines) * 100).toFixed(1)) : 0;
  return { ratio, commentLines, codeLines: totalLines - commentLines };
}

// ---------------------------------------------------------------------------
// Python docstring dialect (Google / NumPy / Sphinx / reST) — P2 richness
// ---------------------------------------------------------------------------

const GOOGLE_SECTION_RE = /^\s*(Args|Arguments|Returns|Yields|Raises|Attributes|Examples?|Notes?|References|See Also|Other Parameters|Warnings?|Todo)\s*:\s*$/;
const NUMPY_HEADER_RE = /^(Parameters|Returns|Raises|Yields|Attributes|See Also|Notes|Examples|References|Other Parameters|Warns)\s*$/;
const SPHINX_FIELD_RE = /^:\s*(param|parameter|type|return|returns|rtype|raises|yield|yields|ivar|cvar|vtype)\b/;
const REST_DIRECTIVE_RE = /^\.\.\s+[\w-]+::/;
const DASH_RULE_RE = /^\s*(-{3,}|={3,})\s*$/;

function classifyPythonDocstring(text) {
  const counts = { google: 0, numpy: 0, sphinx: 0, rest: 0 };
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (GOOGLE_SECTION_RE.test(line)) counts.google++;
    if (SPHINX_FIELD_RE.test(line.trim())) counts.sphinx++;
    if (REST_DIRECTIVE_RE.test(line.trim())) counts.rest++;
    if (DASH_RULE_RE.test(line) && i > 0 && NUMPY_HEADER_RE.test(lines[i - 1].trim())) counts.numpy++;
  }
  return counts;
}

function detectPythonDocstringDialect(repoPath, overview, files) {
  const pyFiles = filterByExt(files, ['.py', '.pyi']).slice(0, COMMENT_FILES_PER_ECO);
  const totals = { google: 0, numpy: 0, sphinx: 0, rest: 0 };
  for (const f of pyFiles) {
    const content = readFile(join(repoPath, f));
    if (!content) continue;
    const c = classifyPythonDocstring(content);
    for (const k of Object.keys(totals)) totals[k] += c[k];
  }
  const order = ['google', 'numpy', 'sphinx', 'rest'];
  let dominant = null;
  let best = 0;
  for (const k of order) {
    if (totals[k] > best) {
      best = totals[k];
      dominant = k;
    }
  }
  return { dominant, counts: totals, filesAnalyzed: pyFiles.length };
}

// ---------------------------------------------------------------------------
// JSDoc vs TSDoc — P2 richness (TypeScript)
// ---------------------------------------------------------------------------

const DOC_BLOCK_RE = /\/\*\*[\s\S]*?\*\//g;
const TSDOC_TAG_RE = /@(template|typeParam|override|public|private|protected|readonly|sealed|internal|virtual|abstract|satisfies)\b/;

function classifyDocBlocks(text, isTs) {
  const blocks = text.match(DOC_BLOCK_RE) || [];
  let jsdoc = 0;
  let tsdoc = 0;
  for (const b of blocks) {
    // TS modifier/type tags (e.g. @template, @override) are TSDoc signatures.
    // Otherwise blocks in .ts files count as TSDoc, in .js files as JSDoc.
    if (isTs || TSDOC_TAG_RE.test(b)) tsdoc++;
    else jsdoc++;
  }
  return { jsdoc, tsdoc };
}

function detectDocStyle(repoPath, overview, files) {
  const result = { jsdocBlocks: 0, tsdocBlocks: 0, dominant: null, filesAnalyzed: 0 };
  for (const eco of resolveAllEcosystems(overview)) {
    if (eco !== 'javascript' && eco !== 'typescript') continue;
    const desc = descriptorFor(eco);
    if (!desc) continue;
    const subset = filterByExt(files, desc.extensions).slice(0, COMMENT_FILES_PER_ECO);
    result.filesAnalyzed += subset.length;
    for (const f of subset) {
      const content = readFile(join(repoPath, f));
      if (!content) continue;
      const r = classifyDocBlocks(content, eco === 'typescript');
      result.jsdocBlocks += r.jsdoc;
      result.tsdocBlocks += r.tsdoc;
    }
  }
  if (result.tsdocBlocks > result.jsdocBlocks) result.dominant = 'tsdoc';
  else if (result.jsdocBlocks > result.tsdocBlocks) result.dominant = 'jsdoc';
  return result;
}

// ---------------------------------------------------------------------------
// License + TODOs
// ---------------------------------------------------------------------------

function detectLicense(repoPath) {
  const licFiles = [
    'LICENSE', 'LICENSE.md', 'LICENSE.txt',
    'LICENCE', 'LICENCE.md', 'LICENCE.txt',
    'COPYING', 'UNLICENSE',
  ];
  const found = findFile(repoPath, licFiles);
  if (!found) return { present: false, name: 'none' };

  let name = 'unknown';
  try {
    const content = readFileSync(join(repoPath, found), 'utf-8').slice(0, 2000).toLowerCase();
    if (content.includes('mit license') || (content.includes('mit') && content.includes('permission'))) name = 'MIT';
    else if (content.includes('apache license') || content.includes('apache 2.0')) name = 'Apache-2.0';
    else if (content.includes('gnu general public license')) name = 'GPL';
    else if (content.includes('gnu lesser general public license')) name = 'LGPL';
    else if (content.includes('bsd')) name = 'BSD';
    else if (content.includes('isc')) name = 'ISC';
    else if (content.includes('unlicense')) name = 'Unlicense';
    else if (content.includes('mozilla public license')) name = 'MPL';
    else if (content.includes('creative commons')) name = 'CC';
    else name = 'Other (see file)';
  } catch {}

  return { present: true, name, path: found };
}

// ---------------------------------------------------------------------------
// Reference artifacts (T012) — QUALITY_GATES.md / equivalent large reference
// docs plus SECURITY.md. Deterministic, bounded to root-level markdown files.
// ---------------------------------------------------------------------------

function countLines(content) {
  if (!content) return 0;
  let count = 0;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) count++;
  }
  return content.length > 0 ? count + 1 : 0;
}

function referenceDocMarkers(content) {
  const markers = [];
  if (RFC2119_RE.test(content) && NORMATIVE_KEYWORD_RE.test(content)) {
    markers.push('RFC 2119 vocabulary');
  }
  const ids = new Set();
  for (const match of content.matchAll(GATE_ID_RE)) {
    ids.add(match[0]);
    if (ids.size >= GATE_ID_MIN_DISTINCT) break;
  }
  if (ids.size >= GATE_ID_MIN_DISTINCT) markers.push('stable gate IDs');
  if (REPLICATION_CARDS_RE.test(content)) markers.push('agent replication cards');
  return markers;
}

function detectReferenceDocs(repoPath, files) {
  const normalized = (files || []).map((file) => file.replace(/\\/g, '/'));
  const rootMarkdown = normalized
    .filter((file) => !file.includes('/'))
    .filter((file) => /\.md$/i.test(file));
  const candidates = new Set([...REFERENCE_DOC_NAMES, ...rootMarkdown]);
  const docs = [];
  for (const rel of candidates) {
    const isNamed = REFERENCE_DOC_NAMES.includes(rel);
    if (!isNamed && !rootMarkdown.includes(rel)) continue;
    const p = join(repoPath, rel);
    if (!existsSync(p)) continue;
    const content = readFile(p);
    if (!content || countLines(content) < REFERENCE_DOC_MIN_LINES) continue;
    const markers = referenceDocMarkers(content);
    // A named candidate qualifies on its name; an "equivalent" doc must carry
    // the full normative-reference marker set (RFC 2119, stable gate IDs, and
    // replication cards) so quoted summaries (e.g. a scanned report) are not
    // mistaken for a reference artifact.
    if (isNamed || markers.length >= 3) {
      docs.push({ path: rel, lines: countLines(content), markers });
    }
  }
  return { present: docs.length > 0, docs };
}

function detectSecurity(repoPath) {
  const secPath = findFile(repoPath, ['SECURITY.md', 'security.md', '.github/SECURITY.md', '.github/security.md']);
  if (!secPath) return { present: false, path: null, purpose: null };
  const content = readFile(join(repoPath, secPath)) || '';
  let purpose = 'security policy';
  for (const { re, purpose: token } of SECURITY_PURPOSE_TOKENS) {
    if (re.test(content)) {
      purpose = token;
      break;
    }
  }
  return { present: true, path: secPath, purpose };
}

function normalizeToolchainScripts(tokens) {
  const list = [...tokens];
  return list
    .filter((token) => !list.some((other) => other.length > token.length && other.startsWith(token)))
    .toSorted();
}

function detectDocToolchain(repoPath) {
  const scripts = new Set();
  const sources = [];
  for (const rel of DOC_TOOLCHAIN_SOURCES) {
    const p = join(repoPath, rel);
    if (!existsSync(p)) continue;
    let content = null;
    try {
      content = readFileSync(p, 'utf-8').slice(0, DOC_TOOLCHAIN_BYTE_LIMIT);
    } catch {
      continue;
    }
    if (!content) continue;
    const matches = content.match(DOC_TOOLCHAIN_PATTERN) || [];
    if (matches.length === 0) continue;
    sources.push(rel);
    for (const match of matches) {
      scripts.add(match.toLowerCase().replace(/\.(ts|js)$/, ''));
    }
  }
  return {
    present: scripts.size > 0,
    scripts: normalizeToolchainScripts(scripts),
    sources: [...sources].toSorted(),
  };
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

export async function scan(repoPath, overview, broker = commandBroker) {
  const files = await listSourceFiles(repoPath, overview, broker);
  const readmePath = findFile(repoPath, ['README.md', 'readme.md', 'Readme.md', 'README.markdown', 'README.rst', 'README']);
  const readmeContent = readmePath ? readFile(join(repoPath, readmePath)) : null;

  const badges = detectBadges(readmeContent);
  const readmeStructure = checkReadmeStructure(readmeContent);
  const changelog = checkChangelog(repoPath);
  const adrs = detectADRs(repoPath);

  const contributingPath = findFile(repoPath, ['CONTRIBUTING.md', 'Contributing.md', 'contributing.md', '.github/CONTRIBUTING.md']);
  const hasCodeOfConduct = existsSync(join(repoPath, 'CODE_OF_CONDUCT.md')) ||
    existsSync(join(repoPath, '.github/CODE_OF_CONDUCT.md'));

  const commentRatio = computeCommentRatio(repoPath, overview, files);
  const docstringDialect = detectPythonDocstringDialect(repoPath, overview, files);
  const docStyle = detectDocStyle(repoPath, overview, files);
  const license = detectLicense(repoPath);
  const referenceDocs = detectReferenceDocs(repoPath, files);
  const security = detectSecurity(repoPath);
  const docToolchain = detectDocToolchain(repoPath);

  let todoCount = 0;
  for (const file of files.slice(0, TODO_FILE_LIMIT)) {
    const content = readFile(join(repoPath, file));
    if (content == null || content.length > TODO_BYTE_LIMIT) continue;
    if (/TODO|FIXME|HACK|XXX/i.test(content)) todoCount++;
  }

  const signal = readmePath ? 'high' : 'medium';

  return {
    dimension: 'documentation',
    signal,
    findings: {
      readme: {
        present: !!readmePath,
        path: readmePath || null,
        badges: badges.count,
        badgeTypes: badges.types,
        ...readmeStructure,
      },
      contributing: {
        present: !!contributingPath,
        path: contributingPath || null,
      },
      codeOfConduct: hasCodeOfConduct,
      changelog,
      adrs,
      commentRatio,
      docstringDialect,
      docStyle,
      license,
      referenceDocs,
      security,
      docToolchain,
      todoCount,
    },
  };
}
