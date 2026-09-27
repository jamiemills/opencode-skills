import test from "node:test";
import assert from "node:assert/strict";

import { LiveModeRefusedError, judge, propose } from "../lib/llm/index.mjs";

const request = { id: "r1", content: "candidate" };

test("live mode always refuses because no live transport ships", async () => {
  await assert.rejects(() => propose(request, { mode: "live" }), LiveModeRefusedError);
  await assert.rejects(
    () =>
      propose(request, {
        mode: "live",
        defEval: "resolved",
        egress: "approved",
        credentials: true,
      }),
    LiveModeRefusedError,
    "no flag combination may enable a live call",
  );
  await assert.rejects(() => judge(request, { mode: "live" }), LiveModeRefusedError);
});
