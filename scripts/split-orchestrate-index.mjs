// Split csm-orchestrate/lib/index.mjs into cohesive modules. Executed as the
// P1 phase work of the quality-delivery orchestration run.
//
// The codemod is content-anchored and fail-closed: every extraction boundary is
// verified against the expected source line before slicing; any drift aborts
// without writing. Public API is preserved (orchestrate, runOrchestration,
// createOrchestrator stay in index.mjs; makeAutonomousFunctionalGate is
// re-exported from the new helpers module).
//
// Usage: node scripts/split-orchestrate-index.mjs [--check]
//   --check  verify anchors only, write nothing
"use strict";

import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const exec = promisify(execFile);
const INDEX_PATH = fileURLToPath(new URL("../csm-orchestrate/lib/index.mjs", import.meta.url));
const LIB_DIR = fileURLToPath(new URL("../csm-orchestrate/lib/", import.meta.url));

// Extraction boundaries: 1-indexed line numbers with expected prefix content.
const ANCHORS = {
  runIdConst: { line: 37, prefix: "const RUN_ID = " },
  slugStart: { line: 38, prefix: "const slug = (value) =>" },
  upstreamRefsStart: {
    line: 199,
    prefix: "function upstreamRefsFor(node, phase, outputsByNode) {",
  },
  saveCursorStart: { line: 435, prefix: "async function saveCursor({" },
  createOrchestratorStart: {
    line: 482,
    prefix: "export function createOrchestrator(defaults = {}) {",
  },
  runOrchestrationExport: { line: 1995, prefix: "export const runOrchestration = orchestrate;" },
  autonomousGateStart: {
    line: 1997,
    prefix: "export function makeAutonomousFunctionalGate(validatorBindings) {",
  },
};

const HELPERS_HEAD = `"use strict";

// Pure helpers shared by the orchestration run loop. Extracted from index.mjs
// (quality-delivery item 4); index.mjs re-exports makeAutonomousFunctionalGate
// for public API parity.
import { digest } from "../../lib/schema-runtime/index.mjs";
import { projectChildStatus } from "./recovery.mjs";
import { validateSignal } from "./validators.mjs";

`;

const ARTIFACTS_HEAD = `"use strict";

// Artifact handoff and reconciliation for the orchestration run loop.
// Extracted from index.mjs (quality-delivery item 4).
import { validateHandoffRef } from "./invocation.mjs";
import { reconcileChildArtifacts } from "./evidence-gates.mjs";

`;

const CURSOR_HEAD = `"use strict";

// Durable parent-cursor persistence for the orchestration run loop.
// Extracted from index.mjs (quality-delivery item 4).
import { createParentCursor, persistCursor } from "./recovery.mjs";
import { slug } from "./run-helpers.mjs";

`;

const HELPERS_EXPORTS = [
  "slug",
  "jsonProjection",
  "materialDigest",
  "unique",
  "invocationApproval",
  "receiptApproval",
  "progressByReceipt",
  "abortFailure",
  "stepCapFailure",
  "raceDeadline",
  "dispatchIntentFailure",
  "terminalReceipt",
  "childReceipt",
  "normalizeEvidence",
  "defaultGate",
  "makeAutonomousFunctionalGate",
];

const ARTIFACTS_EXPORTS = [
  "upstreamRefsFor",
  "externalRefsFor",
  "reconcileResult",
  "validateReviewArtifacts",
];

const CURSOR_EXPORTS = ["saveCursor"];

const INDEX_HELPER_IMPORTS = [
  "  abortFailure,",
  "  childReceipt,",
  "  defaultGate,",
  "  dispatchIntentFailure,",
  "  invocationApproval,",
  "  jsonProjection,",
  "  materialDigest,",
  "  normalizeEvidence,",
  "  progressByReceipt,",
  "  raceDeadline,",
  "  slug,",
  "  stepCapFailure,",
  "  terminalReceipt,",
  "  unique,",
];

function assertAnchors(lines) {
  for (const [name, { line, prefix }] of Object.entries(ANCHORS)) {
    const actual = lines[line - 1];
    if (!actual || !actual.startsWith(prefix))
      throw new Error(
        `anchor ${name} drifted: line ${line} expected prefix ${JSON.stringify(prefix)}, got ${JSON.stringify(actual?.slice(0, 60) ?? null)}`,
      );
  }
}

function slice(lines, from, to) {
  return lines.slice(from - 1, to).join("\n");
}

function moduleWith(head, body, exports) {
  return `${head}${body}\n\nexport {\n${exports.map((name) => `  ${name},`).join("\n")}\n};\n`;
}

async function nodeCheck(path) {
  await exec(process.execPath, ["--check", path], { encoding: "utf8" });
}

export async function splitOrchestrateIndex({ check = false } = {}) {
  const source = await readFile(INDEX_PATH, "utf8");
  const lines = source.split("\n");
  // trailing newline yields one final empty element
  if (lines.length !== 2044 || lines[2043] !== "") {
    // already-split? verify the split shape and report idempotently
    if (lines.length < 2044 && source.includes('from "./run-helpers.mjs"')) {
      const helpers = await readFile(`${LIB_DIR}run-helpers.mjs`, "utf8");
      const artifacts = await readFile(`${LIB_DIR}run-artifacts.mjs`, "utf8");
      const cursor = await readFile(`${LIB_DIR}run-cursor.mjs`, "utf8");
      if (!helpers || !artifacts || !cursor) throw new Error("split state is inconsistent");
      return {
        indexPath: INDEX_PATH,
        indexBytesBefore: Buffer.byteLength(source),
        indexBytesAfter: Buffer.byteLength(source),
        modules: {
          "run-helpers.mjs": Buffer.byteLength(helpers),
          "run-artifacts.mjs": Buffer.byteLength(artifacts),
          "run-cursor.mjs": Buffer.byteLength(cursor),
        },
        alreadySplit: true,
        wrote: false,
      };
    }
    throw new Error(
      `expected 2043 content lines plus trailing newline in index.mjs, found ${lines.length - 1}`,
    );
  }
  assertAnchors(lines);

  const helpersBody = slice(lines, ANCHORS.slugStart.line, 197);
  const artifactsBody = slice(lines, ANCHORS.upstreamRefsStart.line, 433);
  const cursorBody = slice(lines, ANCHORS.saveCursorStart.line, 480);
  const gateBody = slice(lines, ANCHORS.autonomousGateStart.line, 2043);

  const helpersModule = moduleWith(HELPERS_HEAD, `${helpersBody}\n${gateBody}`, HELPERS_EXPORTS);
  const artifactsModule = moduleWith(ARTIFACTS_HEAD, artifactsBody, ARTIFACTS_EXPORTS);
  const cursorModule = moduleWith(CURSOR_HEAD, cursorBody, CURSOR_EXPORTS);

  const newIndex = [
    ...lines.slice(0, 35),
    "",
    "import {",
    ...INDEX_HELPER_IMPORTS,
    '} from "./run-helpers.mjs";',
    "import {",
    "  externalRefsFor,",
    "  reconcileResult,",
    "  upstreamRefsFor,",
    "  validateReviewArtifacts,",
    '} from "./run-artifacts.mjs";',
    'import { saveCursor } from "./run-cursor.mjs";',
    "",
    lines[ANCHORS.runIdConst.line - 1],
    "",
    ...lines.slice(ANCHORS.createOrchestratorStart.line - 1, ANCHORS.runOrchestrationExport.line),
    'export { makeAutonomousFunctionalGate } from "./run-helpers.mjs";',
    "",
  ].join("\n");

  const result = {
    indexPath: INDEX_PATH,
    indexBytesBefore: Buffer.byteLength(source),
    modules: {
      "run-helpers.mjs": Buffer.byteLength(helpersModule),
      "run-artifacts.mjs": Buffer.byteLength(artifactsModule),
      "run-cursor.mjs": Buffer.byteLength(cursorModule),
    },
    indexBytesAfter: Buffer.byteLength(newIndex),
  };

  if (check) return { ...result, wrote: false };

  await writeFile(`${LIB_DIR}run-helpers.mjs`, helpersModule, { mode: 0o644 });
  await writeFile(`${LIB_DIR}run-artifacts.mjs`, artifactsModule, { mode: 0o644 });
  await writeFile(`${LIB_DIR}run-cursor.mjs`, cursorModule, { mode: 0o644 });
  await writeFile(INDEX_PATH, newIndex, { mode: 0o644 });
  await nodeCheck(INDEX_PATH);
  await nodeCheck(`${LIB_DIR}run-helpers.mjs`);
  await nodeCheck(`${LIB_DIR}run-artifacts.mjs`);
  await nodeCheck(`${LIB_DIR}run-cursor.mjs`);
  return { ...result, wrote: true };
}

export default splitOrchestrateIndex;

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  splitOrchestrateIndex({ check: process.argv.includes("--check") })
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      process.exit(0);
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
