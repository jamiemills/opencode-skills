import { execFile } from 'node:child_process';
import { rgIgnoreArgs } from './ignore.mjs';

export const COMMAND_LIMITS = Object.freeze({
  defaultMaxBytes: 1 * 1024 * 1024,
  rgFilesMaxBytes: 50 * 1024 * 1024,
  rgJsonMaxBytes: 10 * 1024 * 1024,
  gitMaxBytes: 4 * 1024 * 1024,
  defaultTimeoutMs: 10_000,
  rgFilesTimeoutMs: 30_000,
  rgJsonTimeoutMs: 30_000,
  gitTimeoutMs: 10_000,
  maxPatternLength: 256,
});

export class CommandError extends Error {
  constructor(code, commandId) {
    super(`command ${commandId ?? '(unknown)'} failed (${code})`);
    this.name = 'CommandError';
    this.code = code;
    this.commandId = commandId;
  }
}

function splitGlobArgs(entries) {
  const out = [];
  for (const s of entries) {
    const i = s.indexOf(' ');
    out.push(s.slice(0, i), s.slice(i + 1));
  }
  return out;
}

const RG_GLOB_ARGS = Object.freeze(splitGlobArgs(rgIgnoreArgs()));

const ENV_KEYS = Object.freeze([
  'LC_ALL',
  'LANG',
  'GIT_OPTIONAL_LOCKS',
  'GIT_TERMINAL_PROMPT',
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  'GIT_PAGER',
  'PAGER',
  'NO_COLOR',
  'PATH',
]);

const ENV_OVERRIDES = Object.freeze({
  LC_ALL: 'C',
  LANG: 'C',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: 'false',
  SSH_ASKPASS: 'false',
  GIT_PAGER: 'cat',
  PAGER: 'cat',
  NO_COLOR: '1',
});

export function buildCommandEnv(hostEnv = process.env) {
  const env = {};
  for (const key of ENV_KEYS) {
    if (key in ENV_OVERRIDES) env[key] = ENV_OVERRIDES[key];
    else if (typeof hostEnv[key] === 'string') env[key] = hostEnv[key];
  }
  if (env.PATH === undefined) env.PATH = '/usr/bin:/bin';
  return Object.freeze(env);
}

const LITERAL_PATTERN = /^[A-Za-z0-9_./:@+%-]+$/;

function literalPattern(pattern) {
  if (typeof pattern !== 'string'
      || pattern.length === 0
      || pattern.length > COMMAND_LIMITS.maxPatternLength
      || pattern.startsWith('-')
      || !LITERAL_PATTERN.test(pattern)) {
    throw new CommandError('INVALID_PATTERN', 'rg:json');
  }
  return pattern;
}

function gitCommand(argv) {
  return {
    executable: 'git',
    buildArgv: () => [...argv],
    exitPolicy: 'git',
    outputPolicy: { maxBytes: COMMAND_LIMITS.gitMaxBytes, encoding: 'utf8' },
    timeoutMs: COMMAND_LIMITS.gitTimeoutMs,
  };
}

const COMMANDS = Object.freeze({
  'rg:files': {
    executable: 'rg',
    buildArgv: () => ['--files', ...RG_GLOB_ARGS],
    exitPolicy: 'rg',
    outputPolicy: { maxBytes: COMMAND_LIMITS.rgFilesMaxBytes, encoding: 'utf8' },
    timeoutMs: COMMAND_LIMITS.rgFilesTimeoutMs,
  },
  // Bounded hidden/gitignored enumeration for the secret-scanning pass (F-018).
  // `--hidden --no-ignore` surfaces dotfiles and gitignored files the survey
  // enumeration prunes; the shared ignore globs (RG_GLOB_ARGS) still exclude
  // .git, node_modules, and the other ignored directories.
  'rg:files-hidden': {
    executable: 'rg',
    buildArgv: () => ['--files', '--hidden', '--no-ignore', ...RG_GLOB_ARGS],
    exitPolicy: 'rg',
    outputPolicy: { maxBytes: COMMAND_LIMITS.rgFilesMaxBytes, encoding: 'utf8' },
    timeoutMs: COMMAND_LIMITS.rgFilesTimeoutMs,
  },
  'rg:json': {
    executable: 'rg',
    buildArgv: (options) => ['--json', ...RG_GLOB_ARGS, '--', literalPattern(options.pattern)],
    exitPolicy: 'rg',
    outputPolicy: { maxBytes: COMMAND_LIMITS.rgJsonMaxBytes, encoding: 'utf8' },
    timeoutMs: COMMAND_LIMITS.rgJsonTimeoutMs,
  },
  'git:rev-parse-toplevel': gitCommand(['rev-parse', '--show-toplevel']),
  'git:rev-parse-abbrev-head': gitCommand(['rev-parse', '--abbrev-ref', 'HEAD']),
  'git:log-oneline-50': gitCommand(['log', '--oneline', '-50']),
  'git:log-oneline-200': gitCommand(['log', '--oneline', '-200']),
  'git:ls-files': gitCommand(['ls-files']),
  'git:branch-list': gitCommand(['branch', '-a']),
  'git:symbolic-ref-origin-head': gitCommand(['symbolic-ref', 'refs/remotes/origin/HEAD']),
  'git:config-remote-origin-url': gitCommand(['config', '--get', 'remote.origin.url']),
  'git:shortlog-summary': gitCommand(['shortlog', '-s', '-n', 'HEAD']),
});

function makeResult(id, definition, argv, outcome, extra) {
  return Object.freeze({
    id,
    executable: definition.executable,
    argv,
    status: outcome.status,
    ok: extra.ok,
    noMatch: extra.noMatch,
    stdout: outcome.stdout ?? '',
    stderr: outcome.stderr ?? '',
  });
}

function interpret(id, definition, argv, outcome) {
  const status = outcome.status;
  if (definition.exitPolicy === 'rg') {
    if (status === 0) return makeResult(id, definition, argv, outcome, { ok: true, noMatch: false });
    if (status === 1) return makeResult(id, definition, argv, outcome, { ok: false, noMatch: true });
    throw new CommandError('RG_FAILURE', id);
  }
  return makeResult(id, definition, argv, outcome, { ok: status === 0, noMatch: status !== 0 });
}

function sanitizeError(error, id) {
  if (error instanceof CommandError) return error;
  let code = typeof error?.code === 'string' ? error.code : '';
  if (!code) code = error?.killed ? 'KILLED' : 'RUN_FAILURE';
  return new CommandError(code, id);
}

function defaultRun(executable, argv, options) {
  const { cwd, env, timeout, signal, outputPolicy } = options;
  const maxBytes = outputPolicy?.maxBytes ?? COMMAND_LIMITS.defaultMaxBytes;
  const encoding = outputPolicy?.encoding ?? 'utf8';
  return new Promise((resolve, reject) => {
    execFile(executable, argv, {
      cwd,
      env,
      timeout,
      signal,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: maxBytes,
      encoding,
    }, (error, stdout, stderr) => {
      if (error === null) {
        resolve({ status: 0, stdout: stdout ?? '', stderr: stderr ?? '' });
        return;
      }
      if (typeof error.code === 'number') {
        resolve({ status: error.code, stdout: stdout ?? '', stderr: stderr ?? '' });
        return;
      }
      reject(error);
    });
  });
}

export const defaultRunner = Object.freeze({ run: defaultRun });

export function createCommandBroker({ runner } = {}) {
  const run = typeof runner === 'function'
    ? runner
    : (runner && typeof runner.run === 'function' ? runner.run : defaultRunner.run);
  return Object.freeze({
    async execute(id, options = {}) {
      if (typeof id !== 'string' || !(id in COMMANDS)) {
        throw new CommandError('UNKNOWN_COMMAND', id);
      }
      const definition = COMMANDS[id];
      const { cwd, signal } = options;
      let argv;
      try {
        argv = definition.buildArgv(options);
      } catch (error) {
        throw sanitizeError(error, id);
      }
      const env = buildCommandEnv(process.env);
      let outcome;
      try {
        outcome = await run(definition.executable, argv, {
          cwd,
          env,
          timeout: definition.timeoutMs,
          signal,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          outputPolicy: { maxBytes: definition.outputPolicy.maxBytes, encoding: 'utf8' },
        });
      } catch (error) {
        throw sanitizeError(error, id);
      }
      return interpret(id, definition, argv, outcome);
    },
  });
}

export const commandBroker = createCommandBroker();
