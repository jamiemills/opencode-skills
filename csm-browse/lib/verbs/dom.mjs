import { connect, getSession, evalInPage, assertOutputCap } from "../cdp.mjs";

export const SENSITIVE_AUTH_FLAG = "--allow-sensitive";

export function hasSensitiveAuthorization(args) {
  return args.includes(SENSITIVE_AUTH_FLAG);
}

function requireSensitiveAuthorization(verb, args) {
  if (!hasSensitiveAuthorization(args)) {
    throw new Error(`${verb} requires ${SENSITIVE_AUTH_FLAG}`);
  }
}

function authorizedArgs(args) {
  return args.filter((arg) => arg !== SENSITIVE_AUTH_FLAG);
}

function escapeSelector(sel) {
  return sel ? sel.replace(/\\/g, "\\\\").replace(/'/g, "\\'") : "";
}

export function textExpression(sel) {
  const escaped = escapeSelector(sel);
  return sel
    ? `document.querySelector('${escaped}')?.textContent?.trim() || ''`
    : `document.body?.textContent?.trim() || ''`;
}

export function htmlExpression(sel) {
  const escaped = escapeSelector(sel);
  return sel
    ? `document.querySelector('${escaped}')?.outerHTML || ''`
    : "document.documentElement.outerHTML";
}

export async function run({ args, state, verb }) {
  if (verb === "text") {
    requireSensitiveAuthorization(verb, args);
    const sel = authorizedArgs(args)[0];
    const escaped = escapeSelector(sel);
    const expression = textExpression(sel);

    let client;
    try {
      client = await connect(state);
      const sessionId = await getSession(client);
      if (sel) {
        const match = await evalInPage(
          client,
          sessionId,
          `document.querySelector('${escaped}') !== null`,
        );
        if (!match || match.value !== true) {
          console.error(`Element not found: "${sel}"`);
          process.exit(1);
        }
      }
      const result = await evalInPage(client, sessionId, expression);
      const text = result && result.value ? String(result.value) : "";
      assertOutputCap(text, "text output");
      console.log(text);
    } finally {
      await client?.close?.().catch(() => {});
    }
    return;
  }

  if (verb === "html") {
    requireSensitiveAuthorization(verb, args);
    const sel = authorizedArgs(args)[0];
    const escaped = escapeSelector(sel);
    const expression = htmlExpression(sel);

    let client;
    try {
      client = await connect(state);
      const sessionId = await getSession(client);
      if (sel) {
        const match = await evalInPage(
          client,
          sessionId,
          `document.querySelector('${escaped}') !== null`,
        );
        if (!match || match.value !== true) {
          console.error(`Element not found: "${sel}"`);
          process.exit(1);
        }
      }
      const result = await evalInPage(client, sessionId, expression);
      const html = result && result.value ? String(result.value) : "";
      assertOutputCap(html, "html output");
      console.log(html);
    } finally {
      await client?.close?.().catch(() => {});
    }
    return;
  }

  if (verb === "eval") {
    requireSensitiveAuthorization(verb, args);
    const expression = authorizedArgs(args)[0];
    if (!expression) {
      console.error("Missing expression. Usage: browse eval --session <sid> <js-expression>");
      process.exit(1);
    }

    let client;
    try {
      client = await connect(state);
      const sessionId = await getSession(client);
      const result = await evalInPage(client, sessionId, expression);
      console.log(JSON.stringify({ result }));
    } finally {
      await client?.close?.().catch(() => {});
    }
    return;
  }
}
