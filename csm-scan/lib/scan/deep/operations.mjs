import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

function safeExec(cmd, cwd, fallback = '') {
  try {
    return execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
  } catch {
    return fallback;
  }
}

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
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
      const workflowFiles = safeExec('find . -maxdepth 1 -name "*.yml" -o -name "*.yaml" 2>/dev/null', ghWorkflows, '')
        .split('\n').filter(Boolean);

      const jobs = new Set();
      const triggers = new Set();
      for (const f of workflowFiles) {
        const content = readFileSync(join(ghWorkflows, f), 'utf-8');
        const jobMatches = content.match(/^  (\w+):/gm);
        if (jobMatches) {
          for (const j of jobMatches) {
            const name = j.replace(/^  /, '').replace(/:$/, '');
            if (!['on', 'name', 'jobs', 'env'].includes(name)) jobs.add(name);
          }
        }
        const onSection = content.match(/^on:\n([\s\S]*?)(?=^jobs:|^permissions:|^\w|\Z)/m);
        if (onSection) {
          const triggerMatches = onSection[1].match(/^  (\w+)(?::\n|:|\Z)/gm);
          if (triggerMatches) {
            for (const t of triggerMatches) {
              triggers.add(t.replace(/^  /, '').replace(/:.*/, ''));
            }
          }
        }
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

function detectEnvConfig(repoPath) {
  const envFiles = [];

  for (const name of ['.env', '.env.local', '.env.development', '.env.production', '.env.test', '.env.staging', '.env.example', '.env.sample']) {
    const path = join(repoPath, name);
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, 'utf-8');
        const varCount = content.split('\n').filter((l) => /^\s*[A-Z_][A-Z0-9_]*\s*=/.test(l)).length;
        envFiles.push({ file: name, varCount });
      } catch {}
    }
  }

  const hasConfigDir = existsSync(join(repoPath, 'config'));
  const hasAppConfig = existsSync(join(repoPath, 'app.config.js')) ||
    existsSync(join(repoPath, 'app.config.ts')) ||
    existsSync(join(repoPath, 'config.js')) ||
    existsSync(join(repoPath, 'config.ts')) ||
    existsSync(join(repoPath, 'configuration.ts'));

  return { envFiles, configDir: hasConfigDir, appConfigFile: hasAppConfig };
}

function detectHealthChecks(repoPath) {
  const checks = [];

  const healthRefs = safeExec(
    "rg -n '(healthcheck|health[_\\-]?check|readiness[_\\-]?probe|liveness[_\\-]?probe|/health\\b|/ready\\b|/live\\b|/ping\\b)' --glob '!node_modules' --glob '!.git' --glob '!dist' --glob '!build' 2>/dev/null | head -20",
    repoPath, ''
  );

  if (healthRefs) {
    checks.push(...healthRefs.split('\n').filter(Boolean).slice(0, 10));
  }

  return {
    detected: checks.length > 0,
    references: checks,
  };
}

function detectGracefulShutdown(repoPath) {
  const patterns = [
    { name: 'SIGTERM handler', re: /(?:SIGTERM|SIGINT|SIGQUIT)/ },
    { name: 'BeforeExit', re: /beforeExit/ },
    { name: 'Graceful close', re: /graceful[_\-]?(?:shutdown|close|exit)/i },
    { name: 'Process exit handler', re: /process\.on\([\'"]exit[\'"]/ },
    { name: 'Server close', re: /server\.close\(\)/ },
  ];

  const detections = [];
  for (const { name, re } of patterns) {
    try {
      const count = safeExec(`rg -l '${re.source.replace(/'/g, "\\'")}' --glob '!node_modules' --glob '!.git' --glob '!dist' --glob '!build' 2>/dev/null | wc -l`, repoPath, '0');
      const n = parseInt(count.trim(), 10) || 0;
      if (n > 0) {
        detections.push({ pattern: name, fileCount: n });
      }
    } catch {}
  }

  return detections;
}

function detectMonitoring(deps) {
  if (!deps) return { libraries: [], services: [] };

  const monitoringPkgs = {
    winston: 'Winston (logging)',
    pino: 'Pino (logging)',
    bunyan: 'Bunyan (logging)',
    morgan: 'Morgan (HTTP logging)',
    'prom-client': 'Prometheus client',
    prometheus: 'Prometheus',
    '@opentelemetry/api': 'OpenTelemetry',
    '@sentry/node': 'Sentry',
    '@sentry/browser': 'Sentry (browser)',
    sentry: 'Sentry',
    datadog: 'Datadog',
    'dd-trace': 'Datadog APM',
    newrelic: 'New Relic',
    'express-status-monitor': 'Express Status Monitor',
    swagger: 'Swagger',
    'swagger-ui-express': 'Swagger UI',
    'swagger-jsdoc': 'Swagger JSDoc',
    '@nestjs/swagger': 'NestJS Swagger',
  };

  const allDeps = { ...deps.dependencies, ...deps.devDependencies };
  const libraries = [];
  for (const [pkg, label] of Object.entries(monitoringPkgs)) {
    if (allDeps[pkg]) {
      libraries.push({ package: pkg, label });
    }
  }

  return { libraries };
}

export async function scan(repoPath, overview) {
  const pkg = readJSON(join(repoPath, 'package.json'));
  const deps = pkg ? { dependencies: pkg.dependencies || {}, devDependencies: pkg.devDependencies || {} } : null;

  const dockerfiles = analyzeDockerfile(repoPath);
  const dockerCompose = analyzeDockerCompose(repoPath);
  const ci = analyzeCI(repoPath);
  const envConfig = detectEnvConfig(repoPath);

  const hasDockerignore = existsSync(join(repoPath, '.dockerignore'));
  const hasMakefile = existsSync(join(repoPath, 'Makefile')) ||
    existsSync(join(repoPath, 'makefile')) ||
    existsSync(join(repoPath, 'GNUmakefile'));

  const hasDeployScripts = existsSync(join(repoPath, 'deploy')) ||
    existsSync(join(repoPath, 'deploy.sh')) ||
    existsSync(join(repoPath, 'scripts/deploy.sh')) ||
    existsSync(join(repoPath, 'scripts/deploy'));

  const healthChecks = detectHealthChecks(repoPath);
  const gracefulShutdown = detectGracefulShutdown(repoPath);
  const monitoring = detectMonitoring(deps);

  const procfile = join(repoPath, 'Procfile');
  const hasProcfile = existsSync(procfile);

  let procfileContent = null;
  if (hasProcfile) {
    try {
      procfileContent = readFileSync(procfile, 'utf-8');
    } catch {}
  }

  const signal = dockerfiles.length > 0 || (ci?.workflows?.length || 0) > 0 ? 'high' : hasDockerignore ? 'medium' : 'low';

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
      hasDeployScripts,
      healthChecks,
      gracefulShutdown,
      monitoring,
      procfile: hasProcfile ? { content: procfileContent } : null,
    },
  };
}
