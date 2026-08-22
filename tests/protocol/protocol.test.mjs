import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { EXIT_CODES, PROTOCOL_STATES, runProtocol } from "./engine.mjs";
import { loadReportSchema, validateSchema } from "./report-schema.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const packageRoot = join(root, "bootstrap/package");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const capable = {
  hasNpx: true,
  hasFileWrite: true,
  knowsDestination: true,
  supportsStaging: true,
  supportsLock: true,
  supportsRollback: true,
  knowsReload: true,
};
// R3: the battery runs on the same frozen clock as the trust test so expiry
// behavior is deterministic and never depends on the real wall clock.
const now = new Date("2026-08-18T00:00:00.000Z");
const capableInput = (overrides) => ({
  capabilities: capable,
  trustRootApproved: true,
  now,
  ...overrides,
});
const stateChain = [...PROTOCOL_STATES];

test("F-043 conformance: the protocol state table in protocol.md derives from the engine implementation", async () => {
  const protocol = await readFile(join(root, "bootstrap/protocol.md"), "utf8");
  const chain = protocol.match(/The state chain is exactly:\s*\n\s*`([^`]+)`/);
  assert.ok(chain, "protocol.md must declare the exact state chain");
  assert.deepEqual(
    chain[1].split("->").map((state) => state.trim()),
    PROTOCOL_STATES,
  );
  for (const state of PROTOCOL_STATES) {
    assert.ok(
      new RegExp(`### \\d+\\s*\\.\\s*${state}\\b`).test(protocol),
      `protocol.md lacks the numbered ${state} section`,
    );
  }
  const table = protocol.slice(protocol.indexOf("## Refusal Codes"));
  // Whitespace-tolerant row match: the table is column-aligned by tooling, so
  // single-space assumptions silently zero the parse and fail the gate.
  const rows = [
    ...table.matchAll(/^\|\s*(\d+)\s*\|\s*`([A-Z_]+)`\s*\|(.*?)\|\s*([A-Z_ /]+)\|\s*$/gm),
  ];
  const errorCodes = Object.keys(EXIT_CODES).filter((code) => code !== "PLACED");
  assert.ok(rows.length >= errorCodes.length, "refusal table must list every exit code");
  const covered = new Set();
  for (const [, exit, code, , failing] of rows) {
    assert.equal(
      EXIT_CODES[code],
      Number(exit),
      `protocol.md exit ${exit} disagrees with EXIT_CODES.${code}`,
    );
    covered.add(code);
    for (const state of failing.split("/").map((value) => value.trim()))
      assert.ok(PROTOCOL_STATES.includes(state), `unknown failing state ${state} for ${code}`);
  }
  for (const code of errorCodes)
    assert.ok(covered.has(code), `EXIT_CODES.${code} missing from the protocol.md refusal table`);
  assert.equal(EXIT_CODES.E_DESTINATION_SYMLINK, 8);
  assert.ok(PROTOCOL_STATES.includes("MATERIALIZE"));
});

test("capable agent materializes verified payload copies and emits a schema-valid report", async () => {
  const sandbox = await mkdtemp("/tmp/csm-protocol-");
  await chmod(sandbox, 0o700);
  try {
    const destination = join(sandbox, "agent skills root");
    const result = await runProtocol(
      capableInput({ destination, sandbox, reloadAction: "restart the agent host" }),
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.report.result, "placed");
    assert.equal(result.report.destination, destination);
    assert.deepEqual(
      result.report.states.map((state) => state.state),
      stateChain,
    );
    assert.ok(result.report.states.every((state) => state.refusal === null));
    assert.deepEqual(result.report.skillsPlaced, [
      "csm-bdd-tdd",
      "csm-browse",
      "csm-build",
      "csm-deep-research",
      "csm-grill",
      "csm-plan",
      "csm-review",
      "csm-scan",
      "csm-upload",
    ]);
    const index = JSON.parse(await readFile(join(root, "bootstrap/payload-index.json"), "utf8"));
    const expected = [...index.classes.skills, ...index.classes.supportingFiles];
    assert.equal(result.report.filesPlaced.length, expected.length);
    assert.deepEqual(result.report.hashVerification, {
      algorithm: "sha256",
      verified: expected.length,
      total: expected.length,
    });
    for (const entry of expected) {
      const rel = entry.path.slice("payload/skills/".length);
      const placed = await readFile(join(destination, rel));
      assert.equal(sha256(placed), entry.sha256, rel);
      assert.equal(sha256(await readFile(join(packageRoot, entry.path))), entry.sha256, rel);
      assert.equal(
        (await lstat(join(destination, rel))).mode & 0o777,
        parseInt(entry.mode, 8),
        rel,
      );
      const reported = result.report.filesPlaced.find((file) => file.path === rel);
      assert.ok(reported, rel);
      assert.equal(reported.sha256, entry.sha256, rel);
      assert.equal(reported.bytes, entry.bytes, rel);
      assert.equal(reported.verified, true, rel);
    }
    assert.deepEqual(result.report.reloadAction, {
      status: "declared",
      action: "restart the agent host",
    });
    assert.equal(result.report.availability.staging, true);
    assert.equal(result.report.availability.locking, true);
    assert.equal(result.report.availability.rollback, false);
    assert.equal(result.report.backupPath, null);
    const schema = await loadReportSchema();
    assert.deepEqual(validateSchema(result.report, schema), []);
    assert.deepEqual((await readdir(sandbox)).toSorted(), ["agent skills root"]);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("ambiguous destination asks the user and refuses without confirmation, proceeds with it", async () => {
  const sandbox = await mkdtemp("/tmp/csm-protocol-");
  await chmod(sandbox, 0o700);
  try {
    const capabilities = { ...capable, knowsDestination: false, knowsReload: false };
    const base = {
      capabilities,
      trustRootApproved: true,
      now,
      sandbox,
      destinationCandidates: [join(sandbox, "choice-a"), join(sandbox, "choice-b")],
    };
    const refused = await runProtocol(base);
    assert.equal(refused.exitCode, 4);
    assert.equal(refused.report.refusal.code, "E_AMBIGUOUS_DESTINATION");
    assert.equal(refused.report.refusal.state, "CONFIRM_IF_NEEDED");
    assert.deepEqual(
      refused.report.states.map((state) => state.state),
      ["DISCOVER", "TRUST", "PLAN_DESTINATION", "CONFIRM_IF_NEEDED"],
    );
    assert.equal(refused.report.destination, null);
    assert.deepEqual((await readdir(sandbox)).toSorted(), []);
    const schema = await loadReportSchema();
    assert.deepEqual(validateSchema(refused.report, schema), []);
    const confirmed = join(sandbox, "user picked dir");
    const proceeded = await runProtocol({ ...base, confirmation: { destination: confirmed } });
    assert.equal(proceeded.exitCode, 0);
    assert.equal(proceeded.report.destination, confirmed);
    assert.equal(
      proceeded.report.states.find((state) => state.state === "CONFIRM_IF_NEEDED").action,
      "confirmed",
    );
    assert.deepEqual(proceeded.report.reloadAction, { status: "unknown", action: null });
    assert.ok(proceeded.report.limitations.includes("reload-unknown"));
    assert.deepEqual(validateSchema(proceeded.report, schema), []);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("unapproved trust root asks the user and refuses without confirmation, proceeds with it", async () => {
  const sandbox = await mkdtemp("/tmp/csm-protocol-");
  await chmod(sandbox, 0o700);
  try {
    const destination = join(sandbox, "skills");
    const base = { capabilities: capable, trustRootApproved: false, now, destination, sandbox };
    const refused = await runProtocol(base);
    assert.equal(refused.exitCode, 5);
    assert.equal(refused.report.refusal.code, "E_UNTRUSTED");
    assert.equal(refused.report.refusal.state, "CONFIRM_IF_NEEDED");
    assert.deepEqual((await readdir(sandbox)).toSorted(), []);
    const proceeded = await runProtocol({ ...base, confirmation: { trustRootApproved: true } });
    assert.equal(proceeded.exitCode, 0);
    assert.equal(proceeded.report.destination, destination);
    assert.equal(
      proceeded.report.states.find((state) => state.state === "CONFIRM_IF_NEEDED").action,
      "confirmed",
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
