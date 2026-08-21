import { connect, getSession, clickCoords } from "../cdp.mjs";

const KEY_CODES = {
  Enter: { code: "Enter", key: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 },
  Tab: { code: "Tab", key: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 },
  Escape: { code: "Escape", key: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 },
  Backspace: {
    code: "Backspace",
    key: "Backspace",
    windowsVirtualKeyCode: 8,
    nativeVirtualKeyCode: 8,
  },
  Delete: { code: "Delete", key: "Delete", windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 },
  ArrowUp: { code: "ArrowUp", key: "ArrowUp", windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38 },
  ArrowDown: {
    code: "ArrowDown",
    key: "ArrowDown",
    windowsVirtualKeyCode: 40,
    nativeVirtualKeyCode: 40,
  },
  ArrowLeft: {
    code: "ArrowLeft",
    key: "ArrowLeft",
    windowsVirtualKeyCode: 37,
    nativeVirtualKeyCode: 37,
  },
  ArrowRight: {
    code: "ArrowRight",
    key: "ArrowRight",
    windowsVirtualKeyCode: 39,
    nativeVirtualKeyCode: 39,
  },
};

function resolveKey(keyName) {
  if (KEY_CODES[keyName]) return KEY_CODES[keyName];

  if (keyName.length === 1) {
    const upper = keyName.toUpperCase();
    const vk = upper.charCodeAt(0);
    return {
      code: `Key${upper}`,
      key: keyName,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
    };
  }

  return {
    code: keyName,
    key: keyName,
    windowsVirtualKeyCode: 0,
    nativeVirtualKeyCode: 0,
  };
}

export async function run({ args, state, verb }) {
  if (verb === "click") {
    const sel = args[0];
    if (!sel) {
      console.error("Missing selector. Usage: browse click --session <sid> <sel> [index]");
      process.exit(1);
    }
    const index = args[1] ? parseInt(args[1], 10) : 0;

    const client = await connect(state);
    const sessionId = await getSession(client);

    await clickCoords(client, sessionId, sel, index);
    console.log(JSON.stringify({ clicked: sel, index }));

    await client.close();
    return;
  }

  if (verb === "type") {
    const sel = args[0];
    const text = args[1];
    if (!sel || text === undefined) {
      console.error("Missing args. Usage: browse type --session <sid> <sel> <text>");
      process.exit(1);
    }

    const client = await connect(state);
    const sessionId = await getSession(client);

    await clickCoords(client, sessionId, sel);

    try {
      await client.send("Input.insertText", { text }, sessionId);
    } catch {
      for (const ch of text) {
        await client.send(
          "Input.dispatchKeyEvent",
          {
            type: "char",
            text: ch,
          },
          sessionId,
        );
      }
    }

    console.log(JSON.stringify({ typed: text, selector: sel }));

    await client.close();
    return;
  }

  if (verb === "press") {
    const sel = args[0];
    const key = args[1];
    if (!sel || !key) {
      console.error("Missing args. Usage: browse press --session <sid> <sel> <key>");
      process.exit(1);
    }

    const client = await connect(state);
    const sessionId = await getSession(client);

    await clickCoords(client, sessionId, sel);

    const keyDef = resolveKey(key);

    await client.send(
      "Input.dispatchKeyEvent",
      {
        type: "rawKeyDown",
        key: keyDef.key,
        code: keyDef.code,
        windowsVirtualKeyCode: keyDef.windowsVirtualKeyCode,
        nativeVirtualKeyCode: keyDef.nativeVirtualKeyCode,
      },
      sessionId,
    );

    await client.send(
      "Input.dispatchKeyEvent",
      {
        type: "keyUp",
        key: keyDef.key,
        code: keyDef.code,
        windowsVirtualKeyCode: keyDef.windowsVirtualKeyCode,
        nativeVirtualKeyCode: keyDef.nativeVirtualKeyCode,
      },
      sessionId,
    );

    console.log(JSON.stringify({ pressed: key, selector: sel }));

    await client.close();
    return;
  }
}
