#!/usr/bin/env node
"use strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

// L22: glob every installed nvm v22 patch instead of pinning one — a routine
// security patch bump used to silently miss the preferred probe.
function nvmNodeCandidates() {
  const versionsDir = path.join(os.homedir(), ".nvm", "versions", "node");
  let entries = [];
  try {
    entries = fs.readdirSync(versionsDir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => /^v22\.\d+\.\d+$/.test(name))
    .toSorted((a, b) => b.localeCompare(a, "en", { numeric: true }))
    .map((name) => path.join(versionsDir, name, "bin"));
}

function majorVersion(bin) {
  const res = spawnSync(bin, ["--version"], { encoding: "utf8" });
  if (res.status !== 0 || !res.stdout) return 0;
  const m = /^v(\d+)\.(\d+)\.(\d+)/.exec(res.stdout.trim());
  return m ? Number(m[1]) : 0;
}

function resolve() {
  const candidates = [];
  for (const binDir of nvmNodeCandidates()) {
    candidates.push(path.join(binDir, "node"));
  }
  candidates.push(process.execPath);
  for (const bin of candidates) {
    const major = majorVersion(bin);
    if (major >= 22 && major < 25) return bin;
  }
  return null;
}

function fail() {
  process.stderr.write(
    "with-node22: no node >=22 <25 found. Install Node 22+ or export PATH=~/.nvm/versions/node/v22.x.y/bin:$PATH\n",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = args[0];

if (flag === "--print") {
  const bin = resolve();
  if (!bin) fail();
  process.stdout.write(bin + "\n");
  process.exit(0);
}

if (flag === "--exec") {
  const bin = resolve();
  if (!bin) fail();
  if (args.length < 2) {
    process.stderr.write("with-node22: --exec requires a command\n");
    process.exit(1);
  }
  const binDir = path.dirname(bin);
  const env = { ...process.env, PATH: binDir + path.delimiter + (process.env.PATH || "") };
  const res = spawnSync(args[1], args.slice(2), { stdio: "inherit", env });
  process.exit(res.status === null ? 1 : res.status);
}

process.stderr.write(
  "with-node22: usage: node scripts/with-node22.mjs --print | --exec <cmd...>\n",
);
process.exit(1);
