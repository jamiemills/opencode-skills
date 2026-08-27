import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve } from "node:path";
import test from "node:test";
import { expandMapping, packBootstrap, payloadData } from "../scripts/pack-bootstrap.mjs";

const root = resolve(import.meta.dirname, "..");
const localImport =
  /^\s*(?:import\s+(?:[^"']+?\s+from\s+|)|export\s+[^"']+?\s+from\s+)(["'])([^"']+)\1/gm;
const dynamicImport = /\bimport\(\s*(["'])([^"']+)\1\s*\)/g;
const builtin = /^(?:node:|data:|https?:)/;

async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

function resolveLocalImport(from, specifier) {
  if (!specifier.startsWith(".")) return null;
  const target = resolve(dirname(from), specifier);
  return extname(target) ? target : `${target}.mjs`;
}

test("generated payload has a closed local import graph and reachable registry schemas", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "csm-bootstrap-closure-"));
  try {
    await packBootstrap({ outputRoot });
    const payload = join(outputRoot, "package", "payload");
    const files = await walk(payload);
    const modules = files.filter((file) => file.endsWith(".mjs"));
    assert.ok(modules.length > 0);
    for (const file of modules) {
      const source = await readFile(file, "utf8");
      const scanSource = source.replace(/^\s*\/\/.*$/gm, "");
      for (const [, , specifier] of [
        ...scanSource.matchAll(localImport),
        ...scanSource.matchAll(dynamicImport),
      ]) {
        if (builtin.test(specifier) || !specifier.startsWith(".")) continue;
        const target = resolveLocalImport(file, specifier);
        assert.ok(target, `${relative(payload, file)} has unsupported import ${specifier}`);
        assert.ok(files.includes(target), `${relative(payload, file)} -> ${specifier} is unmapped`);
      }
    }

    const registry = JSON.parse(await readFile(join(payload, "schemas/registry.json"), "utf8"));
    for (const entry of registry.entries) {
      const candidates = [
        resolve(payload, entry.schemaPath),
        resolve(payload, "skills", entry.schemaPath),
      ];
      assert.ok(
        candidates.some((schema) => files.includes(schema)),
        `registry schema closure missing: ${entry.id}`,
      );
    }
    for (const entry of [
      "lib/artifact-resolver/index.mjs",
      "lib/consumer-adapters/index.mjs",
      "lib/digest-taxonomy/index.mjs",
      "lib/durable-json/index.mjs",
      "lib/publication/index.mjs",
      "lib/schema-runtime/index.mjs",
    ]) {
      assert.ok(files.includes(join(payload, entry)), `shared runtime missing: ${entry}`);
    }
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("generated entrypoints import in isolation without mutating canonical files", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "csm-bootstrap-imports-"));
  const before = new Map();
  try {
    for (const entry of await expandMapping()) {
      if (entry.dest.endsWith(".mjs")) before.set(entry.src, await readFile(join(root, entry.src)));
    }
    await packBootstrap({ outputRoot });
    const payload = join(outputRoot, "package", "payload");
    const nodeModules = join(root, "node_modules");
    await symlink(nodeModules, join(outputRoot, "node_modules"), "junction");
    const entrypoints = [
      "lib/artifact-resolver/index.mjs",
      "lib/consumer-adapters/index.mjs",
      "lib/digest-taxonomy/index.mjs",
      "lib/durable-json/index.mjs",
      "lib/publication/index.mjs",
      "lib/schema-runtime/index.mjs",
      "skills/csm-build/lib/state.mjs",
      "skills/csm-ddd/lib/ddd/pipeline.mjs",
      "skills/csm-grill/lib/approach.mjs",
      "skills/csm-make-tests/lib/ledger.mjs",
      "skills/csm-orchestrate/index.mjs",
      "skills/csm-orchestrate/lib/capabilities.mjs",
      "skills/csm-plan/lib/plan.mjs",
      "skills/csm-upload/lib/publication.mjs",
    ];
    for (const entry of entrypoints) await import(`${join(payload, entry)}?closure-test`);
    const capabilities = JSON.parse(
      await readFile(join(payload, "skills/csm-orchestrate/capabilities.json"), "utf8"),
    );
    assert.equal(capabilities.coordinator.entrypoint, "csm-orchestrate/index.mjs");
    for (const [source, bytes] of before)
      assert.deepEqual(
        await readFile(join(root, source)),
        bytes,
        `canonical source mutated: ${source}`,
      );
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("payload rewriting only changes local import specifiers", () => {
  const source = Buffer.from(
    [
      'import { digest } from "../../lib/schema-runtime/index.mjs";',
      'const documentation = "../../lib/not-an-import.mjs";',
      'export { digest } from "../../lib/schema-runtime/index.mjs";',
    ].join("\n"),
  );
  const rewritten = payloadData(source, "payload/skills/csm-orchestrate/lib/index.mjs").toString();
  assert.match(rewritten, /from "\.\.\/\.\.\/\.\.\/lib\/schema-runtime/);
  assert.match(rewritten, /"\.\.\/\.\.\/lib\/not-an-import\.mjs"/);
});

test("canonical mappings and generated payload index have identical path sets", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "csm-bootstrap-index-"));
  try {
    const result = await packBootstrap({ outputRoot });
    const index = JSON.parse(await readFile(join(outputRoot, "payload-index.json"), "utf8"));
    const indexed = new Set(
      [...Object.values(index.classes).flat(), index.fixedBin].map((entry) => entry.path),
    );
    assert.deepEqual(
      new Set(result.entries.filter((entry) => entry.type === "0").map((entry) => entry.name)),
      new Set(["package.json", "payload-index.json", ...indexed].map((path) => `package/${path}`)),
    );
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});
