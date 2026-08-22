#!/usr/bin/env node
"use strict";

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
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

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bootstrapDir = join(root, "bootstrap");
const packageDir = join(bootstrapDir, "package");
const fixedTime = new Date("2026-08-18T00:00:00.000Z");
const skillDirs = [
  "csm-bdd-tdd",
  "csm-browse",
  "csm-build",
  "csm-deep-research",
  "csm-make-tests",
  "csm-grill",
  "csm-plan",
  "csm-review",
  "csm-scan",
  "csm-upload",
];

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
      src: join("csm-upload", "scripts", "upload.mjs"),
      dest: join("payload", "skills", "csm-upload", "scripts", "upload.mjs"),
    },
  ],
  helperBins: [],
  metadata: [{ src: "LICENSE", dest: "LICENSE" }],
};

const decisions = [
  "csm-browse runtime closure excluded: chrome-remote-interface and jimp are external dependencies; the skill ships as SKILL.md guidance only and its dependency setup remains a separate documented step",
  "csm-scan scripts plus the lib/scan closure and csm-upload scripts are bundled as supporting files: dependency-free node built-ins code",
  "helperBins ships empty in 0.1.0: optional runtime helpers stay out until each has a dependency-free closure",
  "package.json and payload-index.json are not indexed: the manifest is audit-checked and the index cannot contain its own digest; both are bound by the recorded tarball shasum",
];

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const modeOf = (mode) => (mode & 0o777).toString(8).padStart(4, "0");
const toPosix = (value) => value.split(sep).join("/");
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

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

async function entryFor(dest) {
  const target = join(packageDir, dest);
  const [data, info] = await Promise.all([readFile(target), stat(target)]);
  return { path: toPosix(dest), sha256: sha256(data), bytes: data.length, mode: modeOf(info.mode) };
}

async function buildIndex(entries) {
  // L20: the manifest is the single version source — a hand-synced literal
  // here used to drift from bootstrap/package.json until tests caught it.
  const pkgManifest = JSON.parse(await readFile(join(bootstrapDir, "package.json"), "utf8"));
  const classes = { skills: [], supportingFiles: [], helperBins: [], metadata: [] };
  for (const className of Object.keys(classes)) {
    classes[className] = (
      await Promise.all(
        entries
          .filter((entry) => entry.className === className)
          .map((entry) => entryFor(entry.dest)),
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
    fixedBin: await entryFor(join("bin", "csm-skills-bootstrap.js")),
    classes,
  };
  await writeFile(join(bootstrapDir, "payload-index.json"), `${JSON.stringify(index, null, 2)}\n`);
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

async function syncPayload() {
  const entries = await expandMapping();
  await mkdir(packageDir, { recursive: true });
  for (const entry of entries) {
    await mkdir(dirname(join(packageDir, entry.dest)), { recursive: true });
    await copyFile(join(root, entry.src), join(packageDir, entry.dest));
    await chmod(join(packageDir, entry.dest), 0o644);
  }
  const desired = new Set([
    ...entries.map((entry) => entry.dest),
    join("bin", "csm-skills-bootstrap.js"),
  ]);
  for (const rel of await walk(packageDir))
    if (!desired.has(rel)) await rm(join(packageDir, rel), { force: true });
  await pruneEmptyDirs(packageDir);
  await chmod(join(packageDir, "bin", "csm-skills-bootstrap.js"), 0o755);
  return buildIndex(entries);
}

async function copyTree(src, dest) {
  for (const rel of await walk(src)) {
    await mkdir(dirname(join(dest, rel)), { recursive: true });
    await copyFile(join(src, rel), join(dest, rel));
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

async function packBootstrap() {
  await syncPayload();
  const dir = await mkdtemp("/tmp/csm-pack-");
  const cache = await mkdtemp("/tmp/csm-pack-cache-");
  try {
    await copyFile(join(bootstrapDir, "package.json"), join(dir, "package.json"));
    await copyFile(join(bootstrapDir, "payload-index.json"), join(dir, "payload-index.json"));
    await copyTree(packageDir, dir);
    await fixTimes(dir);
    const { stdout } = await execFileAsync("npm", ["pack", "--json"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, NPM_CONFIG_CACHE: cache },
    });
    const filename = JSON.parse(stdout.slice(stdout.indexOf("["), stdout.lastIndexOf("]") + 1))[0]
      .filename;
    const tarball = join(dir, filename);
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

async function main() {
  const { dir, tarball, sha256: pkgSha256, bytes, entries } = await packBootstrap();
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

export { mapping, decisions, parseTar, packBootstrap, syncPayload, walk };
