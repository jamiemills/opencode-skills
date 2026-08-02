import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

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

function validatePackageJson() {
  const pkgPath = resolve(SKILL_DIR, 'package.json');
  if (!existsSync(pkgPath)) {
    err('package.json not found');
    return;
  }
  try {
    JSON.parse(readFileSync(pkgPath, 'utf-8'));
  } catch (e) {
    err(`package.json invalid JSON: ${e.message}`);
  }
}

function validateDep() {
  const require = createRequire(resolve(SKILL_DIR, 'package.json'));
  try {
    require.resolve('chrome-remote-interface');
  } catch {
    err('node_modules/chrome-remote-interface not resolvable (run npm install)');
  }
}

const content = loadSkillMd();
if (content !== null) {
  validateFrontmatter(content);
}
validatePackageJson();
validateDep();

if (errors.length > 0) {
  for (const e of errors) {
    console.error(`FAIL: ${e}`);
  }
  process.exit(1);
}

console.log('PASS: skill check ok');
process.exit(0);
