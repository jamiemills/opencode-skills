import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const roots = [
  new URL("../csm-orchestrate/", import.meta.url),
  new URL("../bootstrap/package/payload/skills/csm-orchestrate/", import.meta.url),
];
const forbidden = /createCliHost|cli-host|opencode\s+run|@opencode(?:-ai)?|from\s+["']opencode/i;

async function filesUnder(url) {
  const entries = await readdir(url, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, url);
    if (entry.isDirectory()) files.push(...(await filesUnder(child)));
    else if (/\.(mjs|json|md)$/.test(entry.name)) files.push(child);
  }
  return files;
}

test("active orchestrator source and payload contain no OpenCode execution path", async () => {
  const files = (await Promise.all(roots.map(filesUnder))).flat();
  const violations = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    if (forbidden.test(text)) violations.push(file.pathname);
  }
  assert.deepEqual(violations, []);
});

test("the removed CLI host is absent from the packaged payload", async () => {
  for (const root of roots) {
    await assert.rejects(
      readFile(new URL("lib/cli-host.mjs", root)),
      (error) => error.code === "ENOENT",
    );
  }
});
