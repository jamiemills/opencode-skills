import { connect, getSession, evalInPage } from "../cdp.mjs";

export async function run({ args, state, verb }) {
  if (verb === "text") {
    const sel = args[0];
    const escaped = sel ? sel.replace(/\\/g, "\\\\").replace(/'/g, "\\'") : "";
    const expression = sel
      ? `document.querySelector('${escaped}')?.innerText?.trim() || ''`
      : `document.body?.innerText?.trim() || ''`;

    const client = await connect(state);
    const sessionId = await getSession(client);

    if (sel) {
      const match = await evalInPage(
        client,
        sessionId,
        `document.querySelector('${escaped}') !== null`,
      );
      if (!match || match.value !== true) {
        await client.close();
        console.error(`Element not found: "${sel}"`);
        process.exit(1);
      }
    }

    const result = await evalInPage(client, sessionId, expression);
    const text = result && result.value ? String(result.value) : "";
    console.log(text);

    await client.close();
    return;
  }

  if (verb === "html") {
    const sel = args[0];
    const escaped = sel ? sel.replace(/\\/g, "\\\\").replace(/'/g, "\\'") : "";
    const expression = sel
      ? `document.querySelector('${escaped}')?.outerHTML || ''`
      : "document.documentElement.outerHTML";

    const client = await connect(state);
    const sessionId = await getSession(client);

    if (sel) {
      const match = await evalInPage(
        client,
        sessionId,
        `document.querySelector('${escaped}') !== null`,
      );
      if (!match || match.value !== true) {
        await client.close();
        console.error(`Element not found: "${sel}"`);
        process.exit(1);
      }
    }

    const result = await evalInPage(client, sessionId, expression);
    const html = result && result.value ? String(result.value) : "";
    console.log(html);

    await client.close();
    return;
  }

  if (verb === "eval") {
    const expression = args[0];
    if (!expression) {
      console.error("Missing expression. Usage: browse eval --session <sid> <js-expression>");
      process.exit(1);
    }

    const client = await connect(state);
    const sessionId = await getSession(client);

    const result = await evalInPage(client, sessionId, expression);
    console.log(JSON.stringify({ result }));

    await client.close();
    return;
  }
}
