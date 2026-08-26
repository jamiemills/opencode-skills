import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createNormsArtifact } from "../csm-scan/lib/scan/norms.mjs";
import { extractRepository } from "../csm-ddd/lib/ddd/extract.mjs";

const fixture = join(import.meta.dirname, "../csm-ddd/test/fixtures/repos/sample-repo");

test("DDD uses registered NORMS.json as authoritative input", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-ddd-norms-"));
  try {
    const artifact = createNormsArtifact({
      generated: "2026-08-26",
      repos: [
        {
          overview: { name: "fixture", path: root },
          deep: (
            await import("../csm-scan/lib/scan/norms.mjs")
          ).NORMS_PRODUCER_DESCRIPTOR.dimensions.map(({ name }) => ({
            dimension: name,
            signal: "low",
            confidence: "observed",
            coverage: 100,
            findings: {},
          })),
        },
      ],
      global: null,
    });
    const envelope = await (
      await import("../csm-scan/lib/scan/norms.mjs")
    ).createNormsEnvelope(artifact);
    await writeFile(join(root, "NORMS.json"), `${JSON.stringify(envelope)}\n`);
    const result = await extractRepository({ root });
    assert.equal(result.norms.authoritative, true);
    assert.equal(result.norms.schema, "csm-norms/1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Markdown remains history-only and cannot become DDD machine authority", async () => {
  const result = await extractRepository({ root: fixture });
  assert.equal(result.norms.authoritative, false);
  assert.equal(result.norms.historyOnly, true);
});
