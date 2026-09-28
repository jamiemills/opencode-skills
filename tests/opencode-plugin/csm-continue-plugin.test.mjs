"use strict";

// T002: behavior tests for the opencode plugin wrapper. They use a fake client,
// a fake durable record written to a temp directory, and no network or real
// session. The wrapper is a thin adapter over the T001 core, so these tests pin
// only external behavior: exactly one bounded prompt per idle, the no-progress
// digest stop, the continuation budget, the kill switch, and fail-closed
// silence.
//
// SPIKE NOTE (open question, recorded per T002 / CR-03; do NOT run live here):
// Does `event.type === "session.idle"` actually fire at turn completion in the
// running opencode binary (1.18.32 installed vs 1.15.12 pinned SDK types), and
// does `client.session.prompt` re-enter the same session without recursive
// `session.idle` re-entry, an infinite continuation loop, or an awaited-hook
// deadlock? The SDK type declarations and vendor docs only describe the
// surface; this was never executed. It must be proved with a minimal local
// plugin harness or the T004 pilot before the supervisor is relied on, and a
// failed pilot is a NO-GO. These tests deliberately never start opencode.

import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { CsmContinuePlugin } from "../../scripts/opencode-plugin/csm-continue.js";

const IDLE = Object.freeze({ type: "session.idle", properties: { sessionID: "ses_test" } });
const ACTIVE = Object.freeze([".agents", "csm-build-state", "active.json"]);

const PLUGIN_DIR = join(import.meta.dirname, "..", "..", "scripts", "opencode-plugin");
const WRAPPER_SOURCE = join(PLUGIN_DIR, "csm-continue.js");
const CORE_SOURCE = join(PLUGIN_DIR, "csm-continue-core.mjs");

function workRecord() {
  return {
    schema: "csm-plan/2",
    status: "in_progress",
    control: { status: "in_progress", activeTasks: [] },
    tasks: [{ taskId: "T002", status: "pending" }],
  };
}

async function makeDirectory() {
  return mkdtemp(join(tmpdir(), "csm-continue-plugin-"));
}

async function writeActive(directory, record) {
  const target = join(directory, ...ACTIVE.slice(0, -1));
  await mkdir(target, { recursive: true });
  await writeFile(join(directory, ...ACTIVE), JSON.stringify(record));
}

function fakeClient() {
  const calls = [];
  const client = {
    session: {
      prompt: async (input) => {
        calls.push(input);
        return { info: {}, parts: [] };
      },
    },
  };
  return { client, calls };
}

async function withDirectory(body) {
  const directory = await makeDirectory();
  try {
    return await body(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("one idle with work remaining injects exactly one prompt", async () => {
  await withDirectory(async (directory) => {
    await writeActive(directory, workRecord());
    const { client, calls } = fakeClient();
    const hooks = await CsmContinuePlugin({ client, directory });
    await hooks.event({ event: IDLE });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path.id, "ses_test");
    const part = calls[0].body.parts[0];
    assert.equal(part.type, "text");
    assert.ok(typeof part.text === "string" && part.text.length > 0);
  });
});

test("a second idle with an unchanged digest injects none", async () => {
  await withDirectory(async (directory) => {
    await writeActive(directory, workRecord());
    const { client, calls } = fakeClient();
    const hooks = await CsmContinuePlugin({ client, directory });
    await hooks.event({ event: IDLE });
    assert.equal(calls.length, 1);
    await hooks.event({ event: IDLE });
    assert.equal(calls.length, 1);
  });
});

test("budget exhaustion injects none", async () => {
  process.env.CSM_CONTINUE_MAX = "1";
  try {
    await withDirectory(async (directory) => {
      await writeActive(directory, workRecord());
      const { client, calls } = fakeClient();
      const hooks = await CsmContinuePlugin({ client, directory });
      await hooks.event({ event: IDLE });
      assert.equal(calls.length, 1);
      // Advance the digest so only the budget can stop the second idle.
      await writeActive(directory, { ...workRecord(), lastCheckpoint: "cycle 1" });
      await hooks.event({ event: IDLE });
      assert.equal(calls.length, 1);
    });
  } finally {
    delete process.env.CSM_CONTINUE_MAX;
  }
});

test("kill switch injects none", async () => {
  process.env.CSM_CONTINUE_KILL = "1";
  try {
    await withDirectory(async (directory) => {
      await writeActive(directory, workRecord());
      const { client, calls } = fakeClient();
      const hooks = await CsmContinuePlugin({ client, directory });
      await hooks.event({ event: IDLE });
      assert.equal(calls.length, 0);
    });
  } finally {
    delete process.env.CSM_CONTINUE_KILL;
  }
});

test("missing client is silent", async () => {
  await withDirectory(async (directory) => {
    await writeActive(directory, workRecord());
    const hooks = await CsmContinuePlugin({ client: { session: {} }, directory });
    await hooks.event({ event: IDLE });
    const bare = await CsmContinuePlugin({ directory });
    await bare.event({ event: IDLE });
  });
});

test("no active run is silent", async () => {
  await withDirectory(async (directory) => {
    const { client, calls } = fakeClient();
    const hooks = await CsmContinuePlugin({ client, directory });
    await hooks.event({ event: IDLE });
    assert.equal(calls.length, 0);
  });
});

// T002 repair: the installed plugin has no repository around it, so the wrapper
// must resolve ONLY its sibling core. Prove no repo-relative import remains, and
// that a copy of the two files loads and runs from a bare temp directory.
test("the wrapper imports only node builtins and its sibling core", async () => {
  const source = await readFile(WRAPPER_SOURCE, "utf8");
  const specifiers = [
    ...source.matchAll(/from\s+["']([^"']+)["']/g),
    ...source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g),
    ...source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1]);
  assert.ok(specifiers.length > 0, "the wrapper must have resolvable imports");
  for (const specifier of specifiers) {
    assert.ok(
      specifier.startsWith("node:") || specifier.startsWith("./"),
      `unexpected import specifier: ${specifier}`,
    );
    assert.ok(!specifier.includes("csm-build"), `repo-relative import must be gone: ${specifier}`);
  }
  assert.ok(!source.includes("../../"), "no parent-relative path may remain in the wrapper");
});

test("an installed copy with no repo present loads and injects one bounded prompt", async () => {
  const installDir = await mkdtemp(join(tmpdir(), "csm-installed-plugin-"));
  const workDir = await mkdtemp(join(tmpdir(), "csm-installed-work-"));
  try {
    // The installed shape: exactly the two plugin files, plus a neutral module
    // marker so Node loads the .js as ESM outside the repository.
    await writeFile(join(installDir, "package.json"), '{"type":"module"}');
    await copyFile(WRAPPER_SOURCE, join(installDir, "csm-continue.js"));
    await copyFile(CORE_SOURCE, join(installDir, "csm-continue-core.mjs"));
    await writeActive(workDir, workRecord());

    const installed = await import(pathToFileURL(join(installDir, "csm-continue.js")).href);
    const { client, calls } = fakeClient();
    const hooks = await installed.CsmContinuePlugin({ client, directory: workDir });
    await hooks.event({ event: IDLE });
    assert.equal(calls.length, 1, "the installed copy must inject exactly one prompt");
    assert.equal(calls[0].path.id, "ses_test");

    await hooks.event({ event: IDLE });
    assert.equal(calls.length, 1, "the installed copy still bounds prompts per idle");
  } finally {
    await rm(installDir, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
  }
});
