import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const grammar = JSON.parse(await readFile(join(root, 'bootstrap', 'runtime-commands.json'), 'utf8'));
const dummyRegistry = 'http://127.0.0.1:9';
const sandboxPrefix = '/tmp/csm-offline-';
const manifestFields = ['schema', 'node', 'npm', 'platform', 'package', 'dependencyClosure', 'verification'];
const packageFields = ['name', 'version', 'integrity', 'bytes'];
const verificationFields = ['checkedAt', 'ok'];
const versionRe = /^\d+\.\d+\.\d+$/;
const platformRe = /^[a-z0-9]+-[a-z0-9]+$/;
const integrityRe = /^[a-f0-9]{64}$/;
const checkedAtRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const rangeCharRe = /[\^~><|]|\s/;
const wildcardRe = /(^|\.)(x|X|\*)(\.|$)/;
const exactVersionRe = /^\d+\.\d+\.\d+$/;

const sha256 = data => createHash('sha256').update(data).digest('hex');

function classifySpec(spec) {
  if (spec === grammar.package.spec) return null;
  if (/^git[+:]/.test(spec) || spec.startsWith('github:') || spec.includes('#semver:')) return 'git';
  if (/^https?:\/\//.test(spec)) return 'url';
  if (spec.startsWith('file:')) return 'file';
  if (rangeCharRe.test(spec) || wildcardRe.test(spec)) return 'range';
  const at = spec.lastIndexOf('@');
  const name = at > 0 ? spec.slice(0, at) : spec;
  const version = at > 0 ? spec.slice(at + 1) : null;
  if (version === null) return name === grammar.package.name ? 'missing-version' : 'wrong-package';
  if (name !== grammar.package.name) return 'wrong-package';
  if (!exactVersionRe.test(version)) return 'dist-tag';
  return 'version-mismatch';
}

function checkSpec(spec) {
  if (typeof spec !== 'string' || spec === '') return { ok: false, reason: 'spec-type' };
  const reason = classifySpec(spec);
  return reason === null ? { ok: true, reason: null } : { ok: false, reason };
}

const shellMetacharRe = /[;&|<>`"'$(){}[\]*?~\n]/;
const allowedSubcommands = [...Object.keys(grammar.subcommands), '--help'];

function checkArgv(argv, { offline = false } = {}) {
  if (!Array.isArray(argv) || argv.length === 0 || argv.some(part => typeof part !== 'string')) return { ok: false, reason: 'argv-type' };
  for (const part of argv) if (shellMetacharRe.test(part)) return { ok: false, reason: 'shell', detail: part };
  const allowed = new Set([grammar.executor, ...grammar.requiredFlags, ...(offline ? grammar.offlineFlags : []), grammar.package.bin, ...allowedSubcommands]);
  let packageSeen = false;
  let binSeen = false;
  for (const part of argv) {
    if (part.startsWith('--package=')) {
      const spec = part.slice('--package='.length);
      const specResult = checkSpec(spec);
      if (!specResult.ok) return { ok: false, reason: specResult.reason, detail: part };
      if (packageSeen) return { ok: false, reason: 'extra-flags', detail: part };
      packageSeen = true;
      continue;
    }
    if (part === grammar.package.bin) {
      if (binSeen) return { ok: false, reason: 'extra-flags', detail: part };
      binSeen = true;
      continue;
    }
    if (!allowed.has(part)) return { ok: false, reason: 'extra-flags', detail: part };
    if (!offline && grammar.offlineFlags.includes(part)) return { ok: false, reason: 'extra-flags', detail: part };
  }
  for (const flag of grammar.requiredFlags) if (!argv.includes(flag)) return { ok: false, reason: 'extra-flags', detail: `missing ${flag}` };
  if (offline) for (const flag of grammar.offlineFlags) if (!argv.includes(flag)) return { ok: false, reason: 'extra-flags', detail: `missing ${flag}` };
  if (!packageSeen) return { ok: false, reason: 'extra-flags', detail: 'missing --package=<spec>' };
  if (!binSeen) return { ok: false, reason: 'missing-bin' };
  return { ok: true, reason: null };
}

async function hashTree(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries.toSorted((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await hashTree(join(dir, entry.name), rel)));
    else if (entry.isFile()) out.push([rel, sha256(await readFile(join(dir, entry.name)))]);
  }
  return out;
}

const keysOf = value => (value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : null);

function verifyCacheManifest(manifest, tarballData, { expectedToolchain } = {}) {
  if (!Buffer.isBuffer(tarballData) && !(tarballData instanceof Uint8Array)) return { ok: false, errors: ['tarballData: expected bytes'] };
  const errors = [];
  const push = message => errors.push(message);
  const manifestKeys = keysOf(manifest);
  if (manifestKeys === null) return { ok: false, errors: ['manifest: expected an object'] };
  for (const key of manifestKeys) if (!manifestFields.includes(key)) push(`manifest: unexpected property "${key}"`);
  for (const key of manifestFields) if (!Object.hasOwn(manifest, key)) push(`manifest: missing required property "${key}"`);
  if (manifest.schema !== 'csm-cache-manifest/1') push('schema: expected const "csm-cache-manifest/1"');
  for (const key of ['node', 'npm']) {
    if (typeof manifest[key] !== 'string' || !versionRe.test(manifest[key])) push(`${key}: expected an x.y.z version string`);
  }
  if (typeof manifest.platform !== 'string' || !platformRe.test(manifest.platform)) push('platform: expected a platform-arch string');
  if (expectedToolchain !== undefined && expectedToolchain !== null) {
    for (const key of ['node', 'npm', 'platform']) {
      if (Object.hasOwn(expectedToolchain, key) && manifest[key] !== expectedToolchain[key]) push(`${key}: does not match the recorded toolchain (${expectedToolchain[key]})`);
    }
  }
  const pkg = manifest.package;
  const pkgKeys = keysOf(pkg);
  if (pkgKeys === null) {
    push('package: expected an object');
  } else {
    for (const key of pkgKeys) if (!packageFields.includes(key)) push(`package: unexpected property "${key}"`);
    for (const key of packageFields) if (!Object.hasOwn(pkg, key)) push(`package: missing required property "${key}"`);
    if (pkg.name !== grammar.package.name) push(`package.name: expected "${grammar.package.name}"`);
    if (pkg.version !== grammar.package.version) push(`package.version: expected "${grammar.package.version}"`);
    if (typeof pkg.integrity !== 'string' || !integrityRe.test(pkg.integrity)) push('package.integrity: expected a sha256 hex digest');
    if (!Number.isInteger(pkg.bytes) || pkg.bytes < 1) push('package.bytes: expected a positive integer');
    if (typeof pkg.integrity === 'string' && integrityRe.test(pkg.integrity) && pkg.integrity !== sha256(tarballData)) push('package.integrity: does not match the tarball sha256');
    if (Number.isInteger(pkg.bytes) && pkg.bytes >= 1 && pkg.bytes !== tarballData.length) push('package.bytes: does not match the tarball size');
  }
  if (!Array.isArray(manifest.dependencyClosure)) push('dependencyClosure: expected an array');
  else if (manifest.dependencyClosure.length !== 0) push('dependencyClosure: must be empty for this package');
  const verification = manifest.verification;
  const verificationKeys = keysOf(verification);
  if (verificationKeys === null) {
    push('verification: expected an object');
  } else {
    for (const key of verificationKeys) if (!verificationFields.includes(key)) push(`verification: unexpected property "${key}"`);
    for (const key of verificationFields) if (!Object.hasOwn(verification, key)) push(`verification: missing required property "${key}"`);
    if (typeof verification.checkedAt !== 'string' || !checkedAtRe.test(verification.checkedAt)) push('verification.checkedAt: expected an ISO-8601 UTC timestamp');
    if (verification.ok !== true) push('verification.ok: expected true');
  }
  return { ok: errors.length === 0, errors };
}

async function makeSandbox() {
  const dir = await mkdtemp(sandboxPrefix);
  await chmod(dir, 0o700);
  const paths = {};
  for (const name of ['home', 'cache', 'tmp', 'cwd']) {
    paths[name] = join(dir, name);
    await mkdir(paths[name], { mode: 0o700 });
  }
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^npm_config_/i.test(key)) env[key] = value;
  }
  env.HOME = paths.home;
  env.NPM_CONFIG_CACHE = paths.cache;
  env.NPM_CONFIG_REGISTRY = dummyRegistry;
  env.npm_config_registry = dummyRegistry;
  env.TMPDIR = paths.tmp;
  return { dir, env, cwd: paths.cwd, cache: paths.cache };
}

function runNpx(sandbox, args) {
  return execFileAsync('npx', args, { cwd: sandbox.cwd, encoding: 'utf8', env: sandbox.env, timeout: 120000 });
}

async function npmVersion(sandbox) {
  const { stdout } = await execFileAsync('npm', ['--version'], { cwd: sandbox.cwd, encoding: 'utf8', env: sandbox.env });
  return stdout.trim();
}

export { checkArgv, checkSpec, grammar, hashTree, makeSandbox, npmVersion, runNpx, verifyCacheManifest };
