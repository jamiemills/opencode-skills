import { readFileSync, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readJsonLines } from "../../../../lib/durable-json/index.mjs";
import { attachFirstPage, connect } from "../cdp.mjs";
import { isSessionDaemon } from "../cleanup.mjs";

export const MAX_NETWORK_FILTER_LENGTH = 256;

export function compileNetworkFilter(filterStr) {
  if (typeof filterStr !== "string" || filterStr.length > MAX_NETWORK_FILTER_LENGTH) {
    throw new Error(`--filter must be a regex of at most ${MAX_NETWORK_FILTER_LENGTH} characters`);
  }
  try {
    return new RegExp(filterStr, "i");
  } catch (err) {
    throw new Error(`invalid --filter regex: ${err.message}`, { cause: err });
  }
}

async function readEvents(sessionDir) {
  const events = [];
  // F-004: rotated files are OLDER than the live events.jsonl (rotation
  // renames the main file away, then a fresh main is written). Pushing
  // rotated files first (ascending ts) and the main file LAST yields
  // chronological order, so `--tail` returns the newest events once any
  // rotation has happened.
  const files = [];

  try {
    const entries = await readdir(sessionDir);
    entries
      .filter((e) => e.startsWith("events-") && e.endsWith(".jsonl"))
      .toSorted()
      .forEach((e) => files.push(join(sessionDir, e)));
  } catch {}

  const mainPath = join(sessionDir, "events.jsonl");
  if (existsSync(mainPath)) {
    files.push(mainPath);
  }

  for (const file of files) {
    try {
      events.push(...(await readJsonLines(file, { identity: (value) => value?.eventId })));
    } catch {}
  }

  return events;
}

async function hasAnyEventsFile(sessionDir) {
  if (existsSync(join(sessionDir, "events.jsonl"))) return true;
  try {
    const entries = await readdir(sessionDir);
    return entries.some((e) => e.startsWith("events-") && e.endsWith(".jsonl"));
  } catch {
    return false;
  }
}

async function isDaemonAlive(sessionDir, sid) {
  const pidFile = join(sessionDir, "daemon.pid");
  if (!existsSync(pidFile)) return false;
  try {
    const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
    return await isSessionDaemon(pid, sid);
  } catch {
    return false;
  }
}

function parseNumericArg(args, flag) {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) {
    const val = parseInt(args[idx + 1], 10);
    if (!isNaN(val)) return val;
  }
  return null;
}

function parseStringArg(args, flag) {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return null;
}

async function subConsole(args, sessionDir, sid) {
  const tail = parseNumericArg(args, "--tail");

  const events = await readEvents(sessionDir);
  if (events.length === 0) {
    // F-005: hasAnyEventsFile is async — it must be awaited, else the
    // Promise is always truthy and the exit-2 diagnostic is dead code.
    const exists = await hasAnyEventsFile(sessionDir);
    if (!exists) {
      console.error("no events file — capture not started");
      process.exit(2);
    }
  }

  if (!(await isDaemonAlive(sessionDir, sid))) {
    console.error("daemon down — capture gap");
  }

  let filtered = events.filter(
    (e) => e.type === "console" || e.type === "exception" || e.type === "log",
  );

  if (tail !== null && tail > 0) {
    filtered = filtered.slice(-tail);
  }

  process.stdout.write(JSON.stringify(filtered, null, 2) + "\n");
}

async function subNetwork(args, sessionDir, sid) {
  const tail = parseNumericArg(args, "--tail");
  const filterStr = parseStringArg(args, "--filter");

  const events = await readEvents(sessionDir);
  if (events.length === 0) {
    // F-005: awaited — a session dir with no events files is an explicit
    // exit-2 diagnostic, not a silent `[]`.
    const exists = await hasAnyEventsFile(sessionDir);
    if (!exists) {
      console.error("no events file — capture not started");
      process.exit(2);
    }
  }

  if (!(await isDaemonAlive(sessionDir, sid))) {
    console.error("daemon down — capture gap");
  }

  let filtered = events.filter((e) => e.type === "network");

  if (filterStr) {
    let re;
    try {
      re = compileNetworkFilter(filterStr);
    } catch (err) {
      console.error(err.message);
      process.exitCode = 2;
      return;
    }
    filtered = filtered.filter((e) => e.payload && e.payload.url && re.test(e.payload.url));
  }

  if (tail !== null && tail > 0) {
    filtered = filtered.slice(-tail);
  }

  process.stdout.write(JSON.stringify(filtered, null, 2) + "\n");
}

async function subPerformance(state) {
  const client = await connect(state);

  try {
    const { sessionId } = await attachFirstPage(client);

    await client.send("Performance.enable", {}, sessionId);
    const result = await client.send("Performance.getMetrics", {}, sessionId);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  } finally {
    try {
      await client.close();
    } catch {}
  }
}

// F-062: cookie values are session credentials — mask them by default so
// agent transcripts/scrollback never capture full tokens. --values opts in.
export function maskCookieValue(value) {
  if (typeof value !== "string" || value.length === 0) return "";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

// Output projection for `log cookies`: default masks every value; the
// revealValues opt-in (--values) passes values through unchanged. Kept pure
// (no CDP dependency) so the masking contract is unit-testable Docker-free.
export function projectCookies(cookies, { revealValues = false } = {}) {
  if (revealValues) return cookies;
  return cookies.map((c) => ({
    name: c.name,
    domain: c.domain,
    path: c.path,
    value: maskCookieValue(c.value),
    secure: !!c.secure,
    httpOnly: !!c.httpOnly,
    sameSite: c.sameSite,
    session: !!c.session,
    expires: c.expires,
  }));
}

async function subCookies(args, state) {
  const client = await connect(state);

  let sessionId;
  try {
    const { sessionId: attachedId, page } = await attachFirstPage(client);
    sessionId = attachedId;

    const currentUrl = page.url;

    const result = await client.send(
      "Network.getCookies",
      {
        urls: currentUrl ? [currentUrl] : [],
      },
      sessionId,
    );

    const revealValues = args.includes("--values");
    // F-067-7: `--values` is a sharp footgun — a single stray flag dumps
    // HttpOnly session tokens into stdout where transcripts persist. Gate it
    // behind an explicit environment opt-in so a bare flag can never reveal.
    if (revealValues && process.env.CSM_BROWSE_REVEAL_COOKIES !== "1") {
      console.error(
        "Refusing to reveal cookie values: --values requires CSM_BROWSE_REVEAL_COOKIES=1 (full values persist in transcripts/logs; set it only when strictly needed).",
      );
      process.exit(1);
    }
    if (revealValues) {
      console.error(
        "Warning: full cookie values (incl. HttpOnly session tokens) are being printed to stdout and will persist in transcripts/logs.",
      );
    }
    process.stdout.write(
      JSON.stringify(projectCookies(result.cookies, { revealValues }), null, 2) + "\n",
    );
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  } finally {
    try {
      await client.close();
    } catch {}
  }
}

export async function run({ args, state }) {
  if (args.length === 0) {
    console.error("Usage: log <console|network|performance|cookies> [options]");
    process.exit(1);
  }

  const subVerb = args[0];
  const rest = args.slice(1);

  switch (subVerb) {
    case "console":
      await subConsole(rest, state.sessionDir, state.sid);
      break;
    case "network":
      await subNetwork(rest, state.sessionDir, state.sid);
      break;
    case "performance":
      await subPerformance(state);
      break;
    case "cookies":
      await subCookies(rest, state);
      break;
    default:
      console.error(`Unknown sub-verb: ${subVerb}`);
      process.exit(1);
  }
}
