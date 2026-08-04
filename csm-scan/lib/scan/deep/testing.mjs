// Deep scanner: testing dimension.
//
// Data-driven and ecosystem-agnostic. Consults the shared ecosystem
// descriptor table (DESCRIPTORS / descriptorFor) instead of hardcoded
// JS-only maps, so python / rust / shell / typescript are all covered.
//
// ESM only. Zero npm deps. node: builtins only.
// Read-only with respect to the scanned repo.
//
// Contract (consumed by write.mjs `testingSection`):
//   return { dimension: 'testing', signal, findings: {
//     framework:   string[],          // display names; ['unknown'] when none
//     testDirs:    string[],          // dirs that contain matched test files
//     fileCount:   number,            // matched test files
//     naming:      string[],          // descriptor globs that matched
//     sampleFiles: string[],          // first 15 matched files
//     coverage:    string[]|null,     // detected coverage signals (incl.
//                                      //   fail_under gate facts when declared)
//     configFiles: string[]|null,     // detected test config (incl. markers)
//     script:      string|null,       // package.json test script
//     markers:     string[]|undefined,// declared pytest marker taxonomy (only
//                                      //   when [tool.pytest.ini_options]
//                                      //   carries a markers key)
//   } }

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { descriptorFor, detectEcosystems } from '../shared/ecosystem.mjs';
import { readManifest } from '../shared/manifest.mjs';
import { parseToml } from '../shared/parse.mjs';
import { enumerate } from '../shared/enum.mjs';

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function uniq(arr) {
  return [...new Set(arr)];
}

function parentDir(rel) {
  const p = String(rel).replace(/\\/g, '/');
  const i = p.lastIndexOf('/');
  return i === -1 ? '.' : p.slice(0, i);
}

// Extract the leading package name from a PEP 508 spec such as
// "pytest>=7.0", "mcp>=1.28.1,<2.0.0", or
// "atheris>=3.1.0; sys_platform == 'linux' and platform_machine == 'x86_64'".
function pep508Name(spec) {
  if (typeof spec !== 'string') return null;
  const s = spec.split(';')[0].trim();
  const m = s.match(/^([A-Za-z0-9_.-]+)/);
  return m ? m[1] : null;
}

function readToml(repoPath, file) {
  try {
    return parseToml(readFileSync(join(repoPath, file), 'utf-8'));
  } catch {
    return null;
  }
}

function tomlSectionPresent(parsed, dotted) {
  if (!parsed || typeof parsed !== 'object') return false;
  let node = parsed;
  for (const part of String(dotted).split('.')) {
    if (node == null || typeof node !== 'object') return false;
    node = node[part];
  }
  return node != null;
}

// ---------------------------------------------------------------------------
// Glob matcher
//   *  -> [^/]*       (single path segment)
//   ** -> .*          (any depth, incl. zero dirs when followed by /)
//   ?  -> [^/]
//   {a,b} -> (?:a|b)
//
// A glob containing '/' is anchored to the repo root path; a glob with no
// '/' is matched against the file basename (gitignore / ripgrep semantics).
// ---------------------------------------------------------------------------

function globToRegex(glob) {
  const anchored = glob.includes('/');
  let re = '';
  let i = 0;
  const n = glob.length;
  while (i < n) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 3; }
      else { re += '.*'; i += 2; }
    } else if (c === '*') {
      re += '[^/]*';
      i += 1;
    } else if (c === '?') {
      re += '[^/]';
      i += 1;
    } else if (c === '{') {
      const end = glob.indexOf('}', i + 1);
      if (end === -1) {
        re += '\\{';
        i += 1;
      } else {
        const opts = glob.slice(i + 1, end).split(',').map(escapeRegex);
        re += '(?:' + opts.join('|') + ')';
        i = end + 1;
      }
    } else {
      re += escapeRegex(c);
      i += 1;
    }
  }
  return { anchored, regex: new RegExp('^' + re + '$') };
}

function globMatchesFile(compiled, relPath) {
  const posix = String(relPath).replace(/\\/g, '/');
  const target = compiled.anchored ? posix : posix.split('/').pop();
  return compiled.regex.test(target);
}

// Expand {a,b,c} groups into literal candidate strings.
function expandBraces(glob) {
  const i = glob.indexOf('{');
  if (i === -1) return [glob];
  const j = glob.indexOf('}', i);
  if (j === -1) return [glob];
  const prefix = glob.slice(0, i);
  const opts = glob.slice(i + 1, j).split(',');
  const suffix = glob.slice(j + 1);
  const out = [];
  for (const o of opts) out.push(...expandBraces(prefix + o + suffix));
  return out;
}

// ---------------------------------------------------------------------------
// Dependency-name collection
// ---------------------------------------------------------------------------

function collectDepNames(manifest, repoPath) {
  const names = new Set();
  const sources = [
    manifest && manifest.dependencies,
    manifest && manifest.devDependencies,
    manifest && manifest.optionalDeps,
  ];
  for (const obj of sources) {
    if (obj && typeof obj === 'object') {
      for (const k of Object.keys(obj)) names.add(k);
    }
  }
  // PEP 735 [dependency-groups] is intentionally outside the shared manifest
  // reader's subset; gather it here so dev tools declared there (pytest,
  // hypothesis, pytest-xdist, ...) remain visible to the testing scanner.
  const pp = readToml(repoPath, 'pyproject.toml');
  const dg = pp && pp['dependency-groups'];
  if (dg && typeof dg === 'object') {
    for (const list of Object.values(dg)) {
      if (!Array.isArray(list)) continue;
      for (const spec of list) {
        const name = pep508Name(spec);
        if (name) names.add(name);
      }
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// Test-file matching
// ---------------------------------------------------------------------------

// Python files that look like tests by glob but are not test modules: fixture
// trees, support/harness code, Hypothesis strategy modules, and package
// scaffolding. Excluded at match time (not only via globs) so the disclosed
// counting rule holds even when a repo places `test_*.py` inside these dirs.
function isPythonNonTestFile(relPath) {
  const posix = String(relPath).replace(/\\/g, '/');
  if (posix.startsWith('tests/fixtures/')) return true;
  if (posix.startsWith('tests/support/')) return true;
  const base = posix.split('/').pop() || '';
  if (base === '_fuzz_harnesses.py') return true;
  if (base === 'strategies.py') return true;
  if (base === '__init__.py') return true;
  return false;
}

function matchTestFiles(ecosystems, files) {
  const matched = new Set();
  const naming = [];
  const byEco = new Map(); // ecosystem -> Set(matched files)

  for (const eco of ecosystems) {
    const d = descriptorFor(eco);
    if (!d || !Array.isArray(d.testFileGlobs)) continue;
    const compiled = d.testFileGlobs.map((g) => ({ glob: g, ...globToRegex(g) }));
    for (const c of compiled) {
      let hit = false;
      for (const f of files) {
        if (eco === 'python' && isPythonNonTestFile(f)) continue;
        if (globMatchesFile(c, f)) {
          matched.add(f);
          if (!byEco.has(eco)) byEco.set(eco, new Set());
          byEco.get(eco).add(f);
          hit = true;
        }
      }
      if (hit) naming.push(c.glob);
    }
  }

  return {
    matched: [...matched].sort(),
    naming: uniq(naming),
    byEco,
  };
}

// ---------------------------------------------------------------------------
// Framework detection
// ---------------------------------------------------------------------------

const MARKER_SCAN_CAP = 40;
// Bounded caps for the supplementary inline/CI scans.
const INLINE_SCAN_CAP = 80;
const CI_SCAN_CAP = 30;

// JS/TS source extensions used for the `node:`-marker and inline scans.
const JS_TS_EXTS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts']);

function scanTestContents(repoPath, files, testFn) {
  let examined = 0;
  for (const f of files) {
    if (examined >= MARKER_SCAN_CAP) break;
    let content;
    try {
      content = readFileSync(join(repoPath, f), 'utf-8');
    } catch {
      continue;
    }
    examined++;
    if (testFn(content)) return true;
  }
  return false;
}

function markerRegex(key) {
  // e.g. '#[test]' -> /#\[\s*test\s*\]/
  const inner = key.replace(/^#\[\s*|\s*\]$/g, '');
  return new RegExp('#\\[\\s*' + escapeRegex(inner) + '\\s*\\]');
}

function importRegex(name) {
  const e = escapeRegex(name);
  return new RegExp('(?:^|\\n)\\s*(?:import\\s+' + e + '\\b|from\\s+' + e + '\\b)');
}

// Quoted module-specifier matcher for JS/TS: recognizes `from "name"`,
// `require("name")`, and dynamic `import("name")`, including submodule
// paths like `node:test/reporters`. Used for Node built-in markers such
// as `node:test` which are not installable dependencies.
function moduleSpecifierRegex(name) {
  const e = escapeRegex(name);
  return new RegExp(
    '(?:\\bfrom\\s+|require\\s*\\(\\s*|import\\s*\\(\\s*)[\'"]' + e + '(?:/|[\'"])',
  );
}

function extOf(relPath) {
  const base = String(relPath).replace(/\\/g, '/').split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

function isJsTs(relPath) {
  return JS_TS_EXTS.has(extOf(relPath));
}

// Candidate files for `node:`-marker detection: the ecosystem's matched
// test files first, then any other JS/TS source files (bounded upstream
// by MARKER_SCAN_CAP in scanTestContents). Matches the "test/source files"
// scope of the node:test detection rule.
function jsTsCandidates(fileList, files) {
  const out = [];
  const seen = new Set();
  for (const f of fileList) {
    if (isJsTs(f) && !seen.has(f)) { out.push(f); seen.add(f); }
  }
  for (const f of files) {
    if (isJsTs(f) && !seen.has(f)) { out.push(f); seen.add(f); }
  }
  return out;
}

// Detect Rust inline unit tests: `src/**/*.rs` files carrying `#[test]`,
// `#[cfg(test)]`, or `#[tokio::test]` markers. Integration tests under
// `tests/**` and `*_test.rs` are already covered by the descriptor globs;
// this scan ensures a crate with only inline tests is not reported as
// fileCount 0. Bounded by INLINE_SCAN_CAP.
function detectRustInlineTests(files, repoPath) {
  const inline = new Set();
  const re = /#\[\s*(?:test|cfg\(test\)|tokio::test)\s*\]/;
  let examined = 0;
  for (const f of files) {
    if (extOf(f) !== '.rs') continue;
    const posix = String(f).replace(/\\/g, '/');
    // Only source-tree files; skip already-matched integration tests.
    if (!posix.startsWith('src/') && !posix.includes('/src/')) continue;
    if (examined >= INLINE_SCAN_CAP) break;
    let content;
    try {
      content = readFileSync(join(repoPath, f), 'utf-8');
    } catch {
      continue;
    }
    examined++;
    if (re.test(content)) inline.add(f);
  }
  return inline;
}

// Scan CI/build files (Makefile, .github/workflows/*) for coverage tool
// references so Rust coverage is detectable even when the tool is not a
// Cargo dependency (grcov / llvm-cov / cargo-llvm-cov are invoked from CI).
// Bounded by CI_SCAN_CAP. Note: `enumerate` (rg --files) skips hidden dirs
// such as `.github`, so the workflows directory is also read directly.
function scanCiRefs(repoPath, files, names) {
  const hits = new Set();
  const res = new Map();
  for (const n of names) res.set(n, new RegExp('\\b' + escapeRegex(n) + '\\b'));
  let examined = 0;
  const probe = (content) => {
    for (const [n, re] of res) if (re.test(content)) hits.add(n);
  };

  for (const f of files) {
    const posix = String(f).replace(/\\/g, '/');
    const isCi =
      posix === 'Makefile' || posix === 'makefile' || posix === 'GNUmakefile' ||
      posix.endsWith('.mk') ||
      /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(posix);
    if (!isCi) continue;
    if (examined >= CI_SCAN_CAP) break;
    let content;
    try {
      content = readFileSync(join(repoPath, f), 'utf-8');
    } catch {
      continue;
    }
    examined++;
    probe(content);
  }

  // .github/workflows is hidden -> not listed by enumerate; read it directly.
  const wfDir = join(repoPath, '.github', 'workflows');
  let entries;
  try {
    entries = readdirSync(wfDir);
  } catch {
    entries = [];
  }
  for (const name of entries) {
    if (examined >= CI_SCAN_CAP) break;
    if (!/\.ya?ml$/i.test(name)) continue;
    let content;
    try {
      content = readFileSync(join(wfDir, name), 'utf-8');
    } catch {
      continue;
    }
    examined++;
    probe(content);
  }

  return [...hits];
}

function detectFrameworks(ecosystems, depNames, matchedByEco, repoPath, files) {
  const out = [];
  const seen = new Set();
  const add = (label) => {
    if (label && !seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  };
  const allFiles = Array.isArray(files) ? files : [];

  for (const eco of ecosystems) {
    const d = descriptorFor(eco);
    if (!d || !d.testFrameworks) continue;
    const ecoFiles = matchedByEco.get(eco);
    const fileList = ecoFiles ? [...ecoFiles] : [];

    for (const [key, label] of Object.entries(d.testFrameworks)) {
      // `cargo` is the rust toolchain itself, never a Cargo.toml dependency;
      // treat it as present whenever the rust ecosystem is detected.
      if (key === 'cargo') {
        if (ecosystems.includes('rust')) add(label);
        continue;
      }
      // Code attribute markers, e.g. rust's `#[test]`.
      if (key.startsWith('#')) {
        const re = markerRegex(key);
        if (scanTestContents(repoPath, fileList, (c) => re.test(c))) add(label);
        continue;
      }
      // Node built-in module markers (e.g. `node:test`) are not installable
      // deps; detect by scanning a bounded sample of JS/TS test/source files
      // for the quoted module specifier.
      if (key.startsWith('node:')) {
        const re = moduleSpecifierRegex(key);
        if (scanTestContents(repoPath, jsTsCandidates(fileList, allFiles), (c) => re.test(c))) {
          add(label);
        }
        continue;
      }
      // Ordinary dependency-name key.
      if (depNames.has(key)) {
        add(label);
        continue;
      }
      // stdlib / built-in markers (label tagged "stdlib" or "builtin") are not
      // installable; detect by import/usage inside test files.
      if (/stdlib|builtin/i.test(label)) {
        const re = importRegex(key);
        if (scanTestContents(repoPath, fileList, (c) => re.test(c))) add(label);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Config files
// ---------------------------------------------------------------------------

function detectConfigFiles(ecosystems, files, repoPath) {
  const out = [];
  for (const eco of ecosystems) {
    const d = descriptorFor(eco);
    if (!d || !Array.isArray(d.testConfigFiles)) continue;
    for (const entry of d.testConfigFiles) {
      if (entry.includes(':[')) {
        // marker: `file:[section]` -> file must exist and TOML section present
        const idx = entry.indexOf(':[');
        const file = entry.slice(0, idx);
        const dotted = entry.slice(idx + 2).replace(/\]$/, '');
        if (!existsSync(join(repoPath, file))) continue;
        if (tomlSectionPresent(readToml(repoPath, file), dotted)) out.push(entry);
      } else {
        // plain filename or brace glob: present anywhere in the tree
        const candidates = expandBraces(entry);
        const hit = candidates.some((c) =>
          files.some((f) => f === c || f.split('/').pop() === c) ||
          existsSync(join(repoPath, c)),
        );
        if (hit) out.push(entry);
      }
    }
  }
  return uniq(out);
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

function detectCoverage(ecosystems, depNames, repoPath, files) {
  const out = [];
  const add = (x) => {
    if (!out.includes(x)) out.push(x);
  };
  const allFiles = Array.isArray(files) ? files : [];

  if (ecosystems.includes('python')) {
    if (depNames.has('pytest-cov')) add('pytest-cov');
    else if (depNames.has('coverage')) add('coverage.py');
    if (existsSync(join(repoPath, '.coveragerc'))) add('.coveragerc');
    if (existsSync(join(repoPath, 'coverage.xml'))) add('coverage.xml');
    if (tomlSectionPresent(readToml(repoPath, 'pyproject.toml'), 'tool.coverage')) {
      add('pyproject.toml:[tool.coverage]');
    }
    // Coverage-gate threshold facts (fail_under values). Emitted only when a
    // threshold is actually declared, so detection facts stay unchanged.
    for (const fact of detectCoverageThresholds(repoPath)) add(fact);
  }

  if (ecosystems.includes('javascript') || ecosystems.includes('typescript')) {
    if (depNames.has('nyc')) add('nyc');
    if (depNames.has('c8')) add('c8');
    if (existsSync(join(repoPath, '.nycrc')) || existsSync(join(repoPath, '.nycrc.json'))) {
      add('.nycrc');
    }
    if (depNames.has('vitest')) add('vitest (built-in)');
    else if (depNames.has('jest')) add('jest (built-in)');
    // Previously `existsSync(join(repoPath, 'coverage') || existsSync(...))`
    // which is a precedence bug: the || is evaluated inside join's first
    // argument, yielding a dead branch. Two separate calls now.
    if (existsSync(join(repoPath, 'coverage')) || existsSync(join(repoPath, '.coverage'))) {
      add('coverage directory');
    }
  }

  if (ecosystems.includes('rust')) {
    if (depNames.has('cargo-tarpaulin') || depNames.has('tarpaulin')) add('tarpaulin');
    if (depNames.has('grcov')) add('grcov');
    if (depNames.has('cargo-llvm-cov') || depNames.has('llvm-cov')) add('cargo-llvm-cov');
    // Rust coverage tools are frequently invoked from CI/Makefile rather than
    // declared as Cargo deps; scan those references so coverage is detectable.
    const ci = scanCiRefs(repoPath, allFiles, [
      'grcov',
      'llvm-cov',
      'cargo-llvm-cov',
      'cargo-tarpaulin',
      'tarpaulin',
    ]);
    for (const c of ci) add(c);
  }

  return out.length > 0 ? out : null;
}

// ---------------------------------------------------------------------------
// Coverage thresholds
// ---------------------------------------------------------------------------
//
// A coverage *gate* is the percentage below which a coverage run (or diff-cover
// report) fails. The threshold is declared as `fail_under` in a
// `[tool.coverage.report]` / `[tool.diff_cover]` TOML section, or as a
// `DIFF_COVERAGE_THRESHOLD` environment declaration inside CI/build config.
// These are emitted as extra `coverage` facts (e.g. `coverage fail_under=80`)
// only when a threshold is actually declared, so repos without a gate keep
// their existing detection facts unchanged. A declared-but-unparseable value
// degrades to `fail_under=unverified` rather than silently vanishing.

// Bounded cap for the supplementary DIFF_COVERAGE_THRESHOLD config scan.
const ENV_THRESHOLD_CAP = 12;

// Bounded cap for the declared pytest marker taxonomy.
const MARKER_CAP = 64;

// Collect the declared `[tool.pytest.ini_options] markers` ("name: description"
// strings) into a marker-name list. The fact is conditional-absent: repos
// without a markers key keep byte-identical findings. Self-contained via
// shared/parse.mjs parseToml (no practices style.mjs dependency).
function detectPytestMarkers(repoPath) {
  const parsed = readToml(repoPath, 'pyproject.toml');
  if (!parsed || typeof parsed !== 'object') return null;
  const ini = parsed['tool'] && parsed['tool'].pytest && parsed['tool'].pytest.ini_options;
  if (!ini || !Array.isArray(ini.markers)) return null;
  const names = [];
  for (const entry of ini.markers) {
    if (typeof entry !== 'string') continue;
    const name = entry.split(':')[0].trim();
    if (name && !names.includes(name)) names.push(name);
    if (names.length >= MARKER_CAP) break;
  }
  return names.length > 0 ? names : null;
}

// First numeric `DIFF_COVERAGE_THRESHOLD` value in a config file:
//   DIFF_COVERAGE_THRESHOLD: 80      (workflow YAML)
//   DIFF_COVERAGE_THRESHOLD = "70"   (Makefile)
const DIFF_COVERAGE_THRESHOLD_VALUE_RE = /DIFF_COVERAGE_THRESHOLD\s*[:=]\s*["']?(\d+(?:\.\d+)?)/;
// Any occurrence, used to report a non-numeric declaration as unverified.
const DIFF_COVERAGE_THRESHOLD_PRESENT_RE = /DIFF_COVERAGE_THRESHOLD/;

// Resolve a dotted TOML path (e.g. `tool.coverage.report.fail_under`) to its
// value, or undefined when any segment is absent or not an object.
function tomlValue(parsed, dotted) {
  let node = parsed;
  for (const part of String(dotted).split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

// Convert a `fail_under` value (TOML number, or a numeric string) into a
// non-negative finite number, or null when it is not a valid threshold.
function parseThreshold(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value === 'string') {
    const match = value.trim().match(/^\d+(?:\.\d+)?$/);
    return match ? parseFloat(match[0]) : null;
  }
  return null;
}

// Render a single threshold fact, degrading to `unverified` when the declared
// value cannot be parsed.
function thresholdFact(label, value) {
  const parsed = parseThreshold(value);
  const rendered = parsed === null ? 'unverified' : String(parsed);
  return `${label} fail_under=${rendered}`;
}

// Scan bounded CI/build config files for an env-style `DIFF_COVERAGE_THRESHOLD`
// declaration. The `.github/workflows` directory is hidden (rg --files skips
// it), so it is read directly, mirroring scanCiRefs.
function scanDiffCoverEnv(repoPath) {
  const facts = [];
  let examined = 0;
  const probe = (content) => {
    if (examined >= ENV_THRESHOLD_CAP) return;
    examined++;
    const match = content.match(DIFF_COVERAGE_THRESHOLD_VALUE_RE);
    if (match) {
      facts.push(`diff-cover fail_under=${match[1]}`);
    } else if (DIFF_COVERAGE_THRESHOLD_PRESENT_RE.test(content)) {
      facts.push('diff-cover fail_under=unverified');
    }
  };

  for (const name of ['Makefile', 'makefile', 'GNUmakefile']) {
    if (examined >= ENV_THRESHOLD_CAP) break;
    try {
      probe(readFileSync(join(repoPath, name), 'utf-8'));
    } catch {
      continue;
    }
  }

  // quality/gates.conf declares DIFF_COVERAGE_THRESHOLD as a locked gate
  // threshold; it is not among the build/CI files probed above, so it is added
  // explicitly so a numeric declaration resolves instead of `unverified`.
  if (examined < ENV_THRESHOLD_CAP) {
    try {
      probe(readFileSync(join(repoPath, 'quality', 'gates.conf'), 'utf-8'));
    } catch {
      // missing or unreadable gates.conf carries no diff-cover declaration
    }
  }

  const workflowsDir = join(repoPath, '.github', 'workflows');
  let entries;
  try {
    entries = readdirSync(workflowsDir);
  } catch {
    entries = [];
  }
  for (const name of entries) {
    if (examined >= ENV_THRESHOLD_CAP) break;
    if (!/\.ya?ml$/i.test(name)) continue;
    try {
      probe(readFileSync(join(workflowsDir, name), 'utf-8'));
    } catch {
      continue;
    }
  }

  // A numeric declaration (e.g. from quality/gates.conf) supersedes a bare-use
  // `unverified` placeholder found in build files (e.g. `--fail-under=
  // $(DIFF_COVERAGE_THRESHOLD)`), so the gate value resolves where possible.
  const hasNumeric = facts.some((fact) => /^diff-cover fail_under=\d+(?:\.\d+)?$/.test(fact));
  if (hasNumeric) return facts.filter((fact) => fact !== 'diff-cover fail_under=unverified');

  return facts;
}

// Collect coverage-gate threshold facts for a repo: `[tool.coverage.report]
// fail_under`, `[tool.diff_cover] fail_under`, and any DIFF_COVERAGE_THRESHOLD
// declarations in CI/build config. Returns an empty array for repos that
// declare no threshold.
function detectCoverageThresholds(repoPath) {
  const out = [];
  const pp = readToml(repoPath, 'pyproject.toml');
  const coverageUnder = tomlValue(pp, 'tool.coverage.report.fail_under');
  if (coverageUnder !== undefined) out.push(thresholdFact('coverage', coverageUnder));
  const diffCoverUnder = tomlValue(pp, 'tool.diff_cover.fail_under');
  if (diffCoverUnder !== undefined) out.push(thresholdFact('diff-cover', diffCoverUnder));
  out.push(...scanDiffCoverEnv(repoPath));
  return out;
}

// ---------------------------------------------------------------------------
// Python testing-depth facts (b14 universe, a10/d4 meta-tests, a11 network
// guard, a13 hypothesis profiles, a14/d6 coverage authority, c3 lanes +
// isolation, a26 hypothesis cache hedging).
//
// All facts are conditional-absent: a repo that does not exhibit the pattern
// keeps byte-identical findings. Reads are bounded by explicit caps so a
// hostile repo cannot force unbounded IO.
// ---------------------------------------------------------------------------

// Bounded read of a single repository file; null when missing/unreadable.
function readBounded(repoPath, relPath, cap) {
  try {
    const content = readFileSync(join(repoPath, relPath), 'utf-8');
    return content.length > cap ? content.slice(0, cap) : content;
  } catch {
    return null;
  }
}

// The disclosed python test-file counting rule (b14). Mirrors the python
// `testFileGlobs` descriptor plus the match-time exclusions above, so the
// rendered count is reproducible by a reader.
const PYTHON_COUNTING_RULE =
  'tests/test_*.py + tests/**/test_*.py + conftest.py, excluding tests/fixtures/**, tests/support/**, _fuzz_harnesses.py, strategies.py, __init__.py';

// Meta-test filename patterns (a10/d4): policy/quality/architecture suites
// that check the repo itself rather than product behaviour.
const META_TEST_PATTERNS = [
  { pattern: 'test_quality_*.py', re: /^test_quality_.*\.py$/ },
  { pattern: 'test_workflow_policy.py', re: /^test_workflow_policy\.py$/ },
  { pattern: 'test_make_policy.py', re: /^test_make_policy\.py$/ },
  { pattern: 'test_removed_plan_gate.py', re: /^test_removed_plan_gate\.py$/ },
  { pattern: 'test_analyser_contracts.py', re: /^test_analyser_contracts\.py$/ },
  { pattern: 'test_repository_hygiene.py', re: /^test_repository_hygiene\.py$/ },
  { pattern: 'test_suppressions*.py', re: /^test_suppressions.*\.py$/ },
  { pattern: 'test_coverage_policy.py', re: /^test_coverage_policy\.py$/ },
  { pattern: 'test_module_coverage.py', re: /^test_module_coverage\.py$/ },
  { pattern: 'test_import_graph.py', re: /^test_import_graph\.py$/ },
  { pattern: 'test_architecture.py', re: /^test_architecture\.py$/ },
  { pattern: 'test_cyclomatic_complexity.py', re: /^test_cyclomatic_complexity\.py$/ },
];

const NETWORK_GUARD_REL = 'tests/support/network_guard.py';
const NETWORK_GUARD_CAP = 100_000;
const CONFTEST_REL = 'tests/conftest.py';
const CONFTEST_CAP = 100_000;
const INVENTORY_REL = 'quality/property-inventory.toml';
const INVENTORY_CAP = 200_000;
const AUTHORITY_CAP = 20_000;

// Classify matched python test files into a `meta-test` naming fact (a10/d4):
// the matched patterns plus the count of files they caught.
function detectMetaTests(matchedFiles) {
  const found = [];
  const naming = [];
  for (const file of matchedFiles) {
    const base = String(file).replace(/\\/g, '/').split('/').pop() || '';
    for (const entry of META_TEST_PATTERNS) {
      if (entry.re.test(base)) {
        found.push(file);
        if (!naming.includes(entry.pattern)) naming.push(entry.pattern);
        break;
      }
    }
  }
  if (found.length === 0) return undefined;
  return { count: found.length, naming: naming.slice(0, 12) };
}

// Detect the fail-closed network guard at tests/support/network_guard.py
// (a11): socket/curl_cffi interception, loopback-only policy, environment
// scrubbing, and the explicit real_api bypass marker.
function detectNetworkGuard(repoPath) {
  const content = readBounded(repoPath, NETWORK_GUARD_REL, NETWORK_GUARD_CAP);
  if (content === null) return undefined;
  const signals = [];
  if (/socket\.(?:create_connection|socket|\.connect|connect_ex|sendto|sendmsg)/.test(content)) {
    signals.push('socket interception');
  }
  if (/curl_cffi/.test(content)) signals.push('curl_cffi interception');
  if (/loopback|127\.0\.0\.0\/8|_LOOPBACK_NAMES|is_loopback_host/.test(content)) signals.push('loopback-only');
  if (/os\.environ\.pop|saved_env/.test(content)) signals.push('env scrub');
  if (/real_api|RUN_REAL_API_TESTS/.test(content)) signals.push('real_api bypass');
  if (signals.length === 0) return undefined;
  return `loopback-only fail-closed guard (${signals.join(', ')})`;
}

// Parse tests/conftest.py Hypothesis `settings(max_examples=…)` declarations,
// one entry per registered profile (a13). Deterministic file order.
function detectHypothesisProfiles(repoPath) {
  const content = readBounded(repoPath, CONFTEST_REL, CONFTEST_CAP);
  if (content === null) return undefined;
  const profiles = [];
  const re = /settings\.register_profile\(\s*["']([^"']+)["']\s*,[\s\S]{0,100}?max_examples\s*=\s*(\d+)/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    profiles.push({ name: match[1], maxExamples: Number(match[2]) });
    if (profiles.length >= 16) break;
  }
  return profiles.length > 0 ? profiles : undefined;
}

// Property-test parity manifest (a13): quality/property-inventory.toml with the
// number of declared [[property]] tables.
function detectPropertyInventory(repoPath) {
  const content = readBounded(repoPath, INVENTORY_REL, INVENTORY_CAP);
  if (content === null) return undefined;
  const tables = (content.match(/^\[\[property\]\]/gm) || []).length;
  return { present: true, tables };
}

// Coverage authority chain (a14/d6): check_module_coverage.py as the sole
// module-coverage authority, diff-cover as the sole changed-line authority, and
// the pytest `-n auto --dist loadfile` determinism switch in the Makefile.
function detectCoverageAuthority(repoPath) {
  const facts = [];
  const checker = readBounded(repoPath, 'scripts/check_module_coverage.py', AUTHORITY_CAP);
  if (checker !== null) {
    if (/sole[^\n]*authority/i.test(checker)) facts.push('check_module_coverage.py sole module-coverage authority');
    if (/only changed-line|sole[^\n]*changed-line/i.test(checker)) facts.push('diff-cover sole changed-line authority');
  }
  const makefile = readBounded(repoPath, 'Makefile', AUTHORITY_CAP);
  if (makefile !== null && /--dist\s+loadfile/.test(makefile) && /-n\s+auto/.test(makefile)) {
    facts.push('pytest -n auto --dist loadfile determinism');
  }
  return facts.length > 0 ? facts : undefined;
}

// Marker-lane exclusions (c3): the pytest `-m "not property and not …"`
// selector and the literal MUTATION_PROPERTY_FILES manifest from the Makefile.
function detectTestLanes(repoPath) {
  const makefile = readBounded(repoPath, 'Makefile', 200_000);
  if (makefile === null) return undefined;
  const result = {};
  const marker = makefile.match(/-m\s+"((?:[^"\\]|\\.)*)"/);
  if (marker) result.markerSelector = marker[1];
  const manifest = makefile.match(/MUTATION_PROPERTY_FILES\s*:?=\s*\\\n((?:\s+[^\n]+\n?)+)/);
  if (manifest) {
    const files = manifest[1]
      .split('\n')
      .map((line) => line.trim().replace(/\\$/, ''))
      .filter(Boolean);
    result.mutationPropertyFiles = files.slice(0, 16);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

// Autouse isolation fixtures from tests/conftest.py (c3): fixtures installed
// with `@pytest.fixture(autouse=True)` that isolate state between tests.
function detectIsolationFixtures(repoPath) {
  const content = readBounded(repoPath, CONFTEST_REL, CONFTEST_CAP);
  if (content === null) return undefined;
  const fixtures = [];
  const re = /@pytest\.fixture\(\s*autouse\s*=\s*True\s*\)\s*\n\s*(?:async\s+)?def\s+(\w+)/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    fixtures.push(match[1]);
    if (fixtures.length >= 8) break;
  }
  return fixtures.length > 0 ? fixtures : undefined;
}

// Hypothesis cache gitignore state (a26, hedged per A006): reports only
// `.gitignore`-absence (inferred when not listed or when no .gitignore exists)
// and notes that the scanner's own ignore rules still cover the directory.
// Never claims the cache is untracked or created at test time.
function detectHypothesisCache(repoPath) {
  if (!existsSync(join(repoPath, '.hypothesis'))) return undefined;
  const gitignore = readBounded(repoPath, '.gitignore', 100_000);
  const listed = gitignore !== null && /(^|\n)\s*\.hypothesis(\s|$|\/)/.test(gitignore);
  return {
    gitignored: listed,
    inferred: !listed,
    scannerIgnores: true,
  };
}

// ---------------------------------------------------------------------------
// Script
// ---------------------------------------------------------------------------

function detectScript(repoPath) {
  const pkg = readJSON(join(repoPath, 'package.json'));
  if (pkg && pkg.scripts && typeof pkg.scripts.test === 'string') return pkg.scripts.test;
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function scan(repoPath, overview) {
  const ov = overview || {};

  // Files: prefer overview, fall back to enumeration.
  let files;
  if (Array.isArray(ov.files)) {
    files = ov.files;
  } else {
    try {
      files = (await enumerate(repoPath)).files;
    } catch {
      files = [];
    }
  }

  // Manifest + ecosystems: prefer overview, then manifest, then inference.
  const manifest = ov.manifest && typeof ov.manifest === 'object' ? ov.manifest : readManifest(repoPath);
  let ecosystems;
  if (ov.ecosystems && Array.isArray(ov.ecosystems.all) && ov.ecosystems.all.length) {
    ecosystems = ov.ecosystems.all;
  } else if (Array.isArray(manifest.ecosystems) && manifest.ecosystems.length) {
    ecosystems = manifest.ecosystems;
  } else {
    ecosystems = detectEcosystems(ov, manifest).all;
  }

  const depNames = collectDepNames(manifest, repoPath);

  const { matched, naming, byEco } = matchTestFiles(ecosystems, files);
  const matchedSet = new Set(matched);

  // Rust inline tests (P1): count `src/**/*.rs` carrying #[test]/#[cfg(test)]
  // so a crate with only inline unit tests is not reported as fileCount 0.
  // The matched files are also fed into framework detection so the `#[test]`
  // builtin marker is recognised from inline tests.
  if (ecosystems.includes('rust')) {
    const inline = detectRustInlineTests(files, repoPath);
    if (inline.size > 0) {
      for (const f of inline) {
        matchedSet.add(f);
        if (!byEco.has('rust')) byEco.set('rust', new Set());
        byEco.get('rust').add(f);
      }
      naming.push('src/**/*.rs (#[test] inline)');
    }
  }
  const matchedSorted = [...matchedSet].sort();
  const namingFinal = uniq(naming);

  const framework = detectFrameworks(ecosystems, depNames, byEco, repoPath, files);
  const frameworkResolved = framework.length > 0 ? framework : ['unknown'];

  const testDirs = uniq(matchedSorted.map(parentDir)).sort();

  const configFiles = detectConfigFiles(ecosystems, files, repoPath);
  const coverage = detectCoverage(ecosystems, depNames, repoPath, files);
  const script = detectScript(repoPath);
  const markers = detectPytestMarkers(repoPath);

  // Python-only testing-depth facts (b14, a10/d4, a11, a13, a14/d6, c3, a26).
  // Each is conditional-absent so non-python repos and python repos without
  // the pattern keep byte-identical findings.
  const isPython = ecosystems.includes('python');
  const countingRule = isPython ? PYTHON_COUNTING_RULE : undefined;
  const metaTests = isPython ? detectMetaTests(matchedSorted) : undefined;
  const networkGuard = isPython ? detectNetworkGuard(repoPath) : undefined;
  const hypothesisProfiles = isPython ? detectHypothesisProfiles(repoPath) : undefined;
  const propertyInventory = isPython ? detectPropertyInventory(repoPath) : undefined;
  const coverageAuthority = isPython ? detectCoverageAuthority(repoPath) : undefined;
  const testLanes = isPython ? detectTestLanes(repoPath) : undefined;
  const isolationFixtures = isPython ? detectIsolationFixtures(repoPath) : undefined;
  const hypothesisCache = isPython ? detectHypothesisCache(repoPath) : undefined;

  const fwDetected = frameworkResolved[0] !== 'unknown';
  const signal = (fwDetected && matchedSorted.length > 0)
    ? 'high'
    : (fwDetected || matchedSorted.length > 0 ? 'medium' : 'low');

  return {
    dimension: 'testing',
    signal,
    findings: {
      framework: frameworkResolved,
      testDirs,
      fileCount: matchedSorted.length,
      naming: namingFinal,
      sampleFiles: matchedSorted.slice(0, 15),
      coverage,
      configFiles: configFiles.length > 0 ? configFiles : null,
      script,
      ...(markers ? { markers } : {}),
      ...(countingRule ? { countingRule } : {}),
      ...(metaTests ? { metaTests } : {}),
      ...(networkGuard ? { networkGuard } : {}),
      ...(hypothesisProfiles ? { hypothesisProfiles } : {}),
      ...(propertyInventory ? { propertyInventory } : {}),
      ...(coverageAuthority ? { coverageAuthority } : {}),
      ...(testLanes ? { testLanes } : {}),
      ...(isolationFixtures ? { isolationFixtures } : {}),
      ...(hypothesisCache ? { hypothesisCache } : {}),
    },
  };
}
