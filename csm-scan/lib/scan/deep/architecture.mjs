// Architecture deep scanner.
//
// Ecosystem-aware module-graph and C4 diagram generation. Detection is driven
// by the shared ecosystem descriptor table (importSyntax per language), the
// normalized manifest, and the cross-cutting detection tables in
// shared/detection.mjs — never hardcoded to JS/TS.
//
// Supports first-party import resolution for python, javascript, typescript,
// rust, and shell. Only emits dependency edges whose resolved target lives
// inside the repo's own source set.
//
// Accuracy guarantees (T104):
//   - TS/JS: type-only imports (`import type`, `export type`, inline
//     `{ type X }`) are stripped before edges are emitted; path aliases
//     (tsconfig/jsconfig `paths` + `baseUrl`) resolve `@/`, `~/`, `#`…;
//     bare imports resolve to workspace package entry files; `.d.ts` files
//     are excluded from the source set.
//   - Python: multi-line parenthesized imports are joined; PEP 420 namespace
//     packages resolve directory-based; absolute imports resolve against ANY
//     top-level package dir (not only primaryPackage).
//   - Rust: edition-2018 `mod foo;` semantics (file-as-directory); `use
//     self::` / `use super::` resolution; external-crate discrimination via
//     local crate names.
//   - C4: DB / external-API nodes are derived from shared/detection.mjs for
//     every detected ecosystem (Rust sqlx, Python sqlalchemy, …).
//   - Shell: `source`/`.` plus best-effort `bash foo.sh` / `./scripts/x.sh`.
//
// ESM only. Zero npm deps. node: builtins only. Read-only.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { descriptorFor, detectEcosystems } from '../shared/ecosystem.mjs';
import { readManifest } from '../shared/manifest.mjs';
import { enumerate } from '../shared/enum.mjs';
import { DATABASE_INDICATORS, EXTERNAL_API_INDICATORS, matchDep } from '../shared/detection.mjs';
import { parseToml } from '../shared/parse.mjs';
import { expandRepositoryDirectoryPatterns } from '../shared/glob.mjs';
import { readJsonc } from '../shared/jsonc.mjs';
import { parseIniSections } from '../shared/declarations.mjs';
import { compareAscii, deepFreeze } from '../contracts/evidence.mjs';
import {
  computeBounds,
  computeEdgeKindCounts,
  computeFanInOut,
  computeSelfLoops,
  GRAPH_FACTS_LIMITS,
  tarjanStronglyConnectedComponents,
} from './architecture/graph-facts.mjs';
import { detectDynamicIndicators } from './architecture/indicators.mjs';
import { scanCanonicalLayerModel } from './architecture/canonical.mjs';

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function readContent(absPath) {
  try { return readFileSync(absPath, 'utf-8'); } catch { return null; }
}
function toPosix(p) { return String(p).replace(/\\/g, '/'); }
function toRel(repoPath, abs) { return toPosix(relative(repoPath, abs)); }
function extOf(rel) {
  const base = (toPosix(rel).split('/').pop() || '').toLowerCase();
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '';
}
function basenameOf(rel) { return toPosix(rel).split('/').pop() || ''; }
function dirnameOf(rel) {
  const p = toPosix(rel);
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? p.slice(0, idx) : '';
}
function isDeclarationFile(rel) { return /\.d\.(ts|mts|cts)$/i.test(toPosix(rel)); }
function isDirectory(absPath) {
  try { return readdirSync(absPath) && true; } catch { return false; }
}
function slug(s) { return String(s).replace(/[^a-zA-Z0-9]/g, ''); }

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; }
}

function readCargo(path) {
  try { return parseToml(readFileSync(path, 'utf-8')); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Ecosystem / manifest resolution (prefer overview, fall back to computing)
// ---------------------------------------------------------------------------

function resolveManifest(repoPath, overview) {
  const ov = overview || {};
  return ov.manifest || readManifest(repoPath);
}

function inferEcosystemFromFiles(files) {
  const present = new Set(files.map(extOf));
  for (const eco of ['python', 'typescript', 'javascript', 'rust', 'shell']) {
    const desc = descriptorFor(eco);
    if (desc && desc.extensions.some((e) => present.has(e))) {
      return { primary: eco, all: [eco] };
    }
  }
  return { primary: null, all: [] };
}

function resolveEcosystems(repoPath, overview, files) {
  const ov = overview || {};
  const ove = ov.ecosystems;
  if (ove && (ove.primary || (Array.isArray(ove.all) && ove.all.length > 0))) return ove;
  const manifest = ov.manifest || readManifest(repoPath);
  const detected = detectEcosystems(
    { languages: ov.languages || [], languageScores: ov.languageScores || {} },
    manifest,
  );
  if (detected.primary) return detected;
  if (files && files.length > 0) return inferEcosystemFromFiles(files);
  return detected;
}

function ecoTechnology(primary) {
  switch (primary) {
    case 'python': return 'Python';
    case 'rust': return 'Rust';
    case 'typescript': return 'TypeScript';
    case 'javascript': return 'JavaScript';
    case 'shell': return 'Shell';
    default: return 'Node.js';
  }
}

function ecosystemForFile(rel, ecosystems) {
  const ext = extOf(rel);
  for (const eco of ecosystems) {
    const desc = descriptorFor(eco);
    if (desc && desc.extensions.includes(ext)) return eco;
  }
  return null;
}

function sourceExtensionSet(ecosystems) {
  const set = new Set();
  for (const eco of ecosystems) {
    const desc = descriptorFor(eco);
    if (desc) for (const e of desc.extensions) set.add(e);
  }
  return set;
}

// ---------------------------------------------------------------------------
// File listing + test exclusion
// ---------------------------------------------------------------------------

async function listFiles(repoPath, overview) {
  const fromOverview = overview && Array.isArray(overview.files) ? overview.files : null;
  if (fromOverview && fromOverview.length > 0) return fromOverview.map(toPosix);
  const { files } = await enumerate(repoPath);
  return files.map(toPosix);
}

function isTestFile(rel) {
  const posix = toPosix(rel);
  const base = basenameOf(posix);
  if (posix.includes('/tests/')) return true;
  if (posix.startsWith('tests/')) return true;
  if (posix.includes('/__tests__/')) return true;
  if (base === 'conftest.py') return true;
  if (/^test_/i.test(base)) return true;
  if (/[_./]test([._]|$)/i.test(base)) return true;
  if (/\.spec\./i.test(base)) return true;
  if (/\.test\./i.test(base)) return true;
  if (/\.bats$/i.test(base)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Package-root detection (used for layer classification)
// ---------------------------------------------------------------------------

function findPrimaryPackage(dir) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== '__pycache__')
    .map((e) => e.name)
    .filter((n) => !/\.egg-info$/i.test(n))
    .sort();
  for (const d of dirs) {
    if (existsSync(join(dir, d, '__init__.py'))) return d;
  }
  return null;
}

function detectPackageRoot(repoPath, manifest, primary) {
  const layout = manifest && manifest.sourceLayout;
  if (primary === 'python') {
    const srcDir = join(repoPath, 'src');
    if ((layout === 'src-layout' || existsSync(srcDir)) && existsSync(srcDir)) {
      const pkg = findPrimaryPackage(srcDir);
      if (pkg) return { pkgRoot: toPosix(join('src', pkg)), primaryPackage: pkg };
      return { pkgRoot: 'src', primaryPackage: null };
    }
    const flat = findPrimaryPackage(repoPath);
    if (flat) return { pkgRoot: flat, primaryPackage: flat };
    return { pkgRoot: '', primaryPackage: null };
  }
  if (primary === 'rust') {
    return { pkgRoot: existsSync(join(repoPath, 'src')) ? 'src' : '', primaryPackage: null };
  }
  if (primary === 'shell') {
    return { pkgRoot: existsSync(join(repoPath, 'scripts')) ? 'scripts' : '', primaryPackage: null };
  }
  if (existsSync(join(repoPath, 'src'))) return { pkgRoot: 'src', primaryPackage: null };
  return { pkgRoot: '', primaryPackage: null };
}

// ---------------------------------------------------------------------------
// Python top-level package discovery (multi-package + PEP 420 namespace)
// ---------------------------------------------------------------------------
// Returns a Map<topSegment, repoRelDir> for every directory under repo root or
// `src/` that contains at least one `.py` file at its top level. `src/` entries
// take precedence over root entries (src-layout wins).

const PYTHON_DISCOVERY_IGNORES = new Set([
  '.git', '.hg', '.svn', '.venv', 'venv', 'node_modules', 'target', 'dist', 'build', '__pycache__',
]);

function hasPythonDescendant(root, maxDepth = 24, maxDirs = 10000) {
  const pending = [{ abs: root, depth: 0 }];
  let visited = 0;
  while (pending.length && visited++ < maxDirs) {
    const { abs, depth } = pending.pop();
    let entries = [];
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.py')) return true;
      if (!entry.isDirectory() || depth >= maxDepth) continue;
      if (entry.name.startsWith('.') || PYTHON_DISCOVERY_IGNORES.has(entry.name) || /\.egg-info$/i.test(entry.name)) continue;
      pending.push({ abs: join(abs, entry.name), depth: depth + 1 });
    }
  }
  return false;
}

function discoverTopPackages(repoPath) {
  const map = new Map();
  const roots = [];
  if (existsSync(join(repoPath, 'src'))) roots.push({ abs: join(repoPath, 'src'), relBase: 'src' });
  roots.push({ abs: repoPath, relBase: '' });
  for (const { abs, relBase } of roots) {
    let entries = [];
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.') || e.name === '__pycache__' || /\.egg-info$/i.test(e.name)) continue;
      const dAbs = join(abs, e.name);
      if (!hasPythonDescendant(dAbs)) continue;
      const rel = relBase ? `${relBase}/${e.name}` : e.name;
      if (!map.has(e.name)) map.set(e.name, rel);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Path probes
// ---------------------------------------------------------------------------

// Returns a `.py`/`__init__.py` file, or a directory marker (trailing '/') for
// a PEP 420 namespace package, or null.
function probePython(baseAbs) {
  if (existsSync(baseAbs + '.py')) return baseAbs + '.py';
  const init = join(baseAbs, '__init__.py');
  if (existsSync(init)) return init;
  if (isDirectory(baseAbs)) return toPosix(baseAbs) + '/';
  return null;
}

const JS_EXTS = [
  '', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx',
  '/index.js', '/index.mjs', '/index.cjs', '/index.jsx',
  '/index.ts', '/index.tsx', '/index.mts', '/index.cts',
];

function probeJs(baseAbs) {
  for (const ext of JS_EXTS) {
    const cand = baseAbs + ext;
    if (existsSync(cand)) return cand;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Import parsing — one resolver family per ecosystem.
// Each returns repo-relative target files (or directory markers); the caller
// keeps only those present in the source set, expanding namespace dirs.
// ---------------------------------------------------------------------------

function splitNames(spec) {
  return String(spec || '')
    .split(',')
    .map((s) => s.trim().replace(/\s+as\s+.*$/i, '').trim())
    .filter(Boolean);
}

function stripComment(line) {
  return line.replace(/#.*$/, '').replace(/\/\/.*$/, '').replace(/\s+$/, '');
}

// Collapse physical lines inside unbalanced `(...)` so multi-line parenthesized
// Python imports (`from pkg import (\n a,\n b\n)`) become a single logical
// line. Comments and string contents are ignored when balancing parens.
function joinParenLines(content) {
  const physical = String(content).split('\n');
  const out = [];
  let buf = '';
  let depth = 0;
  for (const raw of physical) {
    const noStr = raw.replace(/(?:#[^\n]*|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/g, '');
    for (const ch of noStr) {
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
    }
    buf = buf ? `${buf} ${raw}` : raw;
    if (depth <= 0) { out.push(buf); buf = ''; }
  }
  if (buf) out.push(buf);
  return out;
}

function resolvePythonAbsolute(modulePath, names, topPackages, repoPath) {
  const out = [];
  const segs = String(modulePath || '').split('.').filter(Boolean);
  if (!segs.length) return out;
  const pkgRel = topPackages.get(segs[0]);
  if (!pkgRel) return out; // external / unknown top-level package
  const pkgRootAbs = join(repoPath, pkgRel);
  const sub = segs.slice(1).join('/');
  const base = sub ? join(pkgRootAbs, sub) : pkgRootAbs;
  const baseTarget = probePython(base);
  if (baseTarget) out.push(toRel(repoPath, baseTarget));
  for (const name of names) {
    if (!name) continue;
    const nf = probePython(join(base, name));
    if (nf) out.push(toRel(repoPath, nf));
  }
  return out;
}

function resolvePythonRelative(file, dots, module, names, repoPath) {
  const out = [];
  let base = dirname(join(repoPath, file));
  for (let i = 1; i < dots; i++) base = dirname(base);
  if (module) base = join(base, module.replace(/\./g, '/'));
  const bf = probePython(base);
  if (bf) out.push(toRel(repoPath, bf));
  for (const name of names) {
    if (!name) continue;
    const nf = probePython(join(base, name));
    if (nf) out.push(toRel(repoPath, nf));
  }
  return out;
}

function resolveJsRelative(file, imp, repoPath) {
  const fromDir = dirname(join(repoPath, file));
  const cand = probeJs(join(fromDir, imp));
  return cand ? toRel(repoPath, cand) : null;
}

// tsconfig/jsconfig path-alias resolution -----------------------------------

function readAliasConfig(repoPath) {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const p = join(repoPath, name);
    if (!existsSync(p)) continue;
    const cfg = readJsonc(p);
    const co = cfg && cfg.compilerOptions;
    if (!co || !co.paths || typeof co.paths !== 'object') continue;
    const baseUrl = typeof co.baseUrl === 'string' ? co.baseUrl : '';
    const entries = [];
    for (const [key, vals] of Object.entries(co.paths)) {
      const target = Array.isArray(vals) ? vals[0] : vals;
      if (typeof target !== 'string') continue;
      const keyWild = key.endsWith('/*');
      const tgtWild = target.endsWith('/*');
      entries.push({
        prefix: keyWild ? key.slice(0, -2) : key,
        tBase: tgtWild ? target.slice(0, -2) : target,
        wild: keyWild || tgtWild,
      });
    }
    return { baseUrl, entries };
  }
  return { baseUrl: '', entries: [] };
}

function resolveAliased(spec, alias, repoPath) {
  for (const e of alias.entries) {
    let rest;
    if (e.wild) {
      if (spec === e.prefix) rest = '';
      else if (e.prefix && spec.startsWith(`${e.prefix}/`)) rest = spec.slice(e.prefix.length + 1);
      else if (!e.prefix) rest = spec;
      else continue;
    } else if (spec !== e.prefix) continue;
    else rest = '';
    const targetPath = e.tBase ? (rest ? `${e.tBase}/${rest}` : e.tBase) : rest;
    const baseAbs = join(repoPath, alias.baseUrl || '', targetPath);
    const cand = probeJs(baseAbs);
    if (cand) return toRel(repoPath, cand);
  }
  return null;
}

// JS workspace package discovery --------------------------------------------

function resolveExportsDot(exports) {
  if (typeof exports === 'string') return exports;
  if (exports && typeof exports === 'object') {
    const dot = exports['.'];
    if (dot == null) return null;
    if (typeof dot === 'string') return dot;
    if (typeof dot === 'object') {
      for (const cond of ['import', 'node', 'default', 'require']) {
        if (typeof dot[cond] === 'string') return dot[cond];
      }
      for (const v of Object.values(dot)) if (typeof v === 'string') return v;
    }
  }
  return null;
}

function resolveWorkspaceEntry(wsPkg, repoPath) {
  const { pkg, dir } = wsPkg;
  const picks = [];
  const dot = resolveExportsDot(pkg.exports);
  if (pkg.module) picks.push(pkg.module);
  if (dot) picks.push(dot);
  if (pkg.main) picks.push(pkg.main);
  picks.push('src/index.ts', 'src/index.js', 'index.ts', 'index.js');
  for (const c of picks) {
    const cand = probeJs(join(repoPath, dir, c.replace(/^\.\//, '')));
    if (cand) return toRel(repoPath, cand);
  }
  return null;
}

function buildWorkspaceMap(repoPath, manifest) {
  const ws = manifest && manifest.workspaces;
  const pats = Array.isArray(ws) ? ws : (ws && Array.isArray(ws.packages) ? ws.packages : []);
  const map = new Map();
  for (const d of expandRepositoryDirectoryPatterns(repoPath, pats, { marker: 'package.json' })) {
    const pkg = readJson(join(repoPath, d, 'package.json'));
    if (!pkg || !pkg.name) continue;
    const entry = resolveWorkspaceEntry({ pkg, dir: d }, repoPath);
    if (entry) map.set(pkg.name, entry);
  }
  return map;
}

function resolveBare(spec, workspaceMap) {
  if (workspaceMap.has(spec)) return workspaceMap.get(spec);
  const head = spec.split('/')[0];
  return workspaceMap.has(head) ? workspaceMap.get(head) : null;
}

// Rust context (crate roots + local crate names) ---------------------------

function buildRustContext(repoPath, manifest) {
  const crateRoots = new Set();
  for (const p of ['src/lib.rs', 'src/main.rs']) {
    if (existsSync(join(repoPath, p))) crateRoots.add(p);
  }
  for (const ep of (manifest && manifest.entrypoints) || []) {
    const eq = ep.indexOf('=');
    const t = (eq >= 0 ? ep.slice(eq + 1) : ep).trim();
    if (t.endsWith('.rs')) {
      const rel = toPosix(t.replace(/^\.\//, ''));
      if (existsSync(join(repoPath, rel))) crateRoots.add(rel);
    }
  }

  const localCrateRoots = new Map();
  const addLocalCrate = (name, root) => {
    if (!name || !root) return;
    crateRoots.add(root);
    localCrateRoots.set(name, root);
    localCrateRoots.set(name.replace(/-/g, '_'), root);
  };
  const rootName = manifest && manifest.name;
  if (rootName) {
    if (existsSync(join(repoPath, 'src/lib.rs'))) addLocalCrate(rootName, 'src/lib.rs');
    else if (existsSync(join(repoPath, 'src/main.rs'))) addLocalCrate(rootName, 'src/main.rs');
  }
  const rootCargo = readCargo(join(repoPath, 'Cargo.toml'));
  const workspace = manifest && manifest.workspace
    ? manifest.workspace
    : rootCargo && rootCargo.workspace;
  const members = workspace && Array.isArray(workspace.resolvedMembers)
    ? workspace.resolvedMembers
    : expandRepositoryDirectoryPatterns(repoPath, workspace && workspace.members || [], {
      exclude: workspace && workspace.exclude || [],
      marker: 'Cargo.toml',
    });
  for (const m of members) {
    const c = readCargo(join(repoPath, m, 'Cargo.toml'));
    const name = c && c.package && c.package.name;
    if (!name) continue;
    let p = null;
    if (existsSync(join(repoPath, m, 'src/lib.rs'))) p = `${m}/src/lib.rs`;
    else if (existsSync(join(repoPath, m, 'src/main.rs'))) p = `${m}/src/main.rs`;
    addLocalCrate(name, p);
  }
  return { crateRoots, localCrateRoots };
}

function rustCrateRootFor(file, crateRoots) {
  let match = null;
  for (const root of crateRoots) {
    const sourceDir = dirnameOf(root);
    if ((file === root || file.startsWith(`${sourceDir}/`)) && (!match || sourceDir.length > dirnameOf(match).length)) match = root;
  }
  return match;
}

// Edition-2018 module base directory for `mod foo;` declared in `file`:
//   - crate root (src/lib.rs, src/main.rs, [[bin]]) or `mod.rs` -> dirname(file)
//   - named file `src/a/b.rs` -> dirname(file) + '/' + stem  (i.e. src/a/b/)
function rustModuleBaseDir(file, crateRoots) {
  const posix = toPosix(file);
  const base = basenameOf(posix);
  const dir = dirnameOf(posix);
  if (crateRoots.has(posix) || base === 'mod.rs') return dir;
  const stem = base.replace(/\.rs$/, '');
  return stem ? (dir ? `${dir}/${stem}` : stem) : dir;
}

function resolveRustCrate(segs, file, crateRoots, repoPath) {
  const crateRoot = rustCrateRootFor(file, crateRoots);
  if (!crateRoot) return [];
  const rootAbs = join(repoPath, dirnameOf(crateRoot));
  for (let i = segs.length; i >= 1; i--) {
    const sub = segs.slice(0, i).join('/');
    const f1 = join(rootAbs, sub) + '.rs';
    if (existsSync(f1)) return [toRel(repoPath, f1)];
    const f2 = join(rootAbs, sub, 'mod.rs');
    if (existsSync(f2)) return [toRel(repoPath, f2)];
  }
  return [];
}

function resolveRustMod(name, file, crateRoots, repoPath) {
  const baseRel = rustModuleBaseDir(file, crateRoots);
  const baseAbs = join(repoPath, baseRel);
  const f1 = join(baseAbs, name) + '.rs';
  if (existsSync(f1)) return [toRel(repoPath, f1)];
  const f2 = join(baseAbs, name, 'mod.rs');
  if (existsSync(f2)) return [toRel(repoPath, f2)];
  return [];
}

// Resolve a `self::`/`super::`-rooted path to a file by walking segments.
function resolveRustPath(baseRel, segs, repoPath) {
  let cur = baseRel;
  for (const seg of segs) {
    const f1 = join(repoPath, cur, seg) + '.rs';
    if (existsSync(f1)) return [toRel(repoPath, f1)];
    const f2 = join(repoPath, cur, seg, 'mod.rs');
    if (existsSync(f2)) return [toRel(repoPath, f2)];
    cur = cur ? `${cur}/${seg}` : seg;
  }
  return [];
}

function resolveShellRelative(file, imp, repoPath) {
  const fromDir = dirname(join(repoPath, file));
  const cleaned = imp.replace(/^\.\//, '');
  const raw = join(fromDir, cleaned);
  if (existsSync(raw)) return toRel(repoPath, raw);
  const atRoot = join(repoPath, cleaned);
  if (existsSync(atRoot)) return toRel(repoPath, atRoot);
  return null;
}

// JS/TS type-only detection -------------------------------------------------

// A named-specifier clause `{ … }` is fully type-only when every specifier is
// prefixed with `type` (e.g. `{ type T }`, `{ type A, type B }`).
function isClauseAllType(clause) {
  const m = clause && clause.match(/\{([^}]*)\}/);
  if (!m) return false;
  const specs = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  if (!specs.length) return false;
  return specs.every((s) => /^type\b/.test(s));
}

function maskJsComments(content) {
  const chars = String(content).split('');
  let state = 'code';
  let escaped = false;
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const next = chars[i + 1];
    if (state === 'line-comment') {
      if (char === '\n' || char === '\r') state = 'code';
      else chars[i] = ' ';
      continue;
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        chars[i] = ' ';
        chars[i + 1] = ' ';
        i++;
      } else if (char !== '\n' && char !== '\r') {
        chars[i] = ' ';
      }
      if (char === '*' && next === '/') state = 'code';
      continue;
    }
    if (state !== 'code') {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if ((state === 'single' && char === "'")
        || (state === 'double' && char === '"')
        || (state === 'template' && char === '`')) state = 'code';
      continue;
    }
    if (char === "'") { state = 'single'; continue; }
    if (char === '"') { state = 'double'; continue; }
    if (char === '`') { state = 'template'; continue; }
    if (char === '/' && next === '/') {
      chars[i] = ' ';
      chars[i + 1] = ' ';
      i++;
      state = 'line-comment';
    } else if (char === '/' && next === '*') {
      chars[i] = ' ';
      chars[i + 1] = ' ';
      i++;
      state = 'block-comment';
    }
  }
  return chars.join('');
}

// Static statements are parsed after comments are position-masked. Requiring
// `from` for clauses prevents unrelated later strings from being consumed.
const JS_FROM_RE = /^[\t ]*(import|export)\s+(type\s+)?([^;'"`]*?\bfrom\s*)['"]([^'"\n]+)['"][\t ]*;?/gm;
const JS_SIDE_EFFECT_RE = /^[\t ]*import[\t ]*['"]([^'"\n]+)['"][\t ]*;?/gm;
const JS_DYN_RE = /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;
const JS_REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;

// ---------------------------------------------------------------------------
// parseImports
// ---------------------------------------------------------------------------

function parseImports(filePath, ecosystem, ctx) {
  const desc = descriptorFor(ecosystem);
  if (!desc) return [];
  const content = readContent(join(ctx.repoPath, filePath));
  if (!content) return [];

  const edges = [];
  const seen = new Set();
  const add = (target, kind) => {
    if (!target) return;
    if (target.endsWith('/')) {
      // PEP 420 namespace package dir -> expand to direct child source files.
      const dirAbs = join(ctx.repoPath, target.slice(0, -1));
      let entries = [];
      try { entries = readdirSync(dirAbs); } catch { return; }
      for (const e of entries) {
        const rel = toRel(ctx.repoPath, join(dirAbs, e));
        if (ctx.sourceSet.has(rel) && !seen.has(rel)) { seen.add(rel); edges.push({ target: rel, kind }); }
      }
      return;
    }
    if (ctx.sourceSet.has(target) && !seen.has(target)) { seen.add(target); edges.push({ target, kind }); }
  };

  if (ecosystem === 'python') {
    const absRe = desc.importSyntax.absolute;
    const relRe = desc.importSyntax.relative;
    for (const raw of joinParenLines(content)) {
      const line = stripComment(raw);
      if (!line.trim()) continue;
      if (relRe.test(line)) {
        const m = line.match(/^\s*from\s+(\.+)([\w.]*)\s+import\s+(.+)$/);
        if (m) {
          const names = splitNames(m[3]);
          for (const t of resolvePythonRelative(filePath, m[1].length, m[2] || '', names, ctx.repoPath)) add(t, 'from-import');
        }
        continue;
      }
      if (absRe.test(line)) {
        let m = line.match(/^\s*from\s+([\w.]+)\s+import\s+(.+)$/);
        if (m) {
          const names = splitNames(m[2].replace(/[()]/g, ''));
          for (const t of resolvePythonAbsolute(m[1], names, ctx.topPackages, ctx.repoPath)) add(t, 'from-import');
          continue;
        }
        m = line.match(/^\s*import\s+([\w.,\s]+)$/);
        if (m) {
          for (const mod of splitNames(m[1])) {
            for (const t of resolvePythonAbsolute(mod, [], ctx.topPackages, ctx.repoPath)) add(t, 'import');
          }
        }
      }
    }
  } else if (ecosystem === 'javascript' || ecosystem === 'typescript') {
    const importSource = maskJsComments(content);
    JS_FROM_RE.lastIndex = 0;
    let m;
    while ((m = JS_FROM_RE.exec(importSource))) {
      const clause = m[3] || '';
      if (m[2] || isClauseAllType(clause)) continue; // type-only: no edge
      const spec = m[4];
      add(resolveJsSpecifier(spec, filePath, ctx), 'import');
    }
    JS_SIDE_EFFECT_RE.lastIndex = 0;
    while ((m = JS_SIDE_EFFECT_RE.exec(importSource))) add(resolveJsSpecifier(m[1], filePath, ctx), 'side-effect');
    JS_DYN_RE.lastIndex = 0;
    let dm;
    while ((dm = JS_DYN_RE.exec(importSource))) add(resolveJsSpecifier(dm[1], filePath, ctx), 'dynamic-import');
    JS_REQUIRE_RE.lastIndex = 0;
    let rm;
    while ((rm = JS_REQUIRE_RE.exec(importSource))) add(resolveJsSpecifier(rm[1], filePath, ctx), 'require');
  } else if (ecosystem === 'rust') {
    // pub-aware superset of the descriptor regexes (handles `pub use`/`pub mod`
    // re-exports, which the `^\s*(?:use|mod)` descriptor anchors would miss).
    const VIS = '(?:pub(?:\\s*\\([^)]*\\))?\\s+)?';
    const crateRe = new RegExp(`^\\s*${VIS}use\\s+crate::([\\w:]+)`, 'gm');
    let m;
    while ((m = crateRe.exec(content))) {
      const segs = m[1].split('::').filter(Boolean);
      for (const t of resolveRustCrate(segs, filePath, ctx.crateRoots, ctx.repoPath)) add(t, 'use-crate');
    }
    if (desc.importSyntax.self) {
      const selfRe = new RegExp(`^\\s*${VIS}use\\s+self::([\\w:]+)`, 'gm');
      let sm;
      while ((sm = selfRe.exec(content))) {
        const segs = sm[1].split('::').filter(Boolean);
        const base = rustModuleBaseDir(filePath, ctx.crateRoots);
        for (const t of resolveRustPath(base, segs, ctx.repoPath)) add(t, 'use-self');
      }
    }
    if (desc.importSyntax.super) {
      const superRe = new RegExp(`^\\s*${VIS}use\\s+super::([\\w:]+)`, 'gm');
      let sup;
      while ((sup = superRe.exec(content))) {
        const segs = sup[1].split('::').filter(Boolean);
        const base = dirnameOf(rustModuleBaseDir(filePath, ctx.crateRoots));
        for (const t of resolveRustPath(base, segs, ctx.repoPath)) add(t, 'use-super');
      }
    }
    const modRe = new RegExp(`^\\s*${VIS}mod\\s+(\\w+)`, 'gm');
    let mm;
    while ((mm = modRe.exec(content))) {
      for (const t of resolveRustMod(mm[1], filePath, ctx.crateRoots, ctx.repoPath)) add(t, 'mod');
    }
    // Bare `use crate-name::…`: emit an edge only for local crate names.
    const bareRe = new RegExp(`^\\s*${VIS}use\\s+(?!crate::|self::|super::)([A-Za-z_][\\w]*(?:::[\\w]+)*)`, 'gm');
    let bm;
    while ((bm = bareRe.exec(content))) {
      const head = bm[1].split('::')[0];
      const root = ctx.localCrateRoots.get(head);
      if (root) add(root, 'use-bare');
    }
  } else if (ecosystem === 'shell') {
    const re = new RegExp(desc.importSyntax.source.source, 'gm');
    let m;
    while ((m = re.exec(content))) add(resolveShellRelative(filePath, m[1], ctx.repoPath), 'source');
    // P2: best-effort script invocations beyond `source`/`.`.
    const bashRe = /(?:^|[\s;&|(])(?:bash|sh|zsh)\s+['"]?([\w./-]+\.sh)['"]?/g;
    while ((m = bashRe.exec(content))) add(resolveShellRelative(filePath, m[1], ctx.repoPath), 'script');
    const execRe = /(?:^|[\s;&|(])((?:\.{1,2}\/|\/?(?:scripts|lib)\/)[\w./-]+\.sh)/g;
    while ((m = execRe.exec(content))) add(resolveShellRelative(filePath, m[1], ctx.repoPath), 'script');
  }

  return edges;
}

function resolveJsSpecifier(spec, filePath, ctx) {
  if (spec === '.' || spec === '..') return null;
  if (spec.startsWith('.') || spec.startsWith('/')) {
    if (spec.startsWith('/')) {
      const cand = probeJs(join(ctx.repoPath, spec.slice(1)));
      return cand ? toRel(ctx.repoPath, cand) : null;
    }
    return resolveJsRelative(filePath, spec, ctx.repoPath);
  }
  if (ctx.alias.entries.length) {
    const aliased = resolveAliased(spec, ctx.alias, ctx.repoPath);
    if (aliased) return aliased;
  }
  return resolveBare(spec, ctx.workspaceMap);
}

// ---------------------------------------------------------------------------
// Import graph
// ---------------------------------------------------------------------------

function buildImportGraph(sourceFiles, ecosystems, ctx, limits = null) {
  const graph = {};
  const reverseGraph = {};
  const edgeKinds = {};
  let edgesTotal = 0;
  let edgesAdded = 0;
  for (const f of sourceFiles) {
    graph[f] = [];
    reverseGraph[f] = reverseGraph[f] || [];
  }
  for (const f of sourceFiles) {
    const eco = ecosystemForFile(f, ecosystems);
    if (!eco) continue;
    const records = parseImports(f, eco, ctx);
    for (const { target: t, kind } of records) {
      edgesTotal += 1;
      if (limits && edgesAdded >= limits.edges) continue;
      edgesAdded += 1;
      if (!graph[f].includes(t)) graph[f].push(t);
      if (!reverseGraph[t]) reverseGraph[t] = [];
      if (!reverseGraph[t].includes(f)) reverseGraph[t].push(f);
      if (!edgeKinds[f]) edgeKinds[f] = {};
      edgeKinds[f][t] = kind;
    }
  }
  return {
    graph,
    reverseGraph,
    edgeKinds,
    edgesInspected: edgesAdded,
    edgesOmitted: edgesTotal - edgesAdded,
  };
}

// ---------------------------------------------------------------------------
// Entrypoint + layer identification
// ---------------------------------------------------------------------------

function resolveFilePath(target, repoPath) {
  if (!target) return null;
  const cleaned = target.replace(/^\.\//, '');
  if (existsSync(join(repoPath, cleaned))) return toPosix(cleaned);
  const cand = probeJs(join(repoPath, cleaned));
  if (cand) return toRel(repoPath, cand);
  return null;
}

function resolveEntrypoint(ep, topPackages, repoPath) {
  const eq = ep.indexOf('=');
  const target = eq >= 0 ? ep.slice(eq + 1) : ep;
  if (!target) return null;
  if (target.includes(':')) {
    const mod = target.split(':')[0];
    const files = resolvePythonAbsolute(mod, [], topPackages, repoPath);
    return files.find((f) => !f.endsWith('/')) || files[0] || null;
  }
  return resolveFilePath(target, repoPath);
}

function identifyLayers(sourceFiles, graph, reverseGraph, ctx) {
  const sourceSet = new Set(sourceFiles);
  const entryPoints = [];
  const epSeen = new Set();
  const addEP = (f) => {
    if (f && sourceSet.has(f) && !epSeen.has(f) && !isTestFile(f)) {
      epSeen.add(f);
      entryPoints.push(f);
    }
  };

  for (const ep of ctx.entrypointFiles) addEP(ep);
  for (const f of sourceFiles) {
    if (basenameOf(f) === '__main__.py') addEP(f);
  }
  for (const f of sourceFiles) {
    if (/^(cli|main|app|index|server)\./i.test(basenameOf(f))) addEP(f);
  }

  const coreModules = [];
  const coreSeen = new Set();
  if (ctx.pkgRoot) {
    for (const f of sourceFiles) {
      if (isTestFile(f) || coreSeen.has(f)) continue;
      if (f === ctx.pkgRoot || f.startsWith(ctx.pkgRoot + '/')) {
        coreSeen.add(f);
        coreModules.push(f);
      }
    }
  }

  const sharedPatterns = ['util', 'helper', 'common', 'shared', 'config', 'types', 'constants'];
  const isTaken = (f) => epSeen.has(f) || coreSeen.has(f);
  const shared = [];
  const sharedSeen = new Set();
  for (const f of sourceFiles) {
    if (isTestFile(f) || isTaken(f) || sharedSeen.has(f)) continue;
    const stem = basenameOf(f).replace(/\.[^.]+$/, '').toLowerCase();
    if (sharedPatterns.some((p) => stem.includes(p))) {
      sharedSeen.add(f);
      shared.push(f);
    }
  }
  for (const f of sourceFiles) {
    if (isTestFile(f) || isTaken(f) || sharedSeen.has(f)) continue;
    if ((reverseGraph[f] || []).length >= 3) {
      sharedSeen.add(f);
      shared.push(f);
    }
  }

  const rest = sourceFiles.filter(
    (f) => !isTestFile(f) && !epSeen.has(f) && !coreSeen.has(f) && !sharedSeen.has(f),
  );

  const totalEdges = Object.values(graph).reduce((sum, deps) => sum + deps.length, 0);

  return {
    entryPoints: entryPoints.slice(0, 10),
    coreModules: coreModules.slice(0, 40),
    libModules: coreModules.slice(0, 20),
    shared: shared.slice(0, 20),
    rest: rest.slice(0, 15),
    totalFiles: sourceFiles.length,
    totalEdges,
  };
}

// ---------------------------------------------------------------------------
// ASCII graph
// ---------------------------------------------------------------------------

function generateAsciiGraph(layers) {
  const lines = [];
  const section = (title, items) => {
    lines.push(`[${title}] (${items.length})`);
    for (const it of items.slice(0, 8)) lines.push(`  - ${basenameOf(it)}`);
    if (items.length > 8) lines.push(`  ... +${items.length - 8} more`);
    lines.push('');
  };
  if (layers.entryPoints.length) section('Entry Points', layers.entryPoints);
  if (layers.libModules.length) section('Core Modules', layers.libModules);
  if (layers.shared.length) section('Shared Utilities', layers.shared);
  if (layers.rest.length) section('Other Modules', layers.rest);
  if (!lines.length) {
    return '_(No module graph detected — insufficient source files for analysis)_';
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// C4 diagrams
// ---------------------------------------------------------------------------

function escapeMermaid(s) {
  return String(s).replace(/["()]/g, '').replace(/[\[\]<>]/g, '');
}

function dirnameRelative(file) {
  return dirnameOf(file);
}

// Ecosystem-aware DB / external-API detection via shared/detection.mjs.
function detectNodes(manifest, ecosystems) {
  const deps = { ...(manifest && manifest.dependencies || {}), ...(manifest && manifest.devDependencies || {}) };
  const dbs = [];
  const apis = [];
  const seenDb = new Set();
  const seenApi = new Set();
  for (const eco of ecosystems) {
    for (const m of matchDep(deps, DATABASE_INDICATORS[eco] || {})) {
      const key = `${m.label}|${m.name}`;
      if (!seenDb.has(key)) {
        seenDb.add(key);
        dbs.push({ id: slug(m.name) || `db${dbs.length}`, label: m.label, desc: m.type || 'Database', relation: 'Reads/Writes' });
      }
    }
    for (const m of matchDep(deps, EXTERNAL_API_INDICATORS[eco] || {})) {
      const key = `${m.label}|${m.name}`;
      if (!seenApi.has(key)) {
        seenApi.add(key);
        apis.push({ id: slug(m.name) || `api${apis.length}`, label: m.label, desc: m.type || 'External service', relation: 'Calls' });
      }
    }
  }
  return { dbs, apis };
}

function generateC4Context(repoName, manifest, technology, nodes) {
  const name = escapeMermaid(manifest && manifest.name || repoName);
  const desc = escapeMermaid(manifest && manifest.description || 'Application');
  const { dbs, apis } = nodes;
  const lines = [
    'C4Context',
    `  title System Context — ${repoName}`,
    '  Person(user, "User", "Interacts with the system")',
    `  System(app, "${name}", "${desc}")`,
  ];
  if (dbs.length) dbs.slice(0, 2).forEach((d) => lines.push(`  System_Ext(${d.id}, "${d.label}", "${d.desc}")`));
  else lines.push('  System_Ext(fs, "File System", "Local files and config")');
  apis.slice(0, 2).forEach((a) => lines.push(`  System_Ext(${a.id}, "${a.label}", "${a.desc}")`));
  lines.push('  Rel(user, app, "Uses")');
  if (dbs.length) dbs.slice(0, 2).forEach((d) => lines.push(`  Rel(app, ${d.id}, "${d.relation}")`));
  else lines.push('  Rel(app, fs, "Reads/Writes")');
  apis.slice(0, 2).forEach((a) => lines.push(`  Rel(app, ${a.id}, "${a.relation}")`));
  return '```mermaid\n' + lines.join('\n') + '\n```';
}

function generateC4Container(repoName, layers, technology, nodes) {
  const lines = ['C4Container', `  title Containers — ${repoName}`];
  if (layers.entryPoints.length) {
    const epNames = layers.entryPoints.slice(0, 3).map((f) => basenameOf(f).replace(/\.[^.]+$/, ''));
    lines.push(`  Container(entry, "Entry Points", "${technology}", "${escapeMermaid(epNames.join(', '))}")`);
  }
  if (layers.libModules.length) {
    lines.push(`  Container(lib, "Core Modules", "${technology}", "${layers.libModules.length} modules")`);
  }
  if (layers.shared.length) {
    lines.push(`  Container(shared, "Shared Utilities", "${technology}", "${layers.shared.length} modules")`);
  }
  const { dbs } = nodes;
  if (dbs.length) dbs.slice(0, 2).forEach((d) => lines.push(`  ContainerDb(${d.id}, "${d.label}", "${d.desc}")`));
  else lines.push('  ContainerDb(fs, "File System", "Local storage")');
  if (layers.entryPoints.length && layers.libModules.length) lines.push('  Rel(entry, lib, "Uses")');
  if (layers.libModules.length && layers.shared.length) lines.push('  Rel(lib, shared, "Uses")');
  if (layers.entryPoints.length && layers.shared.length) lines.push('  Rel(entry, shared, "Uses")');
  return '```mermaid\n' + lines.join('\n') + '\n```';
}

function generateC4Component(repoName, layers) {
  const lines = ['C4Component'];
  const mainModule = layers.libModules.length
    ? dirnameRelative(layers.libModules[0])
    : layers.entryPoints.length ? dirnameRelative(layers.entryPoints[0]) : 'src';
  lines.push(`  title Components — ${mainModule}/`);
  const comp = (mod) => {
    const cName = mod.replace(/[/.]/g, '_').replace(/^_+|_+$/g, '');
    const label = basenameOf(mod).replace(/\.[^.]+$/, '');
    lines.push(`  Component(${cName}, "${escapeMermaid(label)}", "${escapeMermaid(mod)}")`);
  };
  const shownModules = layers.libModules.slice(0, 8);
  const shownShared = layers.shared.slice(0, 5);
  shownModules.forEach(comp);
  shownShared.forEach(comp);
  for (let i = 0; i < shownModules.length; i++) {
    for (let j = i + 1; j < Math.min(i + 2, shownModules.length); j++) {
      const a = shownModules[i].replace(/[/.]/g, '_').replace(/^_+|_+$/g, '');
      const b = shownModules[j].replace(/[/.]/g, '_').replace(/^_+|_+$/g, '');
      lines.push(`  Rel(${a}, ${b}, "May use")`);
    }
  }
  return '```mermaid\n' + lines.join('\n') + '\n```';
}

function extractExports(repoPath, files, maxFiles = 5) {
  const allExports = [];
  for (const file of files.slice(0, maxFiles)) {
    if (isDeclarationFile(file)) continue;
    const ext = extOf(file);
    const content = readContent(join(repoPath, file));
    if (!content) continue;
    const exports = [];
    const lines = content.split('\n');
    let m;
    if (ext === '.py' || ext === '.pyi') {
      for (const line of lines) {
        if ((m = line.match(/^(?:async\s+)?def\s+(\w+)/))) { exports.push({ kind: 'function', name: m[1] }); continue; }
        if ((m = line.match(/^class\s+(\w+)/))) { exports.push({ kind: 'class', name: m[1] }); continue; }
        if (/^\s*__all__\s*=/.test(line)) { exports.push({ kind: 'all', name: '__all__' }); continue; }
      }
    } else if (['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx'].includes(ext)) {
      for (const line of lines) {
        if ((m = line.match(/export\s+(?:async\s+)?function\s+(\w+)/))) { exports.push({ kind: 'function', name: m[1] }); continue; }
        if ((m = line.match(/export\s+(?:async\s+)?class\s+(\w+)/))) { exports.push({ kind: 'class', name: m[1] }); continue; }
        if ((m = line.match(/export\s+(?:const|let|var)\s+(\w+)\s*=/))) { exports.push({ kind: 'variable', name: m[1] }); continue; }
        if ((m = line.match(/export\s+(?:type|interface)\s+(\w+)/))) { exports.push({ kind: 'type', name: m[1] }); continue; }
        if ((m = line.match(/export\s+enum\s+(\w+)/))) { exports.push({ kind: 'enum', name: m[1] }); continue; }
        if ((m = line.match(/export\s+default\s+(?:async\s+)?function\s+(\w+)/))) { exports.push({ kind: 'default-function', name: m[1] }); continue; }
        if ((m = line.match(/export\s+default\s+class\s+(\w+)/))) { exports.push({ kind: 'default-class', name: m[1] }); continue; }
        // Re-exports.
        if ((m = line.match(/export\s+\*\s+(?:as\s+(\w+)\s+)?from\s+['"]([^'"]+)['"]/))) {
          exports.push({ kind: 're-export', name: m[1] || `* from ${m[2]}` }); continue;
        }
        if ((m = line.match(/export\s+\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/))) {
          for (const n of splitNames(m[1])) exports.push({ kind: 're-export', name: n });
          continue;
        }
        // CommonJS: module.exports = { … } and exports.x = …
        if ((m = line.match(/module\.exports\s*=\s*\{([^}]*)\}/))) {
          for (const n of splitNames(m[1].replace(/:[^,}]*/g, ''))) {
            if (/^(function|class|async)$/.test(n)) continue;
            exports.push({ kind: 'cjs-export', name: n });
          }
          continue;
        }
        if ((m = line.match(/module\.exports\s*=\s*(\w+)/))) { exports.push({ kind: 'cjs-export', name: m[1] }); continue; }
        if ((m = line.match(/^exports\.(\w+)\s*=/))) { exports.push({ kind: 'cjs-export', name: m[1] }); continue; }
      }
    } else if (ext === '.rs') {
      const vis = 'pub(?:\\s*\\(crate\\))?\\s+';
      for (const line of lines) {
        if ((m = line.match(new RegExp(`^\\s*${vis}(?:async\\s+)?fn\\s+(\\w+)`)))) { exports.push({ kind: 'function', name: m[1] }); continue; }
        if ((m = line.match(new RegExp(`^\\s*${vis}struct\\s+(\\w+)`)))) { exports.push({ kind: 'class', name: m[1] }); continue; }
        if ((m = line.match(new RegExp(`^\\s*${vis}enum\\s+(\\w+)`)))) { exports.push({ kind: 'enum', name: m[1] }); continue; }
        if ((m = line.match(new RegExp(`^\\s*${vis}trait\\s+(\\w+)`)))) { exports.push({ kind: 'trait', name: m[1] }); continue; }
        if ((m = line.match(new RegExp(`^\\s*${vis}type\\s+(\\w+)`)))) { exports.push({ kind: 'type', name: m[1] }); continue; }
        if ((m = line.match(new RegExp(`^\\s*${vis}(?:const|static)\\s+(\\w+)`)))) { exports.push({ kind: 'constant', name: m[1] }); continue; }
        if ((m = line.match(new RegExp(`^\\s*${vis}mod\\s+(\\w+)`)))) { exports.push({ kind: 'module', name: m[1] }); continue; }
        if ((m = line.match(new RegExp(`^\\s*${vis}use\\s+([^;]+)`)))) { exports.push({ kind: 're-export', name: m[1].trim() }); continue; }
      }
    } else {
      continue;
    }
    if (exports.length) allExports.push({ file, exports: exports.slice(0, 12) });
  }
  return allExports;
}

function generateC4Code(repoName, layers) {
  const repoPath = layers._repoPath || '';
  if (!repoPath) return '_(No source path available for code-level diagram)_';
  const modules = [...(layers.coreModules || layers.libModules || []), ...(layers.shared || [])].slice(0, 3);
  if (!modules.length) return '_(No modules detected for code-level diagram)_';
  const exports = extractExports(repoPath, modules, 3);
  if (!exports.length || exports.every((e) => !e.exports.length)) {
    return '_(No exports detected for code-level diagram)_';
  }
  const iconMap = { function: 'F', class: 'C', variable: 'V', type: 'T', enum: 'E', trait: 'Tr', constant: 'K', module: 'M', 'default-function': 'DF', 'default-class': 'DC', 'cjs-export': 'X', 're-export': 'R', all: 'A' };
  const lines = ['C4Code'];
  for (const mod of exports) {
    const simpleName = basenameOf(mod.file).replace(/\.[^.]+$/, '');
    const cName = mod.file.replace(/[/.]/g, '_').replace(/^_+|_+$/g, '');
    lines.push(`  title ${escapeMermaid(simpleName)} — ${repoName}`);
    lines.push(`  Component(${cName}, "${escapeMermaid(simpleName)}", "${escapeMermaid(mod.file)}")`);
    let n = 0;
    for (const exp of mod.exports.slice(0, 10)) {
      const expId = `${cName}_${exp.name.replace(/[^a-zA-Z0-9_]/g, '')}`;
      const icon = iconMap[exp.kind] || '?';
      const kind = exp.kind === 'class' || exp.kind === 'default-class' ? 'Class' : 'Func';
      lines.push(`  ${kind}(${expId}, "${escapeMermaid(exp.name)}", "${icon}")`);
      lines.push(`  BiRel(${cName}, ${expId}, "exports")`);
      n++;
    }
    if (mod.exports.length > n) {
      lines.push(`  Func(${cName}_more, "... ${mod.exports.length - n} more", "…")`);
      lines.push(`  BiRel(${cName}, ${cName}_more, "exports")`);
    }
  }
  return '```mermaid\n' + lines.join('\n') + '\n```';
}

// ---------------------------------------------------------------------------
// Graph preparation (shared by scan and the graph-facts analysis)
// ---------------------------------------------------------------------------

async function prepareGraph(repoPath, overview) {
  const ov = overview || {};
  const allFiles = await listFiles(repoPath, ov);
  const ecosystems = resolveEcosystems(repoPath, ov, allFiles);
  const { primary } = ecosystems;
  const manifest = resolveManifest(repoPath, ov);

  const extSet = sourceExtensionSet(ecosystems.all);
  const extMatched = allFiles.filter((f) => extSet.has(extOf(f)));
  const moduleFiles = extMatched.filter((f) => !isDeclarationFile(f));
  const declarationFilesExcluded = extMatched.length - moduleFiles.length;
  const sourceFiles = moduleFiles.filter((f) => !isTestFile(f));
  const testFilesExcluded = moduleFiles.length - sourceFiles.length;
  const sourceSet = new Set(sourceFiles);

  const { pkgRoot, primaryPackage } = detectPackageRoot(repoPath, manifest, primary);

  const topPackages = ecosystems.all.includes('python') ? discoverTopPackages(repoPath) : new Map();
  const rustCtx = ecosystems.all.includes('rust') ? buildRustContext(repoPath, manifest) : { crateRoots: new Set(), localCrateRoots: new Map() };
  const alias = ecosystems.all.some((e) => e === 'typescript' || e === 'javascript') ? readAliasConfig(repoPath) : { baseUrl: '', entries: [] };
  const workspaceMap = ecosystems.all.some((e) => e === 'typescript' || e === 'javascript') ? buildWorkspaceMap(repoPath, manifest) : new Map();

  const entrypointFiles = [];
  for (const ep of (manifest.entrypoints || [])) {
    const f = resolveEntrypoint(ep, topPackages, repoPath);
    if (f) entrypointFiles.push(f);
  }

  const ctx = {
    repoPath, sourceSet, pkgRoot, primaryPackage,
    topPackages, crateRoots: rustCtx.crateRoots, localCrateRoots: rustCtx.localCrateRoots,
    alias, workspaceMap,
  };

  return {
    ecosystems, manifest, moduleFiles, sourceFiles,
    declarationFilesExcluded, testFilesExcluded, ctx, entrypointFiles,
  };
}

// ---------------------------------------------------------------------------
// import-linter contracts
// ---------------------------------------------------------------------------
//
// `.importlinter` is a root dotfile that `enumerate` (rg --files) does not
// list, so it is probed explicitly. Each `[importlinter:contract:N]` section
// declares `name`/`type` plus `source_modules`/`forbidden_modules` (or `modules`
// for independence contracts). The fact is conditional-absent: repos without
// the artifact keep byte-identical findings. Module lists are bounded with
// truncation disclosed.

const IMPORT_CONTRACT_MODULE_CAP = 32;

function readImportContracts(repoPath) {
  const file = join(repoPath, '.importlinter');
  if (!existsSync(file)) return null;
  let parsed;
  try {
    parsed = parseIniSections(readContent(file));
  } catch {
    return null;
  }
  const contracts = [];
  for (const section of parsed.sections) {
    if (!/^importlinter:contract:/i.test(section.name)) continue;
    const entries = new Map(section.entries.map((entry) => [entry.key, entry.value]));
    const name = entries.get('name');
    const type = entries.get('type');
    if (!name || !type) continue;
    const modulesOf = (key) => {
      const list = String(entries.get(key) || '')
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean);
      return {
        list: list.slice(0, IMPORT_CONTRACT_MODULE_CAP),
        truncated: list.length > IMPORT_CONTRACT_MODULE_CAP,
      };
    };
    const source = type === 'independence' ? modulesOf('modules') : modulesOf('source_modules');
    const forbidden = modulesOf('forbidden_modules');
    contracts.push({
      name,
      type,
      sourceModules: source.list,
      forbiddenModules: forbidden.list,
      truncated: source.truncated || forbidden.truncated,
    });
  }
  return contracts.length > 0 ? contracts : null;
}

// ---------------------------------------------------------------------------
// Scan entry point
// ---------------------------------------------------------------------------

export async function scan(repoPath, overview) {
  const prepared = await prepareGraph(repoPath, overview);
  const {
    ecosystems, manifest, moduleFiles, sourceFiles, ctx, entrypointFiles,
  } = prepared;
  const { primary } = ecosystems;

  const { graph, reverseGraph } = buildImportGraph(sourceFiles, ecosystems.all, ctx);

  const layers = identifyLayers(sourceFiles, graph, reverseGraph, {
    ecosystem: primary, pkgRoot: ctx.pkgRoot, manifest, entrypointFiles,
  });
  layers._repoPath = repoPath;

  const nodes = detectNodes(manifest, ecosystems.all);
  const technology = ecoTechnology(primary);
  const repoName = basenameOf(repoPath);

  const asciiGraph = generateAsciiGraph(layers);
  const c4Context = generateC4Context(repoName, manifest, technology, nodes);
  const c4Container = generateC4Container(repoName, layers, technology, nodes);
  const c4Component = generateC4Component(repoName, layers);
  const c4Code = generateC4Code(repoName, layers);
  const importContracts = readImportContracts(repoPath);
  const canonical = scanCanonicalLayerModel(repoPath, {
    pkgRoot: ctx.pkgRoot,
    entrypointFiles,
  });

  const totalEdges = Object.values(graph).reduce((sum, deps) => sum + deps.length, 0);
  const signal = totalEdges > 20 ? 'high' : totalEdges > 0 ? 'medium' : 'low';

  return {
    dimension: 'architecture',
    signal,
    findings: {
      modules: moduleFiles,
      layers,
      asciiGraph,
      c4Context,
      c4Container,
      c4Component,
      c4Code,
      importGraph: { graph, reverseGraph },
      ...(importContracts ? { importContracts } : {}),
      ...(canonical ? { canonical } : {}),
    },
  };
}

/**
 * Compute the raw graph-facts extension for the Architecture dimension.
 *
 * T217: dynamic import/reflection/plugin/codegen/macro indicators, explicit
 * fan-in/fan-out counts, edge-kind counts, self-loops, Tarjan
 * strongly-connected components, graph bounds, and measurement-universe
 * metadata. This is an ADDITIVE analysis over the same validated import graph
 * that `scan()` builds; `scan()`'s output is byte-identical whether or not
 * this analysis runs. Raw values only — no hub/coupling/quality verdict.
 *
 * @param {string} repoPath - Repository root.
 * @param {object} [overview] - Survey overview (as accepted by `scan`).
 * @param {object} [options] - Optional `{ limits }` overriding
 *   `GRAPH_FACTS_LIMITS` (used to exercise caps deterministically).
 * @returns {object} A deep-frozen, deterministically ordered facts record:
 *   `{ bounds, universe, edgeKindCounts, fanIn, fanOut, selfLoops,
 *   stronglyConnectedComponents, dynamicIndicators }`.
 */
export async function analyzeGraphFacts(repoPath, overview, options = {}) {
  const opts = options || {};
  const limits = { ...GRAPH_FACTS_LIMITS, ...(opts.limits || {}) };
  const prepared = await prepareGraph(repoPath, overview);
  const { ecosystems, moduleFiles, sourceFiles, ctx } = prepared;

  const analyzed = sourceFiles.slice(0, limits.files);
  const filesOmitted = sourceFiles.length - analyzed.length;

  const analyzedCtx = { ...ctx, sourceSet: new Set(analyzed) };
  const { graph, edgeKinds, edgesInspected, edgesOmitted } =
    buildImportGraph(analyzed, ecosystems.all, analyzedCtx, limits);

  const indicators = [];
  for (const file of analyzed) {
    const eco = ecosystemForFile(file, ecosystems.all);
    if (!eco) continue;
    const content = readContent(join(ctx.repoPath, file));
    if (!content) continue;
    for (const indicator of detectDynamicIndicators(content, eco)) {
      indicators.push({ file, ...indicator });
    }
  }
  indicators.sort((left, right) => compareAscii(left.file, right.file)
    || left.line - right.line
    || compareAscii(left.kind, right.kind));
  const indicatorsDetected = indicators.length;
  const indicatorsOmitted = Math.max(0, indicators.length - limits.indicators);
  if (indicators.length > limits.indicators) indicators.length = limits.indicators;

  const { fanIn, fanOut } = computeFanInOut(graph);
  const selfLoops = computeSelfLoops(graph);
  const stronglyConnectedComponents = tarjanStronglyConnectedComponents(graph);
  const edgeKindCounts = computeEdgeKindCounts(edgeKinds);
  const bounds = computeBounds({
    filesInspected: analyzed.length,
    fileLimit: limits.files,
    filesOmitted,
    edgesInspected,
    edgeLimit: limits.edges,
    edgesOmitted,
  });
  const universe = deepFreeze({
    ecosystems: [...ecosystems.all].sort(compareAscii),
    moduleFiles: moduleFiles.length,
    sourceFiles: sourceFiles.length,
    testFilesExcluded: prepared.testFilesExcluded,
    declarationFilesExcluded: prepared.declarationFilesExcluded,
    indicatorsDetected,
    indicatorsOmitted,
  });

  return deepFreeze({
    bounds,
    universe,
    edgeKindCounts,
    fanIn,
    fanOut,
    selfLoops,
    stronglyConnectedComponents,
    dynamicIndicators: indicators,
  });
}
