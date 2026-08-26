import { appendFile, readFile, stat, open, unlink } from "node:fs/promises";
import { createSchemaValidator, parseJson } from "../../lib/schema-runtime/index.mjs";
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
  const text = await readFile(path, "utf8");
  const rows = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      rows.push(assertLedgerRow(parseJson(line)));
    } catch (error) {
      throw Object.assign(new Error(`ledger recovery failed at line ${index + 1}`), {
        code: "ledger-corrupt",
        cause: error,
      });
    }
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
  const lockPath = `${path}.lock`;
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const stale = Date.now() - (await stat(lockPath)).mtimeMs > 5 * 60 * 1000;
    if (!stale) throw Object.assign(new Error("ledger is locked"), { code: "ledger-locked" });
    await unlink(lockPath);
    lock = await open(lockPath, "wx");
  }
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
    await appendFile(path, `${JSON.stringify(row)}\n`, { flag: "a" });
    return row;
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => {});
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
