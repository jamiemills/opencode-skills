// API Surface dimension — inert renderer.
//
// T211 owns this module. It is deliberately INERT: it exports a factory
// (`createApiRenderer`) and a render function, but it is never registered in
// the existing-ten renderer map and nothing in the pipeline, CLI, enrich,
// validate, or write path dispatches it. Activation happens at T223/T224.
//
// Every rendered operation references admissible evidence: each row carries the
// repo-relative declaration path and line. Name-only fixtures therefore render
// nothing (the model never contains them). Prose is neutral and factual; counts
// and caps are disclosed, not graded.
//
// ESM only. Zero npm deps. Pure DATA; no filesystem or side effects.

import { DEFAULT_RENDER_CONTEXT } from "./base.mjs";

const CATEGORY_HEADINGS = Object.freeze([
  { category: "route", heading: "Routes" },
  { category: "contract", heading: "Contracts" },
  { category: "rpc", heading: "RPC operations" },
  { category: "event", heading: "Events" },
  { category: "cli_command", heading: "CLI commands" },
  { category: "public_export", heading: "Public exports" },
]);

function displayPath(operation) {
  if (operation.category === "route") {
    const method = operation.details?.method ?? "ANY";
    return operation.signature.slice(method.length + 1) || operation.signature;
  }
  return operation.signature;
}

function evidenceCell(operation, escapeField) {
  const line = operation.source.line ?? "";
  return `\`${escapeField(operation.source.path)}${line ? `:${line}` : ""}\``;
}

function methodCell(operation, escapeField) {
  return escapeField(operation.details?.method ?? "ANY");
}

function summaryLine(model, escapeField) {
  const { summary } = model;
  const parts = [
    `${summary.operations} operation(s)`,
    `${summary.routes} route(s)`,
    `${summary.contracts} contract(s)`,
    `${summary.rpcs} RPC operation(s)`,
    `${summary.events} event(s)`,
    `${summary.cliCommands} CLI command(s)`,
    `${summary.publicExports} public export(s)`,
  ];
  return `Declaration-backed API surface: ${parts.join(", ")} across ${escapeField(String(model.searchSpace.filesInspected))} inspected file(s).`;
}

function capNotes(model) {
  const notes = [];
  const { capped } = model.summary;
  if (capped.operations) notes.push("operation total capped");
  for (const [category, label] of [
    ["routes", "route"],
    ["contracts", "contract"],
    ["rpcs", "RPC operation"],
    ["events", "event"],
    ["cliCommands", "CLI command"],
    ["publicExports", "public export"],
  ]) {
    if (capped[category]) notes.push(`${label} count capped`);
  }
  if (capped.files) notes.push("file read cap reached");
  return notes;
}

function routeRows(operations, escapeField) {
  const rows = [];
  for (const operation of operations) {
    rows.push(
      `| ${methodCell(operation, escapeField)} | \`${escapeField(displayPath(operation), { inTable: true })}\` | ${escapeField(operation.dialect, { inTable: true })} | ${evidenceCell(operation, escapeField)} |`,
    );
  }
  return rows;
}

function genericRows(operations, escapeField) {
  const rows = [];
  for (const operation of operations) {
    const signature = escapeField(displayPath(operation), { inTable: true });
    const secondary =
      operation.category === "rpc"
        ? `${escapeField(operation.details?.service ?? "", { inTable: true })}.${escapeField(operation.details?.method ?? "", { inTable: true })}`
        : operation.category === "public_export"
          ? escapeField(operation.details?.kind ?? "", { inTable: true })
          : escapeField(operation.details?.command ?? operation.details?.emitter ?? "", {
              inTable: true,
            });
    rows.push(
      `| \`${signature}\` | ${secondary} | ${escapeField(operation.dialect, { inTable: true })} | ${evidenceCell(operation, escapeField)} |`,
    );
  }
  return rows;
}

function renderCategory(category, operations, escapeField) {
  const lines = [];
  lines.push(
    `#### ${CATEGORY_HEADINGS.find((entry) => entry.category === category)?.heading ?? category}`,
  );
  lines.push("");
  if (category === "route") {
    lines.push("| Method | Path | Dialect | Evidence |");
    lines.push("|--------|------|---------|----------|");
    lines.push(...routeRows(operations, escapeField));
  } else {
    lines.push("| Method / signature | Operation | Dialect | Evidence |");
    lines.push("|-------------------|-----------|---------|----------|");
    lines.push(...genericRows(operations, escapeField));
  }
  lines.push("");
  return lines;
}

/**
 * Render the API model as a neutral Markdown section.
 * @param {string} _repoName - repository name (unused; retained for the shared
 *   renderer signature).
 * @param {object} model - the deep-frozen API model (`findings` from the
 *   scanner).
 * @param {object} context - render context from `render/base.mjs`.
 * @returns {string} The `## API Surface` Markdown section.
 */
export function renderApi(_repoName, model, context = DEFAULT_RENDER_CONTEXT) {
  if (!model || typeof model !== "object") return "";
  const { escapeField } = context;
  const lines = [];
  lines.push("## API Surface");
  lines.push("");
  lines.push(summaryLine(model, escapeField));
  lines.push("");

  const notes = capNotes(model);
  if (notes.length > 0) {
    lines.push(`- ${notes.join("; ")}.`);
    lines.push("");
  }

  const byCategory = new Map();
  for (const operation of model.operations ?? []) {
    const group = byCategory.get(operation.category) ?? [];
    group.push(operation);
    byCategory.set(operation.category, group);
  }

  for (const { category } of CATEGORY_HEADINGS) {
    const operations = byCategory.get(category) ?? [];
    if (operations.length === 0) continue;
    lines.push(...renderCategory(category, operations, escapeField));
  }

  if (model.operations.length === 0) {
    lines.push(
      `No declaration-backed API surface detected in ${model.searchSpace.filesInspected} inspected file(s).`,
    );
    lines.push("");
  }

  if (model.diagnostics.length > 0) {
    lines.push("### Diagnostics");
    lines.push("");
    for (const entry of model.diagnostics) {
      const location =
        entry.line === null
          ? `\`${escapeField(entry.path)}\``
          : `\`${escapeField(entry.path)}:${entry.line}\``;
      lines.push(`- ${location}: ${escapeField(entry.reason)} (${escapeField(entry.status)})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Create an inert API renderer. Never registered anywhere.
 * @param {object} options - `{ context }` render context override.
 * @returns {{ render: (model: object) => string }} A frozen renderer.
 */
export function createApiRenderer({ context = DEFAULT_RENDER_CONTEXT } = {}) {
  if (
    context === null ||
    typeof context !== "object" ||
    typeof context.escapeField !== "function"
  ) {
    throw new TypeError("createApiRenderer requires a render context with escapeField");
  }
  return Object.freeze({
    render(model) {
      return renderApi("repository", model, context);
    },
  });
}
