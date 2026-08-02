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

function detectSecretPatterns(repoPath) {
  const patterns = [
    { name: 'AWS Access Key', re: /(?:AWS|aws)[_\-]?access[_\-]?key[_\-]?id?["'\s:=]+([A-Z0-9]{20})/ },
    { name: 'AWS Secret Key', re: /(?:AWS|aws)[_\-]?secret[_\-]?(?:access[_\-]?)?key[_\-]?id?["'\s:=]+([A-Za-z0-9\/+=]{40})/ },
    { name: 'GitHub Token', re: /(?:ghp|gho|ghu|ghs|ghr|github[_\-]?pat)[_\-\w]*['"\s:=]+([A-Za-z0-9_]{36,})/ },
    { name: 'Generic API Key', re: /(?:api[_\-]?key|apikey|API_KEY)["'\s:=]+\s*['"]([A-Za-z0-9_\-]{20,})['"]/i },
    { name: 'Generic Token', re: /(?:token|secret|password|passwd)["'\s:=]+\s*['"]([^\s'"]{16,})['"]\s*$/im },
    { name: 'Private Key Header', re: /-----BEGIN[ ](?:RSA |EC |DSA |OPENSSH )?PRIVATE[ ]KEY-----/ },
    { name: 'JWT Token', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
    { name: 'Slack Token', re: /xox[abpos]-[\d]+-[\d]+-[\d]+-[A-Za-z0-9]+/ },
    { name: 'Stripe Key', re: /(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{24,}/ },
    { name: 'Heroku API Key', re: /[Hh][Ee][Rr][Oo][Kk][Uu][_\s-]*[Aa][Pp][Ii][_\s-]*[Kk][Ee][Yy]["'\s:=]+\s*['"]([A-Za-z0-9_-]{16,})['"]/ },
    { name: 'MongoDB URI', re: /mongodb(?:\+srv)?:\/\/[^'"\s]+/i },
    { name: 'Postgres URI', re: /postgres(?:ql)?:\/\/[^:]+:[^@]+@[^'"\s]+/i },
    { name: 'Redis URI', re: /redis:\/\/[^'"\s]+/i },
    { name: 'Basic Auth URL', re: /https?:\/\/[^:]+:[^@]+@[^'"\s]+/i },
    { name: 'NPM Token', re: /npm_[A-Za-z0-9]{36}/ },
    { name: 'Docker Registry Password', re: /(?:docker|registry)[_\s-]*(?:password|pass|pwd)["'\s:=]+\s*['"]([^'"]{8,})['"]/i },
  ];

  const findings = [];
  const ignoreDirs = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__', 'target', 'vendor', '.venv', 'venv'];

  for (const { name, re } of patterns) {
    try {
      const globs = ignoreDirs.map((d) => `--glob '!${d}'`).join(' ');
      const out = safeExec(`rg -n --no-heading -l '${re.source.replace(/'/g, "\\'")}' ${globs} 2>/dev/null`, repoPath);
      if (out) {
        const files = out.split('\n').filter(Boolean);
        const sample = files.slice(0, 3).map((f) => f.replace(repoPath + '/', ''));
        findings.push({ pattern: name, files: sample, totalFiles: files.length });
      }
    } catch {}
  }

  return findings;
}

function detectAuthFramework(deps) {
  if (!deps) return { detected: false, frameworks: [] };
  const authPkgs = {
    passport: 'Passport.js',
    'next-auth': 'NextAuth.js',
    '@auth/core': 'Auth.js',
    'express-session': 'Express Session',
    'cookie-parser': 'Cookie-based auth',
    jsonwebtoken: 'JWT (jsonwebtoken)',
    'jose': 'JWT (jose)',
    'bcrypt': 'bcrypt hashing',
    'bcryptjs': 'bcrypt hashing',
    argon2: 'Argon2 hashing',
    oauth: 'OAuth',
    'simple-oauth2': 'OAuth2',
    'grant': 'Grant OAuth',
    'express-openid-connect': 'OpenID Connect',
    'openid-client': 'OpenID Client',
    clerk: 'Clerk',
    '@clerk': 'Clerk',
    'auth0': 'Auth0',
    'kinde': 'Kinde',
    firebase: 'Firebase Auth',
    'firebase-admin': 'Firebase Admin',
    supabase: 'Supabase Auth',
    '@supabase': 'Supabase',
    'connect-pg-simple': 'Session store (PostgreSQL)',
    'connect-redis': 'Session store (Redis)',
    'express-rate-limit': 'Rate limiting',
  };

  const allDeps = { ...deps.dependencies, ...deps.devDependencies };
  const frameworks = [];
  for (const [pkg, label] of Object.entries(authPkgs)) {
    if (allDeps[pkg]) {
      frameworks.push({ package: pkg, label });
    }
  }

  return { detected: frameworks.length > 0, frameworks };
}

function detectSecurityHeaders(repoPath) {
  const patterns = [
    { name: 'CORS', re: /(?:cors|Access-Control-Allow-Origin)/i },
    { name: 'CSP', re: /Content-Security-Policy/i },
    { name: 'HSTS', re: /Strict-Transport-Security/i },
    { name: 'XSS Protection', re: /X-XSS-Protection/i },
    { name: 'Frame Options', re: /X-Frame-Options/i },
    { name: 'Content Type Options', re: /X-Content-Type-Options/i },
    { name: 'Helmet.js', re: /helmet/i },
  ];

  const detections = [];
  for (const { name, re } of patterns) {
    try {
      const out = safeExec(`rg -l '${re.source}' --glob '!node_modules' --glob '!.git' --glob '!dist' --glob '!build' 2>/dev/null | wc -l`, repoPath, '0');
      const count = parseInt(out.trim(), 10) || 0;
      if (count > 0) {
        detections.push({ name, fileCount: count });
      }
    } catch {}
  }

  return detections;
}

function detectInputValidation(deps) {
  if (!deps) return { detected: false, libraries: [] };
  const validationPkgs = {
    zod: 'Zod',
    joi: 'Joi',
    yup: 'Yup',
    'class-validator': 'class-validator',
    '@vinejs/vine': 'VineJS',
    'ajv': 'AJV (JSON Schema)',
    'superstruct': 'Superstruct',
    'io-ts': 'io-ts',
    'runtypes': 'Runtypes',
    'typebox': 'TypeBox',
    'valibot': 'Valibot',
    'express-validator': 'express-validator',
    'celebrate': 'Celebrate (Joi + Express)',
    'ow': 'ow',
  };

  const allDeps = { ...deps.dependencies, ...deps.devDependencies };
  const libraries = [];
  for (const [pkg, label] of Object.entries(validationPkgs)) {
    if (allDeps[pkg]) {
      libraries.push({ package: pkg, label });
    }
  }

  return { detected: libraries.length > 0, libraries };
}

function detectRateLimiting(repoPath, deps) {
  const directDeps = [];
  const rateLimitPkgs = {
    'express-rate-limit': 'express-rate-limit',
    'rate-limiter-flexible': 'rate-limiter-flexible',
    'bottleneck': 'Bottleneck',
    '@upstash/ratelimit': 'Upstash Rate Limit',
    'limiter': 'limiter',
    'p-limit': 'p-limit (concurrency)',
    'fast-ratelimit': 'fast-ratelimit',
  };

  if (deps) {
    const allDeps = { ...deps.dependencies, ...deps.devDependencies };
    for (const [pkg, label] of Object.entries(rateLimitPkgs)) {
      if (allDeps[pkg]) {
        directDeps.push({ package: pkg, label });
      }
    }
  }

  const codeRefs = safeExec(
    "rg -l 'rate[_\\-]?limit|throttle|debounce' --glob '!node_modules' --glob '!.git' --glob '!dist' --glob '!build' 2>/dev/null | wc -l",
    repoPath, '0'
  ).trim();

  return {
    detected: directDeps.length > 0 || (parseInt(codeRefs, 10) || 0) > 0,
    libraries: directDeps,
    codeReferences: parseInt(codeRefs, 10) || 0,
  };
}

export async function scan(repoPath, overview) {
  const pkg = readJSON(join(repoPath, 'package.json'));
  const deps = pkg ? { dependencies: pkg.dependencies || {}, devDependencies: pkg.devDependencies || {} } : null;

  const secrets = detectSecretPatterns(repoPath);
  const auth = detectAuthFramework(deps);
  const secHeaders = detectSecurityHeaders(repoPath);
  const validation = detectInputValidation(deps);
  const rateLimit = detectRateLimiting(repoPath, deps);

  const envExample = existsSync(join(repoPath, '.env.example')) ||
    existsSync(join(repoPath, '.env.sample')) ||
    existsSync(join(repoPath, '.env.template'));

  const gitignore = existsSync(join(repoPath, '.gitignore'));
  let gitignoreCoversEnv = false;
  if (gitignore) {
    try {
      const content = readFileSync(join(repoPath, '.gitignore'), 'utf-8');
      gitignoreCoversEnv = /\.env/.test(content);
    } catch {}
  }

  const hasLockfile = existsSync(join(repoPath, 'package-lock.json')) ||
    existsSync(join(repoPath, 'yarn.lock')) ||
    existsSync(join(repoPath, 'pnpm-lock.yaml')) ||
    existsSync(join(repoPath, 'Cargo.lock')) ||
    existsSync(join(repoPath, 'Gemfile.lock')) ||
    existsSync(join(repoPath, 'poetry.lock'));

  const hasAuditScript = pkg?.scripts
    ? Object.values(pkg.scripts).some((s) => /\b(audit|snyk|npm audit|yarn audit|cargo audit)\b/.test(s))
    : false;

  const dependabot = existsSync(join(repoPath, '.github/dependabot.yml')) ||
    existsSync(join(repoPath, '.github/dependabot.yaml'));

  const signal = secrets.length > 0 || auth.detected ? 'high' : hasLockfile ? 'medium' : 'low';

  return {
    dimension: 'security',
    signal,
    findings: {
      secrets: {
        count: secrets.length,
        findings: secrets,
      },
      auth,
      securityHeaders: secHeaders,
      inputValidation: validation,
      rateLimiting: rateLimit,
      envExample,
      gitignoreEnvProtected: gitignoreCoversEnv,
      hasLockfile,
      hasAuditScript,
      dependabot,
    },
  };
}
