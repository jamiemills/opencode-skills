#!/usr/bin/env node
"use strict";

// Template-preserving capabilities digest regenerator (parallelism T010).
//
// csm-orchestrate/capabilities.json carries rich per-skill fields
// (activation predicates, input/output contracts, approval classes, ...) that
// are NOT derivable from SKILL.md bytes. This tool therefore treats the
// committed manifest as a TEMPLATE and recomputes only the byte-derived
// digests: `digest` = sha256 over the SKILL.md at each entry's
// source.skillPath (mirroring csm-orchestrate/lib/capabilities.mjs) and
// `contentDigest` = schema-runtime digest over manifest.skills (the same
// helper capabilities.mjs validates against). Key order, 2-space indent and
// the trailing newline are preserved so an unchanged run is BYTE-IDENTICAL
// (a no-op diff). Never hand-edit capabilities.json while this generator
// exists.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import { digest } from "../lib/schema-runtime/index.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const MANIFEST_PATH = join(root, "csm-orchestrate", "capabilities.json");

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

// The committed manifest is oxfmt-canonical (short arrays/objects inline); a
// plain JSON.stringify renders every array element on its own line and would
// reformat the whole file on every regen. Normalize generated text through the
// repo's own oxfmt config so an unchanged run stays byte-identical. Falls back
// to the raw text when oxfmt is unavailable (e.g. no node_modules).
async function oxfmtCanonicalText(text, sourceRoot) {
  const oxfmt = join(sourceRoot, "node_modules", ".bin", "oxfmt");
  try {
    realpathSync(oxfmt);
  } catch {
    return { text, normalized: false };
  }
  const directory = await mkdtemp(join(tmpdir(), "gen-capabilities-"));
  const temp = join(directory, "capabilities.json");
  try {
    await writeFile(temp, text);
    execFileSync(oxfmt, [`--config=${join(sourceRoot, ".oxfmtrc.json")}`, "--write", temp], {
      stdio: "ignore",
    });
    return { text: await readFile(temp, "utf8"), normalized: true };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// Recomputes skill digests + contentDigest from the template manifest without
// writing. Returns { manifest, text, changedDigests, warnings }. Throws when
// the regenerated manifest fails the capabilities.mjs validation rules, so
// generator output can never drift from what the loader accepts.
export async function buildCapabilities({ rootOverride } = {}) {
  const sourceRoot = rootOverride ?? root;
  const manifest = JSON.parse(
    await readFile(join(sourceRoot, "csm-orchestrate", "capabilities.json"), "utf8"),
  );
  const warnings = [];
  const changedDigests = [];
  for (const capability of manifest.skills) {
    const { skillPath } = capability.source;
    if (typeof skillPath !== "string" || skillPath.length < 1)
      throw new Error(`gen-capabilities: ${capability.skill} has no source.skillPath`);
    const bytes = await readFile(join(sourceRoot, skillPath));
    const recomputed = sha256(bytes);
    if (capability.digest !== recomputed)
      changedDigests.push({ skill: capability.skill, from: capability.digest, to: recomputed });
    capability.digest = recomputed;
    if (capability.source.entrypoint || capability.source.libraryDigest) {
      warnings.push(
        `${capability.skill} carries source.entrypoint/libraryDigest fields the template generator cannot derive — executable digests must be updated by hand and stay consistent with capabilities.mjs validation`,
      );
    }
  }
  const previousContentDigest = manifest.contentDigest;
  manifest.contentDigest = digest(manifest.skills);
  if (manifest.contentDigest !== previousContentDigest)
    changedDigests.push({
      skill: "(contentDigest)",
      from: previousContentDigest,
      to: manifest.contentDigest,
    });
  const validated = await validateCapabilities(manifest, { verifySources: true });
  const { text, normalized } = await oxfmtCanonicalText(
    `${JSON.stringify(validated, null, 2)}\n`,
    sourceRoot,
  );
  if (!normalized)
    console.error(
      "gen-capabilities: WARNING oxfmt unavailable — output may not be byte-identical with the committed manifest",
    );
  return { manifest: validated, text, changedDigests, warnings };
}

async function main() {
  const { text, changedDigests, warnings } = await buildCapabilities();
  await writeFile(MANIFEST_PATH, text);
  for (const warning of warnings) console.error(`gen-capabilities: WARNING ${warning}`);
  if (changedDigests.length === 0)
    console.log("gen-capabilities: no digest changes (byte-identical template run)");
  for (const change of changedDigests)
    console.log(`gen-capabilities: ${change.skill}: ${change.from} -> ${change.to}`);
  console.log(`gen-capabilities: wrote ${MANIFEST_PATH}`);
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
