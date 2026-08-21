import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "csm-browse-summary-"));

after(() => rm(root, { recursive: true, force: true }));

test("e2e skip writes a private summary to the requested path", async () => {
  const summaryPath = join(root, "nested", "custom-summary.json");
  await execFileAsync(process.execPath, ["tests/e2e.mjs"], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    env: {
      ...process.env,
      CSM_BROWSE_E2E_SKIP: "1",
      CSM_BROWSE_E2E_SUMMARY: summaryPath,
      CSM_BROWSE_SESSIONS_ROOT: join(root, "sessions"),
    },
  });
  assert.equal((await stat(summaryPath)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(summaryPath, "utf-8")).skipped, true);
});
