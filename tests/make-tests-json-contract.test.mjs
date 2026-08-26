import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  appendLedgerRow,
  ledgerExists,
  recoverLedger,
  validateLedgerRow,
} from "../csm-make-tests/lib/ledger.mjs";
import { assertVerification } from "../csm-make-tests/lib/verification.mjs";

const lineage = {
  planId: "json-only-plan",
  taskId: "T019",
  planDigest: `sha256:${"a".repeat(64)}`,
};
const ledger = (terminal = false) => ({
  artifactId: "ledger-t019",
  owner: "csm-make-tests",
  runId: "run-t019",
  commitSha: "abcdef1234567",
  terminal,
});
const row = (type = "entry", terminal = false) => ({
  schema: "csm-make-tests-ledger/1",
  rowType: type,
  ledger: ledger(terminal),
  sourcePlan: lineage,
  recordedAt: "2026-08-26T00:00:00Z",
  ...(type === "entry"
    ? {
        entry: {
          entryId: "entry-001",
          artifact: "tests/example.test.mjs",
          kind: "contract",
          approval: { state: "approved", approver: "user" },
          verification: "verified",
          evidence: [
            {
              id: "fixture-001",
              kind: "fixture",
              status: "verified",
              digest: `sha256:${"b".repeat(64)}`,
            },
          ],
        },
      }
    : {}),
  ...(type === "cursor"
    ? {
        cursor: {
          state: "VERIFY",
          cycle: 1,
          lastEntryId: "entry-001",
          nextTransition: "VERIFY -> OUTPUT",
        },
      }
    : {}),
});

test("typed ledger rows append and recover from the durable cursor", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-make-tests-json-"));
  const path = join(root, "ledger.jsonl");
  await appendLedgerRow(path, row());
  await appendLedgerRow(path, row("cursor"));
  const recovered = await recoverLedger(path);
  assert.equal(recovered.status, "recoverable");
  assert.equal(recovered.cursor.cursor.nextTransition, "VERIFY -> OUTPUT");
});

test("ledger rejects malformed, legacy, projection, owner-collision, and terminal writes", async () => {
  assert.equal(validateLedgerRow({}).valid, false);
  const root = await mkdtemp(join(tmpdir(), "csm-make-tests-json-"));
  const path = join(root, "ledger.jsonl");
  await writeFile(path, "# Tests Ledger\n");
  await assert.rejects(() => recoverLedger(path), { code: "ledger-corrupt" });
  const terminalPath = join(root, "terminal.jsonl");
  await appendLedgerRow(terminalPath, row("entry", true));
  await assert.rejects(() => appendLedgerRow(terminalPath, row()), { code: "terminal-immutable" });
  await assert.rejects(
    () => appendLedgerRow(join(root, "other.jsonl"), row(), { owner: "other-owner" }),
    { code: "owner-mismatch" },
  );
});

test("verification status rejects stale or missing evidence and preserves the shared status record", () => {
  const verification = {
    schema: "csm-make-tests-verification/1",
    artifactId: "verification-t019",
    owner: "csm-make-tests",
    runId: "run-t019",
    sourcePlan: lineage,
    status: "VERIFIED",
    verificationStatus: { format: "csm-verification-status/1", status: "VERIFIED", unresolved: [] },
    evidence: [
      {
        status: "verified",
        references: [
          {
            id: "mutation-001",
            path: "evidence/mutation.json",
            digest: `sha256:${"c".repeat(64)}`,
          },
        ],
      },
    ],
    replay: [],
    unresolved: [],
  };
  assert.doesNotThrow(() => assertVerification(verification));
  verification.evidence[0].references[0].status = "missing";
  assert.throws(() => assertVerification(verification), { code: "evidence-incomplete" });
  verification.evidence[0].references[0].status = "verified";
  verification.verificationStatus.status = "INCOMPLETE";
  assert.throws(() => assertVerification(verification), { code: "status-mismatch" });
});

test("ledger refuses an appended identity mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-make-tests-identity-"));
  const path = join(root, "ledger.jsonl");
  await appendLedgerRow(path, row());
  await assert.rejects(
    () => appendLedgerRow(path, { ...row("cursor"), ledger: { ...ledger(), runId: "run-other" } }),
    { code: "ledger-collision" },
  );
});

test("ledger existence reports missing and present files", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-make-tests-exists-"));
  const path = join(root, "ledger.jsonl");
  assert.equal(await ledgerExists(path), false);
  await writeFile(path, "");
  assert.equal(await ledgerExists(path), true);
});
