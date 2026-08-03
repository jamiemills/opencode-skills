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
//     coverage:    string[]|null,     // detected coverage signals
//     configFiles: string[]|null,     // detected test config (incl. markers)
//     script:      string|null,       // package.json test script
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
    },
  };
}
