import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(join(root, "bootstrap", "skill-manifest.json"), "utf8"));

async function executableSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources = [];
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name === "tests") continue;
    if (entry.isDirectory()) sources.push(...(await executableSources(path)));
    else if (/\.(?:cjs|js|mjs)$/.test(entry.name)) sources.push(path);
  }
  return sources;
}

test("standalone progress has no invented runtime caller", async () => {
  assert.deepEqual(manifest.entrypoints, []);

  const orchestrator = await readFile(join(root, "csm-orchestrate", "lib", "index.mjs"), "utf8");
  assert.match(orchestrator, /export async function orchestrate\b/);
  assert.match(orchestrator, /invokeSiblingSkill/);
  assert.match(orchestrator, /progress/);

  const executableProgressImports = [];
  for (const skill of manifest.skills.filter((name) => name !== "csm-orchestrate")) {
    for (const path of await executableSources(join(root, skill))) {
      const source = await readFile(path, "utf8");
      if (
        /csm-progress\/1|(?:create|update|append).*Progress(?:Document|Tracker|Items)?/.test(source)
      ) {
        executableProgressImports.push(path);
      }
    }
  }
  assert.deepEqual(executableProgressImports, []);
});

test("orchestrator contract identifies the executable progress authority", async () => {
  const rootContract = await readFile(join(root, "csm-orchestrate", "SKILL.md"), "utf8");
  const payloadContract = await readFile(
    join(root, "bootstrap", "package", "payload", "skills", "csm-orchestrate", "SKILL.md"),
    "utf8",
  );
  const boundary =
    "Standalone skills have no shared progress host/context callback in this repository; their csm-progress/1 contract is instruction-led only. The executable csm-progress/1 authority is the orchestrator-hosted progress runtime reached through `orchestrate()` and its injected host adapter. Standalone skills must not invent a caller, mutate the parent aggregate, or emit receipt, cursor, telemetry, browse, upload, credential, session, or publication data through progress.";
  assert.ok(
    rootContract.replace(/\s+/g, " ").includes(boundary),
    "standalone boundary contract drift",
  );
  assert.equal(payloadContract, rootContract);
});
