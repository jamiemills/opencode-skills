#!/usr/bin/env node
"use strict";

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { O_CREAT, O_NOFOLLOW, O_RDONLY, O_TRUNC, O_WRONLY } from "node:constants";
import {
  chmod,
  mkdir,
  mkdtemp,
  lstat,
  open,
  readdir,
  readFile,
  rm,
  rmdir,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import skillManifest from "../bootstrap/skill-manifest.json" with { type: "json" };

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bootstrapDir = join(root, "bootstrap");
const fixedTime = new Date("2026-08-18T00:00:00.000Z");
const skillDirs = skillManifest.skills;

function assertSkillManifest() {
  if (
    skillManifest.schema !== "csm-skill-manifest/1" ||
    skillManifest.version !== 1 ||
    skillManifest.contentDigest !== "sha256" ||
    !skillManifest.compatibility ||
    !skillManifest.permissions ||
    !skillManifest.entrypoints ||
    !skillManifest.eval ||
    !skillManifest.trace ||
    new Set(skillManifest.skills).size !== skillManifest.skills.length
  )
    throw new Error("skill manifest is malformed");
  return true;
}

assertSkillManifest();

const mapping = {
  skills: skillDirs.map((name) => ({
    src: join(name, "SKILL.md"),
    dest: join("payload", "skills", name, "SKILL.md"),
  })),
  supportingFiles: [
    {
      src: join("csm-scan", "scripts", "scan.mjs"),
      dest: join("payload", "skills", "csm-scan", "scripts", "scan.mjs"),
    },
    {
      srcDir: join("csm-scan", "lib", "scan"),
      destDir: join("payload", "skills", "csm-scan", "lib", "scan"),
    },
    {
      srcDir: join("csm-scan", "schemas"),
      destDir: join("payload", "skills", "csm-scan", "schemas"),
    },
    {
      src: join("csm-ddd", "scripts", "ddd.mjs"),
      dest: join("payload", "skills", "csm-ddd", "scripts", "ddd.mjs"),
    },
    {
      srcDir: join("csm-ddd", "lib", "ddd"),
      destDir: join("payload", "skills", "csm-ddd", "lib", "ddd"),
    },
    {
      srcDir: join("csm-ddd", "schemas"),
      destDir: join("payload", "skills", "csm-ddd", "schemas"),
    },
    {
      src: join("csm-upload", "scripts", "upload.mjs"),
      dest: join("payload", "skills", "csm-upload", "scripts", "upload.mjs"),
    },
    {
      srcDir: join("csm-make-tests", "references"),
      destDir: join("payload", "skills", "csm-make-tests", "references"),
    },
    {
      srcDir: join("csm-review-python", "artifact"),
      destDir: join("payload", "skills", "csm-review-python", "artifact"),
    },
    {
      srcDir: join("csm-autoresearch", "lib"),
      destDir: join("payload", "skills", "csm-autoresearch", "lib"),
    },
    {
      srcDir: join("csm-autoresearch", "schemas"),
      destDir: join("payload", "skills", "csm-autoresearch", "schemas"),
    },
    {
      src: join("csm-autoresearch", "scripts", "evaluate.mjs"),
      dest: join("payload", "skills", "csm-autoresearch", "scripts", "evaluate.mjs"),
    },
  ],
  helperBins: [],
  metadata: [
    { src: "LICENSE", dest: "LICENSE" },
    { srcDir: "schemas", destDir: join("payload", "schemas") },
    { srcDir: join("lib", "schema-runtime"), destDir: join("payload", "lib", "schema-runtime") },
    {
      srcDir: join("lib", "compatibility-runtime"),
      destDir: join("payload", "lib", "compatibility-runtime"),
    },
  ],
};

const decisions = [
  "csm-browse runtime closure excluded: chrome-remote-interface and jimp are external dependencies; the skill ships as SKILL.md guidance only and its dependency setup remains a separate documented step",
  "csm-scan scripts plus the lib/scan closure and csm-upload scripts are bundled as supporting files: dependency-free node built-ins code",
  "helperBins ships empty in 0.1.0: optional runtime helpers stay out until each has a dependency-free closure",
  "csm-make-tests references/ bundled as supporting files: dependency-free markdown depth files loaded on demand by the skill",
  "csm-autoresearch lib/schemas/evaluator helper bundled as dependency-free supporting files; generated sandbox and live provider capabilities remain gated",
  "package.json and payload-index.json are not indexed: the manifest is audit-checked and the index cannot contain its own digest; both are bound by the recorded tarball shasum",
];

const FIXTURE_KEY_FINGERPRINT = "b37f525affc870505af1b92034ab44837d06372b6bea27cc24aed14d09d40209";
const FIXTURE_KEY_DER = "MCowBQYDK2VwAyEATcWR27WU2b6rIfJuqGlgPt89KHz5OX6tSibHg8wn/48=";

function validateReleaseKeyring(keyring) {
  const fixtureKey = keyring?.keys?.some(
    (key) =>
      (typeof key.id === "string" && /fixture/i.test(key.id)) ||
      key.fingerprint === FIXTURE_KEY_FINGERPRINT ||
      key.public_key_der_base64 === FIXTURE_KEY_DER,
  );
  if (
    keyring?.production_use !== true ||
    keyring?.environment === "test-fixture-only" ||
    fixtureKey
  ) {
    const error = new Error(
      "release pack refused: bootstrap/keyring.json is non-production or contains fixture markers",
    );
    error.code = "RELEASE_KEYRING";
    throw error;
  }
  return true;
}

async function assertReleaseKeyring() {
  const keyring = JSON.parse(await readFile(join(bootstrapDir, "keyring.json"), "utf8"));
  validateReleaseKeyring(keyring);
}

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const modeOf = (mode) => (mode & 0o777).toString(8).padStart(4, "0");
const toPosix = (value) => value.split(sep).join("/");
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

async function assertNoSymlinkPath(path, label = "destination") {
  const absolute = resolve(path);
  let current = sep;
  for (const component of absolute.split(sep).filter(Boolean)) {
    current = join(current, component);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error(`pack refused: symlinked ${label} path component: ${current}`);
    } catch (err) {
      if (err?.code === "ENOENT") return true;
      throw err;
    }
  }
  return true;
}

async function walk(dir, prefix = "") {
  const out = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).toSorted((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    const rel = prefix ? join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(join(dir, entry.name), rel)));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

async function expandMapping() {
  const entries = [];
  for (const [className, items] of Object.entries(mapping)) {
    for (const item of items) {
      if (item.srcDir) {
        for (const rel of await walk(join(root, item.srcDir)))
          entries.push({ className, src: join(item.srcDir, rel), dest: join(item.destDir, rel) });
      } else {
        entries.push({ className, src: item.src, dest: item.dest });
      }
    }
  }
  return entries;
}

async function entryFor(packageDir, dest) {
  const target = join(packageDir, dest);
  const [data, info] = await Promise.all([readFile(target), stat(target)]);
  return { path: toPosix(dest), sha256: sha256(data), bytes: data.length, mode: modeOf(info.mode) };
}

async function copyVerified(source, destination) {
  await assertNoSymlinkPath(destination);
  const sourceInfo = await lstat(source);
  if (!sourceInfo.isFile())
    throw new Error(`pack refused: source is not a regular file: ${source}`);
  const sourceHandle = await open(source, O_RDONLY | O_NOFOLLOW);
  try {
    const openedInfo = await sourceHandle.stat();
    if (openedInfo.dev !== sourceInfo.dev || openedInfo.ino !== sourceInfo.ino)
      throw new Error(`pack refused: source changed before copy: ${source}`);
    const data = await sourceHandle.readFile();
    const finalInfo = await sourceHandle.stat();
    if (
      finalInfo.dev !== openedInfo.dev ||
      finalInfo.ino !== openedInfo.ino ||
      finalInfo.size !== data.length
    )
      throw new Error(`pack refused: source changed during copy: ${source}`);

    const destinationHandle = await open(
      destination,
      O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW,
      0o644,
    );
    try {
      await destinationHandle.writeFile(data);
    } finally {
      await destinationHandle.close();
    }
    await assertNoSymlinkPath(destination);
    await chmod(destination, sourceInfo.mode & 0o777);
  } finally {
    await sourceHandle.close();
  }
}

async function buildIndex(entries, targetBootstrapDir, packageDir) {
  // L20: the manifest is the single version source — a hand-synced literal
  // here used to drift from bootstrap/package.json until tests caught it.
  const pkgManifest = JSON.parse(await readFile(join(targetBootstrapDir, "package.json"), "utf8"));
  const classes = { skills: [], supportingFiles: [], helperBins: [], metadata: [] };
  for (const className of Object.keys(classes)) {
    classes[className] = (
      await Promise.all(
        entries
          .filter((entry) => entry.className === className)
          .map((entry) => entryFor(packageDir, entry.dest)),
      )
    ).toSorted(byPath);
  }
  const index = {
    schema: "csm-payload-index/1",
    package: {
      name: pkgManifest.name,
      version: pkgManifest.version,
      bin: "csm-skills-bootstrap",
    },
    generatedBy: "scripts/pack-bootstrap.mjs",
    decisions,
    fixedBin: await entryFor(packageDir, join("bin", "csm-skills-bootstrap.js")),
    classes,
  };
  const indexPath = join(targetBootstrapDir, "payload-index.json");
  await assertNoSymlinkPath(indexPath);
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

async function pruneEmptyDirs(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      await pruneEmptyDirs(join(dir, entry.name));
      if ((await readdir(join(dir, entry.name))).length === 0) await rmdir(join(dir, entry.name));
    }
  }
}

async function verifyPayloadParity({ outputRoot = bootstrapDir } = {}) {
  const targetPackageDir = join(resolve(outputRoot), "package");
  const entries = await expandMapping();
  for (const entry of entries) {
    const source = await readFile(join(root, entry.src));
    const generated = await readFile(join(targetPackageDir, entry.dest));
    if (sha256(source) !== sha256(generated) || !source.equals(generated))
      throw new Error(`pack refused: generated payload mismatch: ${entry.dest}`);
  }
  return true;
}

async function syncPayload({ outputRoot = bootstrapDir } = {}) {
  const targetBootstrapDir = resolve(outputRoot);
  const packageDir = join(targetBootstrapDir, "package");
  await assertNoSymlinkPath(targetBootstrapDir, "output root");
  await assertNoSymlinkPath(packageDir, "destination");
  const entries = await expandMapping();
  await mkdir(packageDir, { recursive: true });
  for (const entry of entries) {
    const destination = join(packageDir, entry.dest);
    await assertNoSymlinkPath(dirname(destination), "destination");
    await mkdir(dirname(destination), { recursive: true });
    await copyVerified(join(root, entry.src), destination);
    await chmod(destination, 0o644);
  }
  const desired = new Set([
    ...entries.map((entry) => entry.dest),
    join("bin", "csm-skills-bootstrap.js"),
  ]);
  for (const rel of await walk(packageDir))
    if (!desired.has(rel)) await rm(join(packageDir, rel), { force: true });
  await pruneEmptyDirs(packageDir);
  const fixedBin = join(packageDir, "bin", "csm-skills-bootstrap.js");
  await assertNoSymlinkPath(fixedBin);
  await chmod(fixedBin, 0o755);
  const index = await buildIndex(entries, targetBootstrapDir, packageDir);
  await verifyPayloadParity({ outputRoot: targetBootstrapDir });
  return index;
}

async function copyTree(src, dest) {
  for (const rel of await walk(src)) {
    const destination = join(dest, rel);
    await assertNoSymlinkPath(dirname(destination), "destination");
    await mkdir(dirname(destination), { recursive: true });
    await copyVerified(join(src, rel), destination);
  }
}

async function fixDirTimes(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) await fixDirTimes(join(dir, entry.name));
  }
  await utimes(dir, fixedTime, fixedTime);
}

async function fixTimes(dir) {
  for (const rel of await walk(dir)) await utimes(join(dir, rel), fixedTime, fixedTime);
  await fixDirTimes(dir);
}

function parseTar(gzip) {
  const data = gunzipSync(gzip);
  const entries = [];
  let offset = 0;
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    const size =
      parseInt(header.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim() || "0", 8) ||
      0;
    const mode =
      parseInt(header.subarray(100, 108).toString("utf8").replace(/\0.*$/, "").trim() || "0", 8) ||
      0;
    const type = String.fromCharCode(header[156]);
    const fullName = prefix ? `${prefix}/${name}` : name;
    if (fullName) entries.push({ name: fullName, size, mode, type });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

async function packBootstrapOnce({ outputRoot = bootstrapDir } = {}) {
  const targetBootstrapDir = resolve(outputRoot);
  if (targetBootstrapDir === root)
    throw new Error("pack refused: output root cannot be the canonical source root");
  if (targetBootstrapDir !== bootstrapDir && targetBootstrapDir.startsWith(`${root}${sep}`))
    throw new Error(
      "pack refused: output root must be the canonical bootstrap directory or external to the canonical source root",
    );
  await assertNoSymlinkPath(targetBootstrapDir, "output root");
  const packageDir = join(targetBootstrapDir, "package");
  await mkdir(targetBootstrapDir, { recursive: true });
  if (targetBootstrapDir !== bootstrapDir) {
    await copyVerified(
      join(bootstrapDir, "package.json"),
      join(targetBootstrapDir, "package.json"),
    );
    await copyTree(join(bootstrapDir, "package", "bin"), join(packageDir, "bin"));
  }
  await syncPayload({ outputRoot: targetBootstrapDir });
  const dir = await mkdtemp("/tmp/csm-pack-");
  const cache = await mkdtemp("/tmp/csm-pack-cache-");
  try {
    await copyVerified(join(targetBootstrapDir, "package.json"), join(dir, "package.json"));
    await copyVerified(
      join(targetBootstrapDir, "payload-index.json"),
      join(dir, "payload-index.json"),
    );
    await copyTree(packageDir, dir);
    await fixTimes(dir);
    const { stdout } = await execFileAsync("npm", ["pack", "--json"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, NPM_CONFIG_CACHE: cache },
    });
    const filename = JSON.parse(stdout.slice(stdout.indexOf("["), stdout.lastIndexOf("]") + 1))[0]
      .filename;
    const tarball = resolvePackTarball(dir, filename);
    const data = await readFile(tarball);
    return { dir, tarball, sha256: sha256(data), bytes: data.length, entries: parseTar(data) };
  } catch (err) {
    // F-065-e: never leak an unowned copy of the payload in /tmp on a failed
    // pack. The staging dir is the documented success-path return value, but
    // on failure it holds nothing worth keeping — remove it before rethrowing
    // (guarded so a cleanup error cannot mask the original failure).
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  } finally {
    await rm(cache, { recursive: true, force: true }).catch(() => {});
  }
}

function resolvePackTarball(stagingDir, filename) {
  if (typeof filename !== "string" || filename.length === 0)
    throw new Error("pack refused: npm returned no tarball filename");
  const staging = resolve(stagingDir);
  const tarball = resolve(staging, filename);
  if (!tarball.startsWith(`${staging}${sep}`))
    throw new Error("pack refused: tarball filename escapes staging directory");
  return tarball;
}

// Packing regenerates the shared committed payload/index before staging. Keep
// concurrent callers from observing one another's partially regenerated state.
let packQueue = Promise.resolve();
function packBootstrap(options = {}) {
  const run = packQueue.then(
    () => packBootstrapOnce(options),
    () => packBootstrapOnce(options),
  );
  packQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function main() {
  if (process.argv.includes("--release")) await assertReleaseKeyring();
  const outputArg = process.argv.find((arg) => arg.startsWith("--output-root="));
  const outputRoot = outputArg ? outputArg.slice("--output-root=".length) : bootstrapDir;
  const { dir, tarball, sha256: pkgSha256, bytes, entries } = await packBootstrap({ outputRoot });
  const files = entries.filter((entry) => entry.type === "0" || entry.type === "\0");
  console.log(`tarball: ${tarball}`);
  console.log(`sha256: ${pkgSha256}`);
  console.log(`bytes: ${bytes}`);
  console.log(`files: ${files.length}`);
  console.log(`workdir: ${dir}`);
}

let isMain = false;
if (process.argv[1]) {
  try {
    const self = realpathSync(fileURLToPath(import.meta.url));
    const invoked = realpathSync(resolve(process.argv[1]));
    isMain = self === invoked;
  } catch {
    isMain = false;
  }
}
if (isMain) await main();

export {
  assertReleaseKeyring,
  copyVerified,
  decisions,
  expandMapping,
  mapping,
  packBootstrap,
  parseTar,
  resolvePackTarball,
  syncPayload,
  verifyPayloadParity,
  skillManifest,
  validateReleaseKeyring,
  walk,
};
