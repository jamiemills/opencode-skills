import { randomUUID } from "node:crypto";
import { rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { readDurableJson } from "../../../../lib/durable-json/index.mjs";
import { CMD_TIMEOUT_MS } from "../constants.mjs";
import { ensurePrivateDir, secureWrite } from "../security.mjs";

export function parseStartArgs(args) {
  let name = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--speed") {
      i++;
    } else if (!args[i].startsWith("--")) {
      name = args[i];
      break;
    }
  }
  return name;
}

export async function run({ args, state, verb }) {
  if (verb !== "screencast-start" && verb !== "screencast-stop") {
    console.error(`Unknown verb: ${verb}. Expected screencast-start or screencast-stop`);
    process.exit(1);
  }

  const cmdDir = join(state.sessionDir, "cmd");
  const outDir = join(cmdDir, "out");

  await ensurePrivateDir(outDir);

  // Sortable timestamp prefix makes even filename-order processing correct;
  // the daemon additionally orders by the cmd payload's `ts` field.
  const base = `${Date.now()}-${randomUUID()}`;
  const cmdPath = join(cmdDir, `${base}.json`);
  const outPath = join(outDir, `${base}.json`);
  const tmpCmdPath = cmdPath + ".tmp";

  if (verb === "screencast-start") {
    if (args.length < 1) {
      console.error("Usage: screencast-start <name> [--small|--medium|--full]");
      process.exit(1);
    }
    const name = parseStartArgs(args);
    let preset = "medium";
    if (args.includes("--small")) preset = "small";
    if (args.includes("--medium")) preset = "medium";
    if (args.includes("--full")) preset = "full";
    let speed = "medium";
    if (args.includes("--speed")) {
      const si = args.indexOf("--speed");
      if (si !== -1 && args[si + 1]) {
        const v = args[si + 1];
        if (v === "slow" || v === "medium" || v === "fast") speed = v;
      }
    }

    const cmd = {
      verb: "screencast-start",
      params: { name, fps: 15, preset, speed },
      ts: new Date().toISOString(),
    };

    await secureWrite(tmpCmdPath, JSON.stringify(cmd), { encoding: "utf-8" });
    await rename(tmpCmdPath, cmdPath);
  } else {
    const cmd = {
      verb: "screencast-stop",
      params: {},
      ts: new Date().toISOString(),
    };

    await secureWrite(tmpCmdPath, JSON.stringify(cmd), { encoding: "utf-8" });
    await rename(tmpCmdPath, cmdPath);
  }

  const start = Date.now();
  let result = null;

  while (Date.now() - start < CMD_TIMEOUT_MS) {
    try {
      result = await readDurableJson(outPath);
      break;
    } catch {
      await setTimeout(200);
    }
  }

  if (!result) {
    // F-006: cancel the enqueued command instead of abandoning it — the
    // daemon must not execute a screencast-start/stop the client already
    // gave up on. If the file is still unclaimed in cmd/, remove it; if it
    // was already claimed, the daemon's stale-command drop (commands older
    // than CMD_TIMEOUT_MS) will discard it at execution time.
    try {
      await unlink(cmdPath);
    } catch {}
    console.error("Daemon unavailable or timed out");
    process.exit(1);
  }

  if (result.ok) {
    if (verb === "screencast-start") {
      console.log("Recording started");
    } else {
      if (!result.result) {
        console.error("Not recording");
        process.exit(1);
      }
      console.log(JSON.stringify(result.result));
    }
  } else {
    if (result.error === "already recording") {
      console.error("Already recording");
      process.exit(1);
    } else if (result.error === "not recording") {
      console.error("Not recording");
      process.exit(1);
    } else {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }
  }
}
