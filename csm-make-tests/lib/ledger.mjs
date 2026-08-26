import { createSchemaValidator } from "../../lib/schema-runtime/index.mjs";
import { stat } from "node:fs/promises";
import { acquireLock, atomicWrite, readJsonLines } from "../../lib/durable-json/index.mjs";
import schema from "../schemas/ledger.schema.json" with { type: "json" };

export const LEDGER_SCHEMA = "csm-make-tests-ledger/1";
const validator = createSchemaValidator({ schemas: [schema] });

export function validateLedgerRow(row) {
  const result = validator.validate(LEDGER_SCHEMA, row);
  return result;
}

export function assertLedgerRow(row) {
  const result = validateLedgerRow(row);
  if (!result.valid)
    throw Object.assign(new Error("invalid csm-make-tests ledger row"), {
      code: "schema-invalid",
      errors: result.errors,
    });
  return row;
}

export async function readLedger(path) {
  let rows;
  try {
    rows = (
      await readJsonLines(path, {
        identity: (value) => value?.entry?.entryId ?? value?.cursor?.state,
      })
    ).map(assertLedgerRow);
  } catch (error) {
    if (error.code === "ENOENT") throw error;
    throw Object.assign(new Error("ledger recovery failed"), {
      code: "ledger-corrupt",
      cause: error,
    });
  }
  if (!rows.length) throw Object.assign(new Error("ledger is empty"), { code: "ledger-empty" });
  const identity = JSON.stringify({ ledger: rows[0].ledger, sourcePlan: rows[0].sourcePlan });
  if (
    rows.some(
      (row) => JSON.stringify({ ledger: row.ledger, sourcePlan: row.sourcePlan }) !== identity,
    )
  )
    throw Object.assign(new Error("ledger identity changed"), { code: "ledger-collision" });
  return rows;
}

export async function appendLedgerRow(path, row, { owner = "csm-make-tests" } = {}) {
  assertLedgerRow(row);
  if (row.ledger.owner !== owner)
    throw Object.assign(new Error("ledger owner mismatch"), { code: "owner-mismatch" });
  const lock = await acquireLock(`${path}.lock`).catch((error) => {
    if (error.code === "durable-locked") error.code = "ledger-locked";
    throw error;
  });
  try {
    let rows = [];
    try {
      rows = await readLedger(path);
    } catch (error) {
      if (!["ENOENT", "ledger-empty"].includes(error.code)) throw error;
    }
    if (rows.at(-1)?.ledger.terminal)
      throw Object.assign(new Error("terminal ledger is immutable"), {
        code: "terminal-immutable",
      });
    if (rows.length && rows[0].ledger.artifactId !== row.ledger.artifactId)
      throw Object.assign(new Error("ledger artifact collision"), { code: "collision" });
    if (
      rows.length &&
      JSON.stringify({ ledger: rows[0].ledger, sourcePlan: rows[0].sourcePlan }) !==
        JSON.stringify({ ledger: row.ledger, sourcePlan: row.sourcePlan })
    )
      throw Object.assign(new Error("ledger identity mismatch"), { code: "ledger-collision" });
    const content =
      rows
        .map((entry) => JSON.stringify(entry))
        .concat(JSON.stringify(row))
        .join("\n") + "\n";
    await atomicWrite(path, content, { mode: 0o600 });
    return row;
  } finally {
    await lock.release();
  }
}

export async function recoverLedger(path) {
  const rows = await readLedger(path);
  const cursor = rows.findLast((row) => row.rowType === "cursor");
  if (!cursor)
    throw Object.assign(new Error("ledger has no maintenance cursor"), { code: "cursor-missing" });
  if (rows.at(-1).ledger.terminal || cursor.cursor.state === "STOP")
    return { status: "terminal", rows, cursor };
  return { status: "recoverable", rows, cursor };
}

export async function ledgerExists(path) {
  return stat(path).then(
    () => true,
    () => false,
  );
}
