// Config dimension scanner.
//
// Detects lint/format/type-check/hook tooling in a repo, driven by the
// ecosystem descriptor table (linters/formatters/typeCheckers/hookFiles).
// Falls back gracefully when no survey overview is supplied by reading the
// manifests and config files directly.
//
// Contract preserved for write.mjs: returns { dimension:'config', signal,
// findings } where findings always carries lint/format/typescript/scripts/
// ci/docker/envVars. New richness keys: linters, formatters, typeCheckers,
// hooks (consumed by T019 rendering), plus buildTools, runtimes, markers,
// declaredTools (supplementary declared-tool inventory, shortfall c4).
//
// ESM only. Zero npm deps. node: builtins only.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { DESCRIPTORS, descriptorFor, detectEcosystems } from '../shared/ecosystem.mjs';
import { parseToml, parseYamlShallow } from '../shared/parse.mjs';
import { readManifest } from '../shared/manifest.mjs';

// Hook config files are ecosystem-agnostic; mirror the shared constant so this
// scanner does not need a descriptor to have been resolved first.
const HOOK_FILES = ['lefthook.yml', 'lefthook.yaml', '.pre-commit-config.yaml', '.husky'];

const ESLINT_FLAT_CONFIGS = new Set([
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
]);

// Bounded vocabulary of declared QA/toolchain tools that the descriptor-driven
// collectTools does not cover (shortfall c4). Used by the supplementary
// declared-tool detector; kept deliberately small so the toolchain inventory
// stays deterministic and free of generic dependency noise.
const DECLARED_TOOL_VOCABULARY = Object.freeze([
  'refurb',
  'ty',
  'radon',
  'mutmut',
  'hypothesis',
  'import-linter',
  'diff-cover',
  'actionlint',
]);

const DECLARED_TOOL_PATTERNS = DECLARED_TOOL_VOCABULARY.map((name) => ({
  name,
  re: new RegExp(`\\b${name.replace(/-/g, '\\-')}\\b`),
}));

// ---------------------------------------------------------------------------
// Context: caches parsed manifests/configs + optional pre-enumerated file set
// ---------------------------------------------------------------------------

function buildContext(repoPath, overview) {
  const filesSet = new Set();
  if (overview && Array.isArray(overview.files)) {
    for (const f of overview.files) {
      if (typeof f !== 'string') continue;
      filesSet.add(f.replace(/^\.\//, ''));
    }
  }
  return {
    repoPath,
    filesSet,
    textCache: new Map(),
    tomlCache: new Map(),
    jsonCache: new Map(),
  };
}

function fileExists(ctx, file) {
  if (ctx.filesSet.size > 0 && ctx.filesSet.has(file)) return true;
  try {
    return existsSync(join(ctx.repoPath, file));
  } catch {
    return false;
  }
}

function readTextCached(ctx, file) {
  if (ctx.textCache.has(file)) return ctx.textCache.get(file);
  let text = null;
  try {
    text = readFileSync(join(ctx.repoPath, file), 'utf-8');
  } catch {
    text = null;
  }
  ctx.textCache.set(file, text);
  return text;
}

function readTomlCached(ctx, file) {
  if (ctx.tomlCache.has(file)) return ctx.tomlCache.get(file);
  const raw = readTextCached(ctx, file);
  let parsed = null;
  if (raw != null) {
    try {
      parsed = parseToml(raw);
    } catch {
      parsed = null;
    }
  }
  const entry = { raw, parsed };
  ctx.tomlCache.set(file, entry);
  return entry;
}

function readJsonCached(ctx, file) {
  if (ctx.jsonCache.has(file)) return ctx.jsonCache.get(file);
  const raw = readTextCached(ctx, file);
  let parsed = null;
  if (raw != null) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  ctx.jsonCache.set(file, parsed);
  return parsed;
}

// ---------------------------------------------------------------------------
// Path/spec matching helpers
// ---------------------------------------------------------------------------

function walkPath(obj, segments) {
  let cur = obj;
  for (const seg of segments) {
    if (cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, seg)) {
      cur = cur[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

// A TOML section is "present" if either (a) the parsed object contains the
// dotted path, or (b) the raw text has an exact `[section]` / `[[section]]`
// header line. The text fallback covers INI-ish files (e.g. setup.cfg) that
// the strict TOML subset parser may reject.
function tomlSectionPresent(parsed, raw, section) {
  if (parsed && typeof parsed === 'object') {
    if (walkPath(parsed, section.split('.')) !== undefined) return true;
  }
  if (raw == null) return false;
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('^\\s*\\[+' + escaped + '\\]+\\s*(?:#.*)?$', 'm');
  return re.test(raw);
}

// Resolve a single descriptor `files` entry to its matched config reference, or
// null when absent. Entries are one of:
//   - plain filename         -> existence check
//   - 'path:[section]'       -> TOML section marker (split on ':[')
//   - 'path#dotted.key'      -> JSON key marker (e.g. package.json#eslintConfig)
function specMatches(ctx, entry) {
  if (typeof entry !== 'string' || entry === '') return null;

  const markerIdx = entry.indexOf(':[');
  if (markerIdx !== -1) {
    const file = entry.slice(0, markerIdx);
    const section = entry.slice(markerIdx + 2).replace(/\]\s*$/, '');
    if (!fileExists(ctx, file)) return null;
    const { raw, parsed } = readTomlCached(ctx, file);
    if (raw == null) return null;
    return tomlSectionPresent(parsed, raw, section) ? entry : null;
  }

  const hashIdx = entry.indexOf('#');
  if (hashIdx !== -1) {
    const file = entry.slice(0, hashIdx);
    const keyPath = entry.slice(hashIdx + 1);
    if (!fileExists(ctx, file)) return null;
    const json = readJsonCached(ctx, file);
    if (!json || typeof json !== 'object') return null;
    const val = walkPath(json, keyPath.split('.'));
    return val != null ? entry : null;
  }

  return fileExists(ctx, entry) ? entry : null;
}

function firstMatchingFile(ctx, files) {
  for (const f of files) {
    const matched = specMatches(ctx, f);
    if (matched != null) return matched;
  }
  return null;
}

// Collect tool specs across all detected ecosystem descriptors, de-duplicating
// by tool name (e.g. eslint/biome appear in both js and ts descriptors).
function collectTools(ctx, descriptors, field) {
  const out = [];
  const seen = new Set();
  for (const desc of descriptors) {
    const specs = (desc && Array.isArray(desc[field])) ? desc[field] : [];
    for (const spec of specs) {
      if (!spec || typeof spec.name !== 'string' || seen.has(spec.name)) continue;
      const config = firstMatchingFile(ctx, spec.files || []);
      if (config == null) continue;
      // Honor marker specs: file existence alone is insufficient. The shfmt
      // entry lists `.editorconfig` but should only be reported when the
      // editorconfig declares a shell-relevant section (P0-12).
      if (spec.marker === true && !validateMarker(ctx, spec, config)) continue;
      seen.add(spec.name);
      out.push({ name: spec.name, config });
    }
  }
  return out;
}

// Marker specs require content-level validation beyond file existence.
function validateMarker(ctx, spec, config) {
  if (spec.name === 'shfmt' && config === '.editorconfig') {
    return editorConfigHasShell(ctx);
  }
  return true;
}

// shfmt reads shell formatting options from .editorconfig. Only treat shfmt as
// configured when the editorconfig declares a shell-relevant section header
// (e.g. [*.sh], [*sh], [*.{sh,bash}]) or the shfmt-specific `shell_variant`
// property. A generic .editorconfig must NOT imply shfmt (P0-12).
function editorConfigHasShell(ctx) {
  const text = readTextCached(ctx, '.editorconfig');
  if (text == null) return false;
  if (/^\s*shell_variant\s*=/m.test(text)) return true;
  for (const m of text.matchAll(/^\s*\[([^\]]*)\]/gm)) {
    if (/\b(?:sh|bash|zsh)\b/i.test(m[1])) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Ecosystem resolution (prefer overview, fall back to computing)
// ---------------------------------------------------------------------------

function resolveEcosystems(overview, repoPath) {
  const ov = overview || {};
  const eco = ov.ecosystems;
  if (eco && Array.isArray(eco.all) && eco.all.length > 0) {
    return [...eco.all];
  }
  let manifest = ov.manifest;
  if (!manifest || !Array.isArray(manifest.ecosystems)) {
    try {
      manifest = readManifest(repoPath);
    } catch {
      manifest = { ecosystems: [] };
    }
  }
  if (Array.isArray(manifest.ecosystems) && manifest.ecosystems.length > 0) {
    return [...manifest.ecosystems];
  }
  try {
    return detectEcosystems(ov, manifest || {}).all;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Individual detectors
// ---------------------------------------------------------------------------

function classifyLintStyle(linters, primary) {
  if (linters.length > 1) return 'multi';
  if (primary.name === 'eslint') {
    const cfgFile = primary.config.split(':[')[0].split('#')[0];
    return ESLINT_FLAT_CONFIGS.has(cfgFile) ? 'flat' : 'legacy';
  }
  return 'flat';
}

function detectTsConfig(ctx) {
  if (!fileExists(ctx, 'tsconfig.json')) return null;
  const tsconfig = readJsonCached(ctx, 'tsconfig.json');
  if (!tsconfig || typeof tsconfig !== 'object') {
    return { config: 'tsconfig.json', strict: false, target: null, paths: false };
  }
  const co = tsconfig.compilerOptions || {};
  // `paths` preserves the real alias map when available (e.g.
  // {'@/*': ['src/*']}); falls back to a boolean for the legacy contract.
  const paths = co.paths && typeof co.paths === 'object' ? co.paths : !!co.paths;
  return {
    config: 'tsconfig.json',
    strict: co.strict === true,
    target: co.target || null,
    paths,
    noImplicitAny: co.noImplicitAny === true,
    moduleResolution: co.moduleResolution || null,
    module: co.module || null,
    baseUrl: co.baseUrl || null,
    extends: tsconfig.extends || null,
    references: Array.isArray(tsconfig.references) ? tsconfig.references : null,
    composite: co.composite === true,
    declaration: co.declaration === true,
  };
}

function detectHooks(ctx) {
  const hooks = [];
  for (const file of HOOK_FILES) {
    if (!fileExists(ctx, file)) continue;
    const tool =
      file.startsWith('lefthook') ? 'lefthook'
        : file === '.pre-commit-config.yaml' ? 'pre-commit'
          : file === '.husky' ? 'husky'
            : file;
    const entry = { tool, file };
    // Attempt a shallow parse for richness. parseYamlShallow THROWS on block
    // scalars and other unsupported constructs; on throw we treat the file as
    // "exists but unparseable" and keep just the file name.
    if (file.endsWith('.yml') || file.endsWith('.yaml')) {
      const text = readTextCached(ctx, file);
      if (text != null) {
        try {
          const parsed = parseYamlShallow(text);
          if (parsed && typeof parsed === 'object') {
            const keys = Object.keys(parsed).filter(
              (k) => k !== 'repos' && k !== 'default_install_hook_types' && k !== 'remote',
            );
            if (keys.length > 0) entry.hooks = keys;
          }
        } catch {
          // exists but unparseable — record file name only
        }
      }
    }
    hooks.push(entry);
  }
  return hooks;
}

// Bundlers / build orchestration tools (P1). Detected by canonical config file
// presence, independent of ecosystem descriptors.
const BUILD_TOOL_FILES = [
  { name: 'webpack', files: ['webpack.config.js', 'webpack.config.ts', 'webpack.config.mjs', 'webpack.config.cjs'] },
  { name: 'vite', files: ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs'] },
  { name: 'rollup', files: ['rollup.config.js', 'rollup.config.ts', 'rollup.config.mjs', 'rollup.config.cjs'] },
  { name: 'esbuild', files: ['esbuild.config.js', 'esbuild.config.mjs', 'esbuild.config.ts', 'esbuild.config.cjs'] },
  { name: 'turbo', files: ['turbo.json'] },
  { name: 'tsup', files: ['tsup.config.ts', 'tsup.config.js', 'tsup.config.mjs', 'tsup.config.cjs'] },
];

function detectBuildTools(ctx) {
  const out = [];
  const seen = new Set();
  for (const spec of BUILD_TOOL_FILES) {
    if (seen.has(spec.name)) continue;
    for (const f of spec.files) {
      if (!fileExists(ctx, f)) continue;
      seen.add(spec.name);
      out.push({ name: spec.name, config: f });
      break;
    }
  }
  return out;
}

// Alternative JS/TS runtimes and project manifests (P1).
const RUNTIME_FILES = [
  { name: 'deno', files: ['deno.json', 'deno.jsonc'] },
  { name: 'bun', files: ['bunfig.toml'] },
  { name: 'jsconfig', files: ['jsconfig.json'] },
];

function detectRuntimes(ctx) {
  const out = [];
  const seen = new Set();
  for (const spec of RUNTIME_FILES) {
    if (seen.has(spec.name)) continue;
    for (const f of spec.files) {
      if (!fileExists(ctx, f)) continue;
      seen.add(spec.name);
      out.push({ name: spec.name, config: f });
      break;
    }
  }
  return out;
}

// Ecosystem marker files surfaced from descriptor `markers` arrays (P1):
// py.typed, MANIFEST.in, .python-version, .cargo/config.toml,
// rust-toolchain.toml, etc. Returns the list of those present.
function detectMarkers(ctx, descriptors) {
  const out = [];
  const seen = new Set();
  for (const desc of descriptors) {
    const markers = desc && Array.isArray(desc.markers) ? desc.markers : [];
    for (const m of markers) {
      if (typeof m !== 'string' || seen.has(m)) continue;
      if (fileExists(ctx, m)) {
        seen.add(m);
        out.push(m);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Supplementary declared-tool detector (shortfall c4)
// ---------------------------------------------------------------------------
// Inventories declared tool configs/deps that the descriptor-driven
// collectTools does not cover: the manifest's dependency groups (PEP 735),
// optional-dependencies extras (PEP 621), and `[tool.<name>]` config sections,
// plus Makefile-declared tools (e.g. actionlint via `uvx --from actionlint-py`).
// Emits per-tool facts with provenance: declared-in-deps vs declared-config.

// Parse a PEP 508 dependency spec's leading package name (e.g. "refurb>=2.0"
// -> "refurb"; "mutmut>=3.0; python_version < '3.12'" -> "mutmut").
function leadingDependencyName(spec) {
  if (typeof spec !== 'string') return null;
  const trimmed = spec.split(';')[0].trim();
  const match = trimmed.match(/^([A-Za-z0-9_.-]+)/);
  return match ? match[1] : null;
}

function detectDeclaredTools(ctx, ecosystems) {
  const entries = new Map();
  const addSource = (name, kind, ref) => {
    let entry = entries.get(name);
    if (!entry) {
      entry = { name, sources: [] };
      entries.set(name, entry);
    }
    if (!entry.sources.some((s) => s.kind === kind && s.ref === ref)) {
      entry.sources.push({ kind, ref });
    }
  };

  const { parsed } = readTomlCached(ctx, 'pyproject.toml');
  if (parsed && typeof parsed === 'object') {
    const extras = parsed.project && parsed.project['optional-dependencies'];
    if (extras && typeof extras === 'object') {
      for (const [group, list] of Object.entries(extras)) {
        if (!Array.isArray(list)) continue;
        for (const spec of list) {
          const name = leadingDependencyName(spec);
          if (name && DECLARED_TOOL_VOCABULARY.includes(name)) addSource(name, 'extra', group);
        }
      }
    }
    const depGroups = parsed['dependency-groups'];
    if (depGroups && typeof depGroups === 'object') {
      for (const [group, list] of Object.entries(depGroups)) {
        if (!Array.isArray(list)) continue;
        for (const spec of list) {
          const name = leadingDependencyName(spec);
          if (name && DECLARED_TOOL_VOCABULARY.includes(name)) addSource(name, 'dependency-group', group);
        }
      }
    }
    if (parsed.tool && typeof parsed.tool === 'object') {
      for (const name of Object.keys(parsed.tool)) {
        if (DECLARED_TOOL_VOCABULARY.includes(name)) addSource(name, 'tool-section', `tool.${name}`);
      }
    }
  }

  // Makefile-declared tools (e.g. actionlint) for Python repos. Word-boundary
  // matched so hyphens and bare names are handled without false positives.
  if (ecosystems.includes('python')) {
    const makefile = readTextCached(ctx, 'Makefile');
    if (makefile != null) {
      for (const { name, re } of DECLARED_TOOL_PATTERNS) {
        if (re.test(makefile) && !entries.has(name)) addSource(name, 'makefile', 'Makefile');
      }
    }
  }

  const out = [];
  for (const entry of entries.values()) {
    const hasDeps = entry.sources.some((s) => s.kind === 'extra' || s.kind === 'dependency-group');
    const hasConfig = entry.sources.some((s) => s.kind === 'tool-section' || s.kind === 'makefile');
    const provenance = [];
    if (hasDeps) provenance.push('declared-in-deps');
    if (hasConfig) provenance.push('declared-config');
    entry.sources.sort((a, b) => (a.kind === b.kind ? (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0) : a.kind < b.kind ? -1 : 1));
    out.push({ name: entry.name, provenance, sources: entry.sources });
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function detectCI(repoPath) {
  const workflowsDir = join(repoPath, '.github', 'workflows');
  if (!existsSync(workflowsDir)) return null;
  let files;
  try {
    files = readdirSync(workflowsDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  const jobs = new Set();
  for (const f of files) {
    let content;
    try {
      content = readFileSync(join(workflowsDir, f), 'utf-8');
    } catch {
      continue;
    }
    for (const m of content.matchAll(/^  (\w[\w-]*):\s*$/gm)) {
      if (m[1] !== 'on' && m[1] !== 'jobs' && m[1] !== 'env' && !m[1].startsWith('runs')) {
        jobs.add(m[1]);
      }
    }
    for (const m of content.matchAll(/^\s*name:\s*(.+)$/gm)) {
      if (!m[1].includes('CI') && !m[1].includes('Build') && !m[1].includes('Test') && !m[1].includes('Deploy')) {
        continue;
      }
      jobs.add(m[1].trim());
    }
  }
  return { platform: 'GitHub Actions', workflowCount: files.length, jobs: [...jobs].slice(0, 10) };
}

function detectDocker(repoPath) {
  const files = ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', '.dockerignore'];
  const found = files.filter((f) => existsSync(join(repoPath, f)));
  return found.length > 0 ? found : null;
}

function detectEnvVars(repoPath) {
  const samples = ['.env.example', '.env.sample', '.env.template', '.env.development', '.env.development.example'];
  const found = [];
  for (const f of samples) {
    if (!existsSync(join(repoPath, f))) continue;
    try {
      const content = readFileSync(join(repoPath, f), 'utf-8');
      const vars = content
        .split('\n')
        .filter((line) => /^[A-Z_]+=/.test(line))
        .map((line) => line.split('=')[0]);
      found.push({ file: f, varCount: vars.length, vars: vars.slice(0, 20) });
    } catch {
      found.push({ file: f, varCount: 0, vars: [] });
    }
  }
  return found.length > 0 ? found : null;
}

// ---------------------------------------------------------------------------
// Python strict-type-checking facts (pyright typeCheckingMode / mypy strict)
// ---------------------------------------------------------------------------

// Split a matched config spec into its file and (optional) TOML/INI section.
// Mirrors the parsing in specMatches: 'file:[section]' markers and plain
// filenames are both supported.
function parseConfigSpec(config) {
  const markerIdx = config.indexOf(':[');
  if (markerIdx !== -1) {
    return {
      file: config.slice(0, markerIdx),
      section: config.slice(markerIdx + 2).replace(/\]\s*$/, ''),
    };
  }
  return { file: config, section: null };
}

// Coerce a mypy/INI-style boolean ('True', 'true', '1', 'yes', ...) to a
// real boolean. Returns undefined for unrecognised values.
function coerceBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'true' || lower === 'yes' || lower === 'on' || lower === '1') return true;
    if (lower === 'false' || lower === 'no' || lower === 'off' || lower === '0') return false;
  }
  return undefined;
}

// Read `key` from a TOML/INI `section` of `file`. Prefers the parsed TOML
// object; falls back to a bounded raw-text scan of the section body for
// INI-style files (mypy.ini, setup.cfg) that the strict TOML subset parser
// may reject (e.g. `strict = True` with a capital T).
function readSectionValue(ctx, file, section, key) {
  const { raw, parsed } = readTomlCached(ctx, file);
  if (parsed && typeof parsed === 'object') {
    const node = walkPath(parsed, section.split('.'));
    if (node && typeof node === 'object' && Object.prototype.hasOwnProperty.call(node, key)) {
      return node[key];
    }
  }
  if (raw == null) return undefined;
  const escapedSection = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headerRe = new RegExp('^\\s*\\[+' + escapedSection + '\\]+\\s*(?:#.*)?$', 'm');
  const header = headerRe.exec(raw);
  if (!header) return undefined;
  const body = raw.slice(header.index + header[0].length).split(/\r?\n/);
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keyRe = new RegExp('^\\s*' + escapedKey + '\\s*=\\s*(.*?)\\s*$');
  for (const line of body) {
    if (/^\s*\[/.test(line)) break;
    const match = keyRe.exec(line);
    if (match) {
      return match[1]
        .replace(/[#].*$/, '')
        .trim()
        .replace(/^['"]|['"]$/g, '');
    }
  }
  return undefined;
}

// pyright strict facts: strict is true when typeCheckingMode is "strict";
// the declared mode value is preserved for the fact model.
function readPyrightFacts(ctx, tool) {
  const { file, section } = parseConfigSpec(tool.config);
  let mode = null;
  if (section) {
    const value = readSectionValue(ctx, file, section, 'typeCheckingMode');
    if (typeof value === 'string') mode = value;
  } else if (file === 'pyrightconfig.json') {
    const json = readJsonCached(ctx, file);
    if (json && typeof json.typeCheckingMode === 'string') mode = json.typeCheckingMode;
  }
  return { strict: mode === 'strict', typeCheckingMode: mode };
}

// mypy strict facts: strict reflects the declared `strict` flag (defaults to
// false when absent, matching mypy's own default).
function readMypyFacts(ctx, tool) {
  const { file, section } = parseConfigSpec(tool.config);
  const sectionName = section || 'mypy';
  const value = readSectionValue(ctx, file, sectionName, 'strict');
  return { strict: coerceBool(value) === true };
}

// Enrich typeChecker tool facts with pyright/mypy strict-mode values. Only
// pyright/mypy entries gain the extra fields, and those tools are only
// detected when their config file/section exists, so repos without these
// sections keep byte-identical output.
function enrichStrictFacts(ctx, typeCheckers) {
  return typeCheckers.map((tool) => {
    if (tool.name === 'pyright') return { ...tool, ...readPyrightFacts(ctx, tool) };
    if (tool.name === 'mypy') return { ...tool, ...readMypyFacts(ctx, tool) };
    return tool;
  });
}

// ---------------------------------------------------------------------------
// Top-level scan
// ---------------------------------------------------------------------------

export async function scan(repoPath, overview) {
  const ctx = buildContext(repoPath, overview);
  const ecosystems = resolveEcosystems(overview, repoPath);
  const descriptors = ecosystems.map(descriptorFor).filter(Boolean);

  const linters = collectTools(ctx, descriptors, 'linters');
  const formatters = collectTools(ctx, descriptors, 'formatters');
  const typeCheckers = enrichStrictFacts(ctx, collectTools(ctx, descriptors, 'typeCheckers'));
  const hooks = detectHooks(ctx);
  const buildTools = detectBuildTools(ctx);
  const runtimes = detectRuntimes(ctx);
  const markers = detectMarkers(ctx, descriptors);

  // Supplementary declared-tool inventory (shortfall c4). Each entry carries
  // merged provenance; tools also matched by the descriptor-driven collectTools
  // are tagged descriptorDetected so the renderer can show one merged row.
  const descriptorToolNames = new Set([
    ...linters.map((tool) => tool.name),
    ...formatters.map((tool) => tool.name),
    ...typeCheckers.map((tool) => tool.name),
    ...hooks.map((hook) => (hook && (hook.tool || hook.name)) || String(hook)),
  ]);
  const declaredTools = detectDeclaredTools(ctx, ecosystems).map((tool) => ({
    ...tool,
    descriptorDetected: descriptorToolNames.has(tool.name),
  }));

  // Primary lint summary (preserved contract key).
  let lint = null;
  if (linters.length > 0) {
    const primary = linters[0];
    lint = {
      config: `${primary.name}: ${primary.config}`,
      style: classifyLintStyle(linters, primary),
    };
  }

  // Format summary (preserved contract key): comma-joined formatter names.
  const format = formatters.length > 0 ? formatters.map((f) => f.name).join(', ') : null;

  // TypeScript summary (preserved contract key): TS only, via tsconfig.json.
  // Python type-checkers surface in `typeCheckers[]` but leave this null.
  const typescript = ecosystems.includes('typescript') ? detectTsConfig(ctx) : null;

  const pkg = readJSON(join(repoPath, 'package.json'));
  const scripts = pkg && pkg.scripts && Object.keys(pkg.scripts).length > 0 ? pkg.scripts : null;
  const ci = detectCI(repoPath);
  const docker = detectDocker(repoPath);
  const envVars = detectEnvVars(repoPath);

  const hasSignal =
    linters.length > 0 ||
    formatters.length > 0 ||
    typeCheckers.length > 0 ||
    hooks.length > 0;
  const signal = hasSignal ? 'high' : 'low';

  return {
    dimension: 'config',
    signal,
    findings: {
      lint,
      format,
      typescript,
      scripts,
      ci,
      docker,
      envVars,
      linters,
      formatters,
      typeCheckers,
      hooks,
      buildTools,
      runtimes,
      markers,
      declaredTools,
    },
  };
}

export { DESCRIPTORS };
