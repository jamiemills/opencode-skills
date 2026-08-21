import { connect, getSession, waitForLoad, waitForSelector } from "../cdp.mjs";

export async function run({ args, state, verb }) {
  if (verb === "open" || verb === "navigate") {
    let url = null;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--url" && i + 1 < args.length) {
        url = args[++i];
      } else if (!url && !args[i].startsWith("--")) {
        url = args[i];
      }
    }

    if (!url) {
      console.error("Missing URL. Usage: browse open --session <sid> <url>");
      process.exit(1);
    }

    const client = await connect(state);
    const sessionId = await getSession(client);

    await client.send("Page.navigate", { url }, sessionId);
    await waitForLoad(client, sessionId);

    const { result } = await client.send(
      "Runtime.evaluate",
      {
        expression: "document.title",
        returnByValue: true,
      },
      sessionId,
    );

    const title = result && result.value ? result.value : "";
    console.log(JSON.stringify({ url, title }));

    await client.close();
    return;
  }

  if (verb === "wait") {
    const ms = parseInt(args[0], 10);
    if (isNaN(ms) || ms < 0) {
      console.error("Invalid wait duration. Usage: browse wait --session <sid> <ms>");
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, ms));
    console.log(JSON.stringify({ waited: ms }));
    return;
  }

  if (verb === "wait-selector") {
    const sel = args[0];
    if (!sel) {
      console.error(
        "Missing selector. Usage: browse wait-selector --session <sid> <sel> [timeout]",
      );
      process.exit(1);
    }
    const timeout = args[1] ? parseInt(args[1], 10) : 5000;

    const client = await connect(state);
    const sessionId = await getSession(client);

    await waitForSelector(client, sessionId, sel, timeout);

    console.log(JSON.stringify({ found: sel }));

    await client.close();
    return;
  }
}
