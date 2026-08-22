import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmod } from "node:fs/promises";

import { join } from "node:path";
import { test } from "node:test";
import { freshSessionsRoot, removeRoot } from "./helpers/env.mjs";

const root = await freshSessionsRoot("csm-browse-dropped-");
const { collectorsHook } = await import("../../lib/collectors.mjs");

function fakeClient() {
  const client = new EventEmitter();
  client.send = async () => {};
  return client;
}

test("collector flush failures are counted in stats, not dropped silently", async () => {
  const dir = join(root, "dropped-events");
  try {
    const client = fakeClient();
    const handle = await collectorsHook(client, "tab", dir);
    // Make the session dir non-writable so every secureAppend fails with
    // EACCES: the natural way to force batch failures without mocking.
    await chmod(dir, 0o500);
    for (let i = 0; i < 5; i++) {
      client.emit("Log.entryAdded", {
        entry: { source: "test", level: "info", text: `dropped-${i}` },
      });
    }
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && handle.stats().droppedWrites < 5) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(handle.stats().droppedWrites, 5);
    await handle.detach();
  } finally {
    await chmod(dir, 0o700).catch(() => {});
    await removeRoot(root);
  }
});
