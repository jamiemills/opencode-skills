import assert from "node:assert/strict";
import { test } from "node:test";
import { survey } from "../lib/scan/survey.mjs";

test("direct survey diagnostics never disclose repository paths", async () => {
  const messages = [];
  const broker = {
    execute: async (command) =>
      command === "git:rev-parse-toplevel"
        ? { ok: true, stdout: "/home/alice/private/project\n" }
        : { ok: true, stdout: "package.json\n" },
  };
  await survey("/home/alice/private/project", broker, (message) => messages.push(message));
  assert.equal(messages.length, 1);
  assert.doesNotMatch(messages.join("\n"), /alice|\/home\/alice/);
});
