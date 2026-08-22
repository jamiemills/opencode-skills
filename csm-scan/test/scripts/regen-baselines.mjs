#!/usr/bin/env node
// Regenerate csm-scan deterministic baselines from live pipeline output.
//
// Recomputes the artifacts under test/baselines/expansion/ using the same
// helpers and fixed inputs the acceptance tests use, prints a diff summary,
// and writes only with an explicit --write flag.
//
// Usage:
//   node test/scripts/regen-baselines.mjs           # diff summary only
//   node test/scripts/regen-baselines.mjs --write   # rewrite changed artifacts

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { enrich } from "../../lib/scan/enrich.mjs";
import { validate } from "../../lib/scan/validate.mjs";
import { writeNORMS } from "../../lib/scan/write.mjs";
import { fixedInput } from "../helpers/expansion-shared.mjs";

const TEST_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASELINE_ROOT = join(TEST_ROOT, "baselines", "expansion");
const WRITE = process.argv.includes("--write");

async function renderFixed() {
  const { overview, deep } = fixedInput();
  const enriched = await enrich(deep, overview);
  const validated = await validate(enriched);
  const root = await mkdtemp(join(tmpdir(), "csm-scan-regen-render-"));
  try {
    return await writeNORMS(
      { generated: "2026-01-15", repos: [{ overview, deep: validated.findings }] },
      join(root, "NORMS.md"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

const artifacts = [
  {
    name: "renderer.md",
    recompute: async () => renderFixed(),
  },
];

let changes = 0;
for (const artifact of artifacts) {
  const target = join(BASELINE_ROOT, artifact.name);
  const current = await readFile(target, "utf8");
  const fresh = await artifact.recompute();
  if (current === fresh) {
    console.log(`ok       ${artifact.name} (${sha256(fresh).slice(0, 12)}…)`);
    continue;
  }
  changes += 1;
  const oldLines = current.split("\n").length;
  const newLines = fresh.split("\n").length;
  console.log(
    `drift    ${artifact.name}: ${oldLines} -> ${newLines} lines ` +
      `${sha256(current).slice(0, 12)}… -> ${sha256(fresh).slice(0, 12)}…`,
  );
  if (WRITE) {
    await writeFile(target, fresh);
    console.log(`written  ${artifact.name}`);
  }
}

if (changes === 0) {
  console.log("baselines clean");
} else if (!WRITE) {
  console.log(`${changes} artifact(s) drifted — rerun with --write to regenerate`);
} else {
  console.log(`${changes} artifact(s) regenerated`);
}
