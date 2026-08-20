import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(__dirname, '..');

let errors = [];

function err(msg) {
  errors.push(msg);
}

function loadSkillMd() {
  const path = resolve(SKILL_DIR, 'SKILL.md');
  if (!existsSync(path)) {
    err('SKILL.md not found');
    return null;
  }
  return readFileSync(path, 'utf-8');
}

function validateFrontmatter(content) {
  const frontmatterRE = /^---\s*\n([\s\S]*?)\n---/;
  const m = content.match(frontmatterRE);
  if (!m) {
    err('SKILL.md missing YAML frontmatter (--- ... ---)');
    return false;
  }
  const fm = m[1];
  const nameMatch = fm.match(/^name:\s*(\S+)/m);
  if (!nameMatch) {
    err('SKILL.md frontmatter missing "name" field');
    return false;
  }
  const name = nameMatch[1];
  if (name !== 'csm-browse') {
    err(`SKILL.md name "${name}" != "csm-browse"`);
  }
  const dirName = basename(SKILL_DIR);
  if (dirName !== 'csm-browse') {
    err(`skill directory name "${dirName}" != "csm-browse"`);
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
    err(`SKILL.md name "${name}" does not match regex ^[a-z0-9]+(-[a-z0-9]+)*$`);
  }
  const descMatch = fm.match(/^description:\s*(.+)/m);
  if (!descMatch) {
    err('SKILL.md frontmatter missing "description" field');
    return false;
  }
  const desc = descMatch[1].trim();
  if (desc.length === 0) {
    err('SKILL.md description is empty');
  } else if (desc.length > 1024) {
    err(`SKILL.md description length ${desc.length} > 1024`);
  }
  return true;
}

function loadPackageJson() {
  const pkgPath = resolve(SKILL_DIR, 'package.json');
  if (!existsSync(pkgPath)) {
    err('package.json not found');
    return null;
  }
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf-8'));
  } catch (e) {
    err(`package.json invalid JSON: ${e.message}`);
    return null;
  }
}

// Bare-specifier import scan over source + test modules. F-058: a declared
// dependency is only load-bearing when some module actually imports it — an
// unused dep (jimp's class of bug) must fail the gate, and only imported deps
// need to resolve (a removed-but-lingering lockfile entry must not be required).
const IMPORT_SPECIFIER_RE = /(?:\bfrom\s*|\bimport\s*\(|require(?:\.resolve)?\s*\(\s*)['"]([^'"]+)['"]/g;

function bareSpecifier(specifier) {
  if (!specifier) return null;
  if (specifier.startsWith('.')) return null;
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0];
}

function collectImportedBareSpecifiers(files) {
  const found = new Set();
  for (const file of files) {
    let src;
    try { src = readFileSync(file, 'utf-8'); } catch { continue; }
    for (const match of src.matchAll(IMPORT_SPECIFIER_RE)) {
      const bare = bareSpecifier(match[1]);
      if (bare) found.add(bare);
    }
  }
  return found;
}

// Resolve only declared dependencies actually imported by lib/, scripts/, and
// tests/unit/; error on declared-but-unimported dependencies so an unused dep
// can never silently return to the manifest.
function validateDeps(pkg) {
  if (!pkg) return;
  const require = createRequire(resolve(SKILL_DIR, 'package.json'));
  const files = [
    ...collectMjs(resolve(SKILL_DIR, 'lib')),
    ...collectMjs(resolve(SKILL_DIR, 'scripts')),
    ...collectMjs(resolve(SKILL_DIR, join('tests', 'unit')))
  ];
  const imported = collectImportedBareSpecifiers(files);
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    if (!imported.has(dep)) {
      err(`dependency "${dep}" declared but never imported (remove it or wire it up)`);
      continue;
    }
    try {
      require.resolve(dep);
    } catch {
      err(`dependency "${dep}" not resolvable (run pnpm install)`);
    }
  }
}

function collectMjs(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...collectMjs(p));
    else if (ent.isFile() && ent.name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

// Syntax-check every lib/ and scripts/ module plus the unit test layer.
// tests/e2e.mjs and tests/serve.mjs are intentionally NOT swept here (owned
// and checked concurrently by a separate task).
function validateSyntax() {
  const files = [];
  for (const sub of ['lib', 'scripts', join('tests', 'unit')]) {
    files.push(...collectMjs(resolve(SKILL_DIR, sub)));
  }
  if (files.length === 0) {
    err('no .mjs files found under lib/, scripts/, tests/unit/');
    return;
  }
  for (const f of files) {
    const res = spawnSync(process.execPath, ['--check', f], { encoding: 'utf-8' });
    if (res.status !== 0) {
      const detail = (res.stderr || '').split('\n').filter(Boolean)[0] ?? '';
      err(`node --check failed: ${relative(SKILL_DIR, f)}: ${detail}`);
    }
  }
}

const REQUIRED_FIXTURES = ['animated.html', 'login.html', 'page1.html', 'page2.html', 'wall.html'];

function validateFixtures() {
  for (const name of REQUIRED_FIXTURES) {
    if (!existsSync(resolve(SKILL_DIR, 'tests', 'fixtures', name))) {
      err(`tests/fixtures/${name} missing`);
    }
  }
}

const content = loadSkillMd();
if (content !== null) {
  validateFrontmatter(content);
}
const pkg = loadPackageJson();
validateDeps(pkg);
validateSyntax();
validateFixtures();

if (errors.length > 0) {
  for (const e of errors) {
    console.error(`FAIL: ${e}`);
  }
  process.exit(1);
}

console.log('PASS: skill check ok');
process.exit(0);
