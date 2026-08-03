import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { commandBroker } from '../shared/command.mjs';
import { readManifest } from '../shared/manifest.mjs';
import { MONITORING_LIBS, matchDep } from '../shared/detection.mjs';

// Bounds for the direct-read replacements of the former rg pipelines.
const SCAN_FILE_LIMIT = 400;
const SCAN_BYTE_LIMIT = 1024 * 1024;

async function listFiles(repoPath, overview, broker) {
  const fromOverview = overview && Array.isArray(overview.files) && overview.files.length > 0
    ? overview.files
    : null;
  if (fromOverview) return fromOverview;
  try {
    const result = await broker.execute('rg:files', { cwd: repoPath });
    const raw = result.ok || result.noMatch ? result.stdout : '';
    return raw
      .split('\n')
      .map((s) => s.trim().replace(/\\/g, '/'))
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

function readContent(absPath) {
  try {
    const content = readFileSync(absPath, 'utf-8');
    return content.length > SCAN_BYTE_LIMIT ? null : content;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GitHub Actions workflow parsing (regex-based, NOT a YAML parser)
//
// parseYamlShallow THROWS on block scalars (`|`/`>`) which are ubiquitous in
// `run:` steps, so workflow files are parsed with targeted regex instead. All
// parsing is scoped to a single top-level (column-0) subtree to avoid
// misclassifying `permissions:`/`concurrency:`/`env:` keys (or their children
// like `contents:`/`group:`) as jobs.
// ---------------------------------------------------------------------------

// Return the lines between a top-level `key:` line and the next column-0 key
// (or EOF). The key may be quoted (`'on':` / `"on":`) as GitHub Actions
// commonly quotes `on:`/`jobs:` to dodge YAML 1.1 boolean coercion.
function extractTopSubtree(content, key) {
  const lines = String(content).split(/\r?\n/);
  const keyRe = new RegExp(`^['"]?${key}['"]?:[ \\t]*(?:#.*)?$`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (keyRe.test(lines[i])) { start = i; break; }
  }
  if (start === -1) return '';
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break; // next top-level key
    out.push(lines[i]);
  }
  return out.join('\n');
}

// Job ids are the direct children of the `jobs:` mapping (exactly 2-space
// indent). Job ids allow letters, digits, `-` and `_`, so `[\w-]+` is used
// (a bare `\w+` would silently drop hyphenated ids like `secret-scan`).
function extractJobNames(content) {
  const subtree = extractTopSubtree(content, 'jobs');
  const names = [];
  for (const m of subtree.matchAll(/^  ([\w-]+):/gm)) names.push(m[1]);
  return names;
}

// Trigger event names from `on:`. Handles:
//   - inline scalar:   `on: push`
//   - inline flow seq: `on: [push, pull_request]`
//   - inline flow map: `on: {push: ..., pull_request: ...}`
//   - block mapping:   `on:\n  push:\n  pull_request:`
//   - block sequence:  `on:\n  - push\n  - pull_request`
function extractOnTriggers(content) {
  const triggers = new Set();
  const src = String(content);
  const onLine = src.match(/^['"]?on['"]?:[ \t]*([^\n#]*)/m);
  if (onLine) {
    const inline = onLine[1].trim();
    if (inline) {
      if (inline.startsWith('[')) {
        const inner = inline.slice(1, inline.lastIndexOf(']'));
        for (const part of inner.split(',')) {
          const t = part.trim().replace(/^['"]|['"]$/g, '');
          if (t) triggers.add(t);
        }
        return triggers;
      }
      if (inline.startsWith('{')) {
        const inner = inline.slice(1, inline.lastIndexOf('}'));
        for (const part of inner.split(',')) {
          const k = part.split(':')[0].trim().replace(/^['"]|['"]$/g, '');
          if (k) triggers.add(k);
        }
        return triggers;
      }
      triggers.add(inline.replace(/^['"]|['"]$/g, ''));
      return triggers;
    }
  }
  const subtree = extractTopSubtree(src, 'on');
  for (const m of subtree.matchAll(/^  ([\w-]+):/gm)) triggers.add(m[1]);
  for (const m of subtree.matchAll(/^  -[ \t]+([^\s]+)/gm)) {
    const t = m[1].replace(/^['"]|['"]$/g, '');
    if (t) triggers.add(t);
  }
  return triggers;
}

function analyzeDockerfile(repoPath) {
  const dockerfilePaths = ['Dockerfile', 'Dockerfile.prod', 'Dockerfile.dev', 'Dockerfile.production', 'Dockerfile.staging'];
  const dockerfiles = [];

  for (const name of dockerfilePaths) {
    const path = join(repoPath, name);
    if (!existsSync(path)) continue;

    try {
      const content = readFileSync(path, 'utf-8');
      const lines = content.split('\n');

      const baseImages = [];
      const exposedPorts = [];
      let isMultiStage = false;

      for (const line of lines) {
        const trimmed = line.trim();
        if (/^FROM\s/i.test(trimmed)) {
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 2) {
            const img = parts[1];
            if (img.toLowerCase() !== 'scratch') {
              baseImages.push(img);
            }
          }
          if (baseImages.length > 1) isMultiStage = true;
        }
        const portMatch = trimmed.match(/^EXPOSE\s+(\d+)/i);
        if (portMatch) {
          exposedPorts.push(parseInt(portMatch[1], 10));
        }
      }

      const hasHealthcheck = /HEALTHCHECK/i.test(content);
      const hasUser = /^USER\s/i.test(content);
      const isAlpine = baseImages.some((img) => /alpine/i.test(img));
      const isSlim = baseImages.some((img) => /slim/i.test(img));
      const hasEntrypoint = /ENTRYPOINT/i.test(content);
      const hasCmd = /CMD/i.test(content);

      dockerfiles.push({
        name,
        baseImages,
        exposedPorts,
        isMultiStage,
        hasHealthcheck,
        hasUser,
        isAlpine,
        isSlim,
        hasEntrypoint,
        hasCmd,
        lineCount: lines.length,
      });
    } catch {}
  }

  return dockerfiles;
}

function analyzeDockerCompose(repoPath) {
  const composeFiles = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml', 'docker-compose.override.yml'];
  const services = [];
  let networks = [];
  let volumes = [];

  for (const name of composeFiles) {
    const path = join(repoPath, name);
    if (!existsSync(path)) continue;

    try {
      const content = readFileSync(path, 'utf-8');

      const serviceMatch = content.match(/^  (\w+):/gm);
      const serviceSet = new Set();
      if (serviceMatch) {
        for (const m of serviceMatch) {
          const svc = m.replace(/^  /, '').replace(/:$/, '');
          if (!['services', 'networks', 'volumes'].includes(svc)) {
            serviceSet.add(svc);
          }
        }
      }

      const depMap = {};
      for (const svc of serviceSet) {
        const depRe = new RegExp(`^  ${svc}:\\n[\\s\\S]*?(?=^\\S|\\Z)`, 'm');
        const depSection = content.match(depRe);
        if (depSection) {
          const depends = depSection[0].match(/^\s+-\s+(\w+)/gm);
          if (depends) {
            depMap[svc] = depends.map((d) => d.replace(/^\s+-\s+/, ''));
          } else {
            depMap[svc] = [];
          }
        }
      }

      services.push({
        file: name,
        names: [...serviceSet],
        count: serviceSet.size,
        dependencies: depMap,
      });

      const netMatch = content.match(/^networks:\n([\s\S]*?)(?=^volumes|^services|\Z)/m);
      if (netMatch) {
        const netNames = netMatch[1].match(/^  (\w+):/gm) || [];
        networks = netNames.map((n) => n.replace(/^  /, '').replace(/:$/, ''));
      }

      const volMatch = content.match(/^volumes:\n([\s\S]*?)(?=\Z)/m);
      if (volMatch) {
        const volNames = volMatch[1].match(/^  (\w+):/gm) || [];
        volumes = volNames.map((v) => v.replace(/^  /, '').replace(/:$/, ''));
      }
    } catch {}
  }

  return { present: services.length > 0, services, networks, volumes };
}

function analyzeCI(repoPath) {
  const ciSystems = [];

  const ghWorkflows = join(repoPath, '.github/workflows');
  if (existsSync(ghWorkflows)) {
    try {
      let workflowFiles = [];
      try {
        workflowFiles = readdirSync(ghWorkflows).filter((n) => /\.(ya?ml)$/i.test(n));
      } catch {}

      const jobs = new Set();
      const triggers = new Set();
      for (const f of workflowFiles) {
        let content;
        try {
          content = readFileSync(join(ghWorkflows, f), 'utf-8');
        } catch {
          continue;
        }
        for (const j of extractJobNames(content)) jobs.add(j);
        for (const t of extractOnTriggers(content)) triggers.add(t);
      }

      ciSystems.push({
        platform: 'GitHub Actions',
        workflowCount: workflowFiles.length,
        jobs: [...jobs],
        triggers: [...triggers],
      });
    } catch {}
  }

  const gitlabCI = join(repoPath, '.gitlab-ci.yml');
  if (existsSync(gitlabCI)) {
    try {
      const content = readFileSync(gitlabCI, 'utf-8');
      const stages = content.match(/^stages:\n([\s\S]*?)(?=\n\S|\Z)/m);
      let stageList = [];
      if (stages) {
        stageList = stages[1].match(/^\s+-\s+(.+)/gm)?.map((s) => s.replace(/^\s+-\s+/, '')) || [];
      }
      ciSystems.push({
        platform: 'GitLab CI',
        stages: stageList,
        present: true,
      });
    } catch {}
  }

  const jenkinsfile = join(repoPath, 'Jenkinsfile');
  const hasJenkins = existsSync(jenkinsfile);
  if (hasJenkins) {
    ciSystems.push({ platform: 'Jenkins', present: true });
  }

  const circleConfig = join(repoPath, '.circleci/config.yml');
  const hasCircle = existsSync(circleConfig);
  if (hasCircle) {
    ciSystems.push({ platform: 'CircleCI', present: true });
  }

  const travis = join(repoPath, '.travis.yml');
  const hasTravis = existsSync(travis);
  if (hasTravis) {
    ciSystems.push({ platform: 'Travis CI', present: true });
  }

  return ciSystems;
}

const ENV_FILE_NAMES = [
  '.env', '.env.local', '.env.development', '.env.production',
  '.env.test', '.env.staging', '.env.example', '.env.sample',
];

// Recognized app/config files across ecosystems.
const APP_CONFIG_FILES = [
  // JS / TS
  'app.config.js', 'app.config.ts',
  'config.js', 'config.ts', 'configuration.ts',
  // Python
  'settings.py', 'config.py', 'alembic.ini', '.env.toml',
];

function detectEnvConfig(repoPath, overview) {
  const envFiles = [];

  // Allow lowercase env-var names (python/django convention) in addition to
  // SCREAMING_SNAKE_CASE. Comments and blank lines are ignored.
  for (const name of ENV_FILE_NAMES) {
    const path = join(repoPath, name);
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, 'utf-8');
        const varCount = content.split('\n').filter((l) => /^\s*[A-Za-z_][A-Za-z0-9_]*\s*=/.test(l)).length;
        envFiles.push({ file: name, varCount });
      } catch {}
    }
  }

  const fileList = Array.isArray(overview?.files) ? overview.files : null;
  let appConfigDetected = false;
  if (fileList) {
    // Prefer the enumerated file list (produced by shared/enum.mjs via survey),
    // which sees config files anywhere in the tree, not only at the repo root.
    const set = new Set(APP_CONFIG_FILES);
    for (const f of fileList) {
      if (set.has(f.split('/').pop())) { appConfigDetected = true; break; }
    }
  } else {
    for (const name of APP_CONFIG_FILES) {
      if (existsSync(join(repoPath, name))) { appConfigDetected = true; break; }
    }
  }

  const hasConfigDir = existsSync(join(repoPath, 'config'));

  return { envFiles, configDir: hasConfigDir, appConfigFile: appConfigDetected };
}

function detectHealthChecks(repoPath, files) {
  const checks = [];

  const re = /healthcheck|health[_\-]?check|readiness[_\-]?probe|liveness[_\-]?probe|\/health\b|\/ready\b|\/live\b|\/ping\b/;
  for (const f of files.slice(0, SCAN_FILE_LIMIT)) {
    const content = readContent(join(repoPath, f));
    if (content && re.test(content) && checks.length < 10) {
      checks.push(f);
    }
  }

  return {
    detected: checks.length > 0,
    references: checks,
  };
}

function detectGracefulShutdown(repoPath, files) {
  const patterns = [
    { name: 'SIGTERM handler', re: /(?:SIGTERM|SIGINT|SIGQUIT)/ },
    { name: 'BeforeExit', re: /beforeExit/ },
    { name: 'Graceful close', re: /graceful[_\-]?(?:shutdown|close|exit)/i },
    { name: 'Process exit handler', re: /process\.on\([\'"]exit[\'"]/ },
    { name: 'Server close', re: /server\.close\(\)/ },
  ];

  const detections = [];
  const bounded = files.slice(0, SCAN_FILE_LIMIT);
  for (const { name, re } of patterns) {
    let n = 0;
    for (const f of bounded) {
      const content = readContent(join(repoPath, f));
      if (content && re.test(content)) n++;
    }
    if (n > 0) {
      detections.push({ pattern: name, fileCount: n });
    }
  }

  return detections;
}

// Ecosystem-aware monitoring/observability detection.
//
// The historic implementation held an inline JS-only map and only inspected a
// package.json-shaped deps object. It now defers to shared/detection.mjs
// MONITORING_LIBS (keyed by ecosystem) so that Python
// (structlog/loguru/sentry-sdk/prometheus-client/opentelemetry-*), Rust
// (tracing/opentelemetry/sentry/slog/...) and JS/TS projects all surface.
//
// `matchDep` accepts an array of dependency names OR a `{name: version}` map;
// it returns one entry per matched dep carrying the table's `label`/`type` and
// honours trailing-`*` prefix keys (e.g. `opentelemetry-*`, `@opentelemetry/*`).
function detectMonitoring(manifest) {
  if (!manifest) return { libraries: [] };
  const ecosystems = Array.isArray(manifest.ecosystems) ? manifest.ecosystems : [];
  if (ecosystems.length === 0) return { libraries: [] };

  // allDepNames = union of runtime + dev dependency names across every
  // ecosystem the manifest normalized (Python/JVM/JS/Rust deps collapse into
  // the same `dependencies`/`devDependencies` buckets in shared/manifest.mjs).
  const allDepNames = Object.keys({
    ...(manifest.dependencies || {}),
    ...(manifest.devDependencies || {}),
  });

  const libraries = [];
  const seen = new Set();
  for (const eco of ecosystems) {
    const table = MONITORING_LIBS[eco];
    if (!table) continue;
    for (const m of matchDep(allDepNames, table)) {
      if (seen.has(m.name)) continue; // a dep name lives in one ecosystem
      seen.add(m.name);
      libraries.push({
        package: m.name,
        label: m.label,
        ...(m.type ? { type: m.type } : {}),
      });
    }
  }

  return { libraries };
}

export async function scan(repoPath, overview, broker = commandBroker) {
  const manifest = readManifest(repoPath);
  const files = await listFiles(repoPath, overview, broker);

  const dockerfiles = analyzeDockerfile(repoPath);
  const dockerCompose = analyzeDockerCompose(repoPath);
  const ci = analyzeCI(repoPath);
  const envConfig = detectEnvConfig(repoPath, overview);

  const hasDockerignore = existsSync(join(repoPath, '.dockerignore'));
  const hasMakefile = existsSync(join(repoPath, 'Makefile')) ||
    existsSync(join(repoPath, 'makefile')) ||
    existsSync(join(repoPath, 'GNUmakefile'));

  // Just (justfile.dev) task runner — Just itself accepts `Justfile` or
  // `justfile`; `justfile.just` is an explicit --justfile target some repos
  // commit. Surfaced as its own boolean; render wiring is deferred (P1).
  const hasJustfile = existsSync(join(repoPath, 'Justfile')) ||
    existsSync(join(repoPath, 'justfile')) ||
    existsSync(join(repoPath, 'justfile.just'));

  const hasDeployScripts = existsSync(join(repoPath, 'deploy')) ||
    existsSync(join(repoPath, 'deploy.sh')) ||
    existsSync(join(repoPath, 'scripts/deploy.sh')) ||
    existsSync(join(repoPath, 'scripts/deploy'));

  const healthChecks = detectHealthChecks(repoPath, files);
  const gracefulShutdown = detectGracefulShutdown(repoPath, files);
  const monitoring = detectMonitoring(manifest);

  const procfile = join(repoPath, 'Procfile');
  const hasProcfile = existsSync(procfile);

  let procfileContent = null;
  if (hasProcfile) {
    try {
      procfileContent = readFileSync(procfile, 'utf-8');
    } catch {}
  }

  const ciWorkflowCount = ci.reduce(
    (sum, c) => sum + (c.workflowCount || (c.present ? 1 : 0)),
    0,
  );
  const signal = dockerfiles.length > 0 || ciWorkflowCount > 0 ? 'high' : hasDockerignore ? 'medium' : 'low';

  return {
    dimension: 'operations',
    signal,
    findings: {
      dockerfiles,
      dockerCompose,
      ci,
      envConfig,
      hasDockerignore,
      hasMakefile,
      hasJustfile,
      hasDeployScripts,
      healthChecks,
      gracefulShutdown,
      monitoring,
      procfile: hasProcfile ? { content: procfileContent } : null,
    },
  };
}
