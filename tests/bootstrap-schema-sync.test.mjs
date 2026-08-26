import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  expandMapping,
  packBootstrap,
  payloadData,
  verifyPayloadParity,
} from "../scripts/pack-bootstrap.mjs";

const root = join(import.meta.dirname, "..");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

test("foundation mapping generates byte-identical canonical/bootstrap files and indexed hashes", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "csm-bootstrap-sync-"));
  try {
    const result = await packBootstrap({ outputRoot });
    const entries = await expandMapping();
    const index = JSON.parse(await readFile(join(outputRoot, "payload-index.json"), "utf8"));
    const indexed = new Map(
      [...Object.values(index.classes).flat(), index.fixedBin].map((entry) => [entry.path, entry]),
    );
    assert.ok(result.entries.length > 0);
    for (const entry of entries.filter(
      ({ src }) => src.startsWith("schemas/") || src.startsWith("lib/"),
    )) {
      const canonical = payloadData(await readFile(join(root, entry.src)), entry.dest);
      const generated = await readFile(join(outputRoot, "package", entry.dest));
      const indexedEntry = indexed.get(entry.dest.replaceAll("\\", "/"));
      assert.deepEqual(generated, canonical, entry.dest);
      assert.equal(sha256(generated), indexedEntry?.sha256, entry.dest);
      assert.equal(generated.length, indexedEntry?.bytes, entry.dest);
    }
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("isolated packaging preserves the canonical bootstrap manifest and fixed binary", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "csm-bootstrap-input-parity-"));
  try {
    await packBootstrap({ outputRoot });
    for (const relativePath of ["package.json", "package/bin/csm-skills-bootstrap.js"]) {
      const canonical = await readFile(join(root, "bootstrap", relativePath));
      const generated = await readFile(join(outputRoot, relativePath));
      assert.deepEqual(generated, canonical, relativePath);
    }
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("parity verification fails closed on missing and mismatched generated files", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "csm-bootstrap-parity-"));
  try {
    await packBootstrap({ outputRoot });
    const entries = await expandMapping();
    const foundation = entries.find(({ src }) => src === "lib/schema-runtime/index.mjs");
    const generatedPath = join(outputRoot, "package", foundation.dest);
    await (await import("node:fs/promises")).writeFile(generatedPath, "tampered\n");
    await assert.rejects(verifyPayloadParity({ outputRoot }), /generated payload mismatch/);
    await rm(generatedPath);
    await assert.rejects(verifyPayloadParity({ outputRoot }), /ENOENT/);
    await stat(join(outputRoot, "package"));
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});
