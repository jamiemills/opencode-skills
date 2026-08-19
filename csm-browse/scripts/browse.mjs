#!/usr/bin/env node
import { loadState, validateSid } from '../lib/session.mjs';
import { redactTelemetry } from '../lib/security.mjs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = fileURLToPath(new URL('..', import.meta.url));

const VERB_MAP = {
  open: 'nav',
  navigate: 'nav',
  wait: 'nav',
  'wait-selector': 'nav',
  click: 'input',
  type: 'input',
  press: 'input',
  text: 'dom',
  html: 'dom',
  eval: 'dom',
  status: 'status',
  screenshot: 'capture',
  console: 'log',
  network: 'log',
  performance: 'log',
  cookies: 'log',
  'screencast-start': 'record',
  'screencast-stop': 'record',
  close: 'close'
};

const args = process.argv.slice(2);
const verb = args[0];
let sid = null;

const verbArgs = [];
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--session' && i + 1 < args.length) {
    sid = args[++i];
  } else {
    verbArgs.push(args[i]);
  }
}

if (!verb) {
  console.error('Usage: node scripts/browse.mjs <verb> --session <sid> [args...]');
  process.exit(1);
}

if (!sid) {
  console.error('Missing --session <sid>');
  process.exit(1);
}

try { validateSid(sid); } catch (e) {
  console.error(e.message);
  process.exit(1);
}

if (VERB_MAP[verb] === 'log') {
  verbArgs.unshift(verb);
} else if (verb.startsWith('--')) {
  console.error('Usage: node scripts/browse.mjs <verb> --session <sid> [args...]');
  process.exit(1);
}

const moduleName = VERB_MAP[verb] || verb;

let mod;
try {
  mod = await import(join(SKILL_DIR, 'lib', 'verbs', `${moduleName}.mjs`));
} catch (err) {
  if (err && err.code === 'ERR_MODULE_NOT_FOUND') {
    console.error(`Unknown verb: ${verb} — see SKILL.md verb table`);
  } else {
    console.error(`Failed to load verb module ${verb}: ${redactTelemetry(err.message)}`);
  }
  process.exit(2);
}

let state;
try {
  state = await loadState(sid);
} catch (err) {
  if (verb === 'close') {
    state = null;
  } else {
    console.error(`Invalid session state for ${sid}: ${redactTelemetry(err.message)}`);
    process.exit(2);
  }
}

if (!state && verb !== 'close') {
  console.error(`No session state for ${sid}`);
  process.exit(1);
}

try {
  await mod.run({ args: verbArgs, state, verb, sid });
} catch (err) {
  // A verb failure can quote state URLs (wsUrl/cdpUrl carry ?token=) — the
  // message must be redacted before it reaches stderr/transcripts.
  console.error(redactTelemetry(err.message));
  process.exit(err.exitCode || 2);
}
