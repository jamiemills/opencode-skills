"use strict";

// T007: side-effect isolation for tests that spawn scripts/run-orchestrator.mjs.
// Importing this module points the shared trace log at a throwaway temp file so
// a driver test never appends to the developer's real repo log, and never
// false-fails the trace-emission gate because of that log.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.CSM_TRACE_LOG) {
  process.env.CSM_TRACE_LOG = join(mkdtempSync(join(tmpdir(), "csm-test-trace-")), "trace.jsonl");
}
