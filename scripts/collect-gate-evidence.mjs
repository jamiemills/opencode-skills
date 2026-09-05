// Assembles and shape-validates a deployment evidence bundle for
// checkPromotionGates (G5-G8; deployment-only gates).
//
// Usage:
//   node scripts/collect-gate-evidence.mjs --dry-run        # synthetic shape proof
//   node scripts/collect-gate-evidence.mjs --evidence <dir> # assemble from recorded files
//
// Evidence files (per gate, JSON: {passed, failed, details}) are read from
// <dir>/G5.json, <dir>/G6.json, <dir>/G7.json, <dir>/G8.json.
"use strict";

import { readFile } from "node:fs/promises";

async function main() {
  const [{ checkPromotionGates }, args] = await Promise.all([
    import("../lib/rollout/promotion.mjs"),
    process.argv.slice(2),
  ]);

  if (args[0] === "--dry-run") {
    const synthetic = {
      deployment: {
        G5: { passed: 3, failed: 0, details: "dry-run: shape proof only" },
        G6: { passed: 5, failed: 0, details: "dry-run: shape proof only" },
        G7: { passed: 2, failed: 0, details: "dry-run: shape proof only" },
        G8: { passed: 1, failed: 0, details: "dry-run: shape proof only" },
      },
    };
    const review = checkPromotionGates(synthetic);
    console.log("dry-run promotable:", review.promotable);
    console.log(
      "gate states:",
      JSON.stringify(Object.fromEntries((review.gates ?? []).map((g) => [g.id, g.status]))),
    );
    console.log(
      "NOTE: dry-run uses synthetic counts — real deployment evidence comes from the",
      "procedures in docs/autonomy-deployment.md and is submitted at the T007 user gate.",
    );
    return;
  }

  if (args[0] === "--evidence") {
    const dir = args[1];
    if (!dir) throw new TypeError("usage: collect-gate-evidence.mjs --evidence <dir>");
    const bundle = { deployment: {} };
    for (const gate of ["G5", "G6", "G7", "G8"]) {
      bundle.deployment[gate] = JSON.parse(await readFile(`${dir}/G${gate.slice(1)}.json`, "utf8"));
    }
    const review = checkPromotionGates(bundle);
    console.log(JSON.stringify(review, null, 1));
    return;
  }

  throw new TypeError("usage: collect-gate-evidence.mjs --dry-run | --evidence <dir>");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
