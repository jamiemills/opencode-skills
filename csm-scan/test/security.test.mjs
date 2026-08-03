import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { withFixture, surveyOverview } from './harness.mjs';
import { scan } from '../lib/scan/deep/security.mjs';
import { files as pythonFiles } from './fixtures/python.mjs';
import { files as jsFiles } from './fixtures/javascript.mjs';
import { files as rustFiles } from './fixtures/rust.mjs';

const PERPLEXITY_CLI = '/home/jamiemills/code/projects/perplexity-cli';

// Python fixture extended with the security artifacts the overhaul must recognize.
function pythonFixtureWithSecurity() {
  const pyproject = pythonFiles['pyproject.toml'].replace(
    'dependencies = ["click", "rich"]',
    'dependencies = ["click", "rich", "pydantic>=2.4"]',
  );
  return {
    ...pythonFiles,
    'pyproject.toml': pyproject,
    'uv.lock': 'version = 1\n[[package]]\nname = "demo"\nversion = "0.1.0"\n',
    'SECURITY.md': '# Security Policy\n\nReport vulnerabilities to security@example.com\n',
    '.gitleaks.toml': 'title = "demo"\n[allowlist]\nregexes = []\n',
  };
}

// Python fixture that exercises BOTH a validation lib (pydantic) and an auth
// lib (flask-login) sourced from shared/detection.mjs AUTH_LIBS.python /
// INPUT_VALIDATION_LIBS.python — proving the maps surface Python auth, not just
// JS auth.
function pythonFixtureWithAuthValidation() {
  const pyproject = pythonFiles['pyproject.toml'].replace(
    'dependencies = ["click", "rich"]',
    'dependencies = ["click", "rich", "pydantic>=2.4", "flask-login>=0.6"]',
  );
  return { ...pythonFiles, 'pyproject.toml': pyproject };
}

// Rust fixture exercising argon2 (auth/hashing) + validator (input validation)
// sourced from shared/detection.mjs AUTH_LIBS.rust / INPUT_VALIDATION_LIBS.rust
// — proving the maps surface Rust, not just JS/Python.
function rustFixtureWithSecurity() {
  const cargo = rustFiles['Cargo.toml'].replace(
    'serde = { version = "1", features = ["derive"] }',
    'serde = { version = "1", features = ["derive"] }\nargon2 = "0.5"\nvalidator = { version = "0.16", features = ["derive"] }',
  );
  return { ...rustFiles, 'Cargo.toml': cargo };
}

// JS fixture with auth libraries added (the shared fixture has none).
function jsFixtureWithAuth() {
  const pkgJson = JSON.stringify({
    name: 'demo',
    version: '0.1.0',
    type: 'module',
    main: 'src/index.js',
    dependencies: {
      express: '^4.18.0',
      passport: '^0.7.0',
      jsonwebtoken: '^9.0.0',
    },
    devDependencies: { jest: '^29.0.0' },
    scripts: { test: 'jest' },
  }, null, 2) + '\n';
  return { ...jsFiles, 'package.json': pkgJson };
}

test('security: python fixture recognizes uv.lock + SECURITY.md + .gitleaks.toml + pydantic', async () => {
  await withFixture('py-sec', pythonFixtureWithSecurity(), async (dir) => {
    const overview = await surveyOverview(dir);
    const res = await scan(dir, overview);
    const f = res.findings;

    assert.equal(res.dimension, 'security');
    assert.equal(f.hasLockfile, true, `hasLockfile must be true for uv.lock, got ${f.hasLockfile}`);
    assert.ok(
      f.securityTools.includes('SECURITY.md'),
      `securityTools must include SECURITY.md: ${JSON.stringify(f.securityTools)}`,
    );
    assert.ok(
      f.securityTools.includes('.gitleaks.toml'),
      `securityTools must include .gitleaks.toml: ${JSON.stringify(f.securityTools)}`,
    );

    assert.ok(f.inputValidation.detected, 'inputValidation should be detected via pydantic');
    assert.ok(
      f.inputValidation.libraries.some((l) => l.label === 'Pydantic'),
      `expected Pydantic in libraries: ${JSON.stringify(f.inputValidation.libraries)}`,
    );

    // Recognized lockfile lifts signal to at least 'medium'.
    assert.ok(
      ['medium', 'high'].includes(res.signal),
      `signal should be >= medium with a lockfile, got ${res.signal}`,
    );
  });
});

test('security: python fixture with pydantic + flask-login detects validation + auth', async () => {
  await withFixture('py-authval', pythonFixtureWithAuthValidation(), async (dir) => {
    const overview = await surveyOverview(dir);
    const res = await scan(dir, overview);
    const f = res.findings;

    assert.ok(
      f.inputValidation.detected,
      `inputValidation should be detected via pydantic: ${JSON.stringify(f.inputValidation)}`,
    );
    assert.ok(
      f.inputValidation.libraries.some((l) => l.label === 'Pydantic'),
      `expected Pydantic: ${JSON.stringify(f.inputValidation.libraries)}`,
    );

    // Python auth now surfaces via shared/detection.mjs AUTH_LIBS.python
    // (previously JS-only inline map).
    assert.ok(
      f.auth.detected,
      `auth should be detected via flask-login: ${JSON.stringify(f.auth)}`,
    );
    assert.ok(
      f.auth.frameworks.some((x) => x.label === 'Flask-Login'),
      `expected Flask-Login: ${JSON.stringify(f.auth.frameworks)}`,
    );
    assert.ok(
      f.auth.frameworks.some((x) => x.package === 'flask-login'),
      `expected flask-login package: ${JSON.stringify(f.auth.frameworks)}`,
    );
  });
});

test('security: Rust fixture with argon2 + validator detects auth + inputValidation', async () => {
  await withFixture('rust-sec', rustFixtureWithSecurity(), async (dir) => {
    const overview = await surveyOverview(dir);
    const res = await scan(dir, overview);
    const f = res.findings;

    // Rust auth/validation now surfaces via shared/detection.mjs AUTH_LIBS.rust
    // / INPUT_VALIDATION_LIBS.rust (previously JS/Python-only inline maps).
    assert.ok(
      f.auth.detected,
      `auth should be detected via argon2: ${JSON.stringify(f.auth)}`,
    );
    assert.ok(
      f.auth.frameworks.some((x) => x.package === 'argon2'),
      `expected argon2 in frameworks: ${JSON.stringify(f.auth.frameworks)}`,
    );

    assert.ok(
      f.inputValidation.detected,
      `inputValidation should be detected via validator: ${JSON.stringify(f.inputValidation)}`,
    );
    assert.ok(
      f.inputValidation.libraries.some((x) => x.package === 'validator'),
      `expected validator in libraries: ${JSON.stringify(f.inputValidation.libraries)}`,
    );
  });
});

test('security: JS fixture still detects its JS auth libs (no regression)', async () => {
  await withFixture('js-auth', jsFixtureWithAuth(), async (dir) => {
    const overview = await surveyOverview(dir);
    const res = await scan(dir, overview);
    const f = res.findings;

    assert.ok(f.auth.detected, `auth should be detected: ${JSON.stringify(f.auth)}`);
    const pkgs = f.auth.frameworks.map((x) => x.package);
    assert.ok(pkgs.includes('passport'), `expected passport: ${JSON.stringify(f.auth.frameworks)}`);
    assert.ok(pkgs.includes('jsonwebtoken'), `expected jsonwebtoken: ${JSON.stringify(f.auth.frameworks)}`);
  });
});

test('security: dependency-only Python fixture reports declared dependency evidence without a package script', async () => {
  const pyproject = pythonFiles['pyproject.toml'].replace(
    'dependencies = ["click", "rich"]',
    'dependencies = ["click", "rich", "pip-audit"]',
  );
  await withFixture('py-audit-dep', { ...pythonFiles, 'pyproject.toml': pyproject }, async (dir) => {
    const res = await scan(dir, await surveyOverview(dir));

    assert.deepEqual(res.findings.auditEvidence, [
      { source: 'dependency', location: 'manifest', tool: 'pip-audit' },
    ]);
    assert.equal(res.findings.hasAuditScript, true);
    assert.ok(!existsSync(`${dir}/package.json`), 'fixture must not contain package.json');
  });
});

test('security: package script reports its exact name, location, and matched tool text', async () => {
  const pkg = JSON.stringify({
    name: 'audit-script',
    scripts: { audit: 'npm audit --audit-level=high' },
  });
  await withFixture('js-audit-script', { 'package.json': pkg }, async (dir) => {
    const res = await scan(dir, await surveyOverview(dir));

    assert.deepEqual(res.findings.auditEvidence, [
      { source: 'package-script', location: 'package.json#scripts.audit', tool: 'npm audit' },
    ]);
    assert.equal(res.findings.hasAuditScript, true);
  });
});

test('security: workflow and Makefile audit references retain exact source paths and tool tokens', async () => {
  const files = {
    'pyproject.toml': '[project]\nname = "references"\nversion = "0.1.0"\n',
    'Makefile': 'security:\n\tbandit -r src\n',
    '.github/workflows/security.yml': 'name: Security\njobs:\n  scan:\n    steps:\n      - uses: gitleaks/gitleaks-action@v2\n',
  };
  await withFixture('audit-refs', files, async (dir) => {
    const res = await scan(dir, await surveyOverview(dir));

    assert.deepEqual(res.findings.auditEvidence, [
      { source: 'makefile', location: 'Makefile', tool: 'bandit' },
      { source: 'workflow', location: '.github/workflows/security.yml', tool: 'gitleaks' },
    ]);
    assert.equal(res.findings.hasAuditScript, true);
  });
});

test('security: findings preserve the write.mjs contract keys and add securityTools', async () => {
  await withFixture('contract', pythonFixtureWithSecurity(), async (dir) => {
    const overview = await surveyOverview(dir);
    const res = await scan(dir, overview);

    const expected = [
      'secrets', 'auth', 'securityHeaders', 'inputValidation', 'rateLimiting',
      'envExample', 'gitignoreEnvProtected', 'hasLockfile', 'auditEvidence', 'hasAuditScript',
      'dependabot', 'securityTools',
    ];
    for (const k of expected) {
      assert.ok(k in res.findings, `missing finding key '${k}' in: ${JSON.stringify(Object.keys(res.findings))}`);
    }
    assert.ok(Array.isArray(res.findings.securityTools), 'securityTools must be an array');
    assert.ok(Array.isArray(res.findings.auditEvidence), 'auditEvidence must be an array');
    assert.equal(typeof res.findings.hasLockfile, 'boolean');
    assert.equal(typeof res.findings.hasAuditScript, 'boolean');
    // Each framework/library entry keeps the {package,label} shape write.mjs reads.
    for (const fw of res.findings.auth.frameworks) {
      assert.equal(typeof fw.package, 'string');
      assert.equal(typeof fw.label, 'string');
    }
  });
});

test('security: lockfile extensions — yarn.lock / Cargo.lock / poetry.lock / bun.lock / pdm.lock recognized', async () => {
  for (const lockfile of ['yarn.lock', 'Cargo.lock', 'poetry.lock', 'pnpm-lock.yaml', 'bun.lock', 'pdm.lock']) {
    await withFixture(`lock-${lockfile}`, { ...jsFiles, [lockfile]: '# lock\n' }, async (dir) => {
      const overview = await surveyOverview(dir);
      const res = await scan(dir, overview);
      assert.equal(
        res.findings.hasLockfile, true,
        `${lockfile} should be recognized as a lockfile`,
      );
    });
  }
});

test('security: real perplexity-cli -> uv.lock + gitleaks + SECURITY.md, pydantic validation + bandit/pip-audit', {
  skip: !existsSync(PERPLEXITY_CLI) ? 'perplexity-cli repo not present' : undefined,
}, async () => {
  const overview = await surveyOverview(PERPLEXITY_CLI);
  const res = await scan(PERPLEXITY_CLI, overview);
  const f = res.findings;

  assert.equal(f.hasLockfile, true, `perplexity-cli must have uv.lock, got hasLockfile=${f.hasLockfile}`);
  assert.ok(
    f.securityTools.some((t) => t.includes('gitleaks')),
    `expected a gitleaks artifact: ${JSON.stringify(f.securityTools)}`,
  );
  assert.ok(
    f.securityTools.includes('SECURITY.md'),
    `expected SECURITY.md: ${JSON.stringify(f.securityTools)}`,
  );

  // pydantic is a runtime dep -> inputValidation detected.
  assert.ok(f.inputValidation.detected, 'pydantic validation expected');
  assert.ok(
    f.inputValidation.libraries.some((l) => l.label === 'Pydantic'),
    `expected Pydantic: ${JSON.stringify(f.inputValidation.libraries)}`,
  );

  // bandit + pip-audit are dev tools (optional-dependencies.dev /
  // PEP 735 [dependency-groups].dev) now visible via the normalized manifest.
  assert.ok(
    f.securityTools.includes('bandit config'),
    `expected bandit config: ${JSON.stringify(f.securityTools)}`,
  );
  assert.ok(
    f.securityTools.includes('pip-audit'),
    `expected pip-audit via devDeps: ${JSON.stringify(f.securityTools)}`,
  );
  assert.equal(f.hasAuditScript, true, 'audit tooling (pip-audit) implies hasAuditScript');
  assert.ok(
    f.auditEvidence.some((e) => e.source === 'dependency' && e.tool === 'pip-audit'),
    `expected pip-audit dependency evidence: ${JSON.stringify(f.auditEvidence)}`,
  );
  assert.equal(f.hasAuditScript, f.auditEvidence.length > 0);

  // Informational: report what was found for the acceptance evidence.
  console.log('  perplexity-cli signal:', res.signal);
  console.log('  perplexity-cli hasLockfile:', f.hasLockfile);
  console.log('  perplexity-cli securityTools:', JSON.stringify(f.securityTools));
  console.log('  perplexity-cli auth:', JSON.stringify(f.auth.frameworks));
  console.log('  perplexity-cli inputValidation:', JSON.stringify(f.inputValidation.libraries));
  console.log('  perplexity-cli hasAuditScript:', f.hasAuditScript);
  console.log('  perplexity-cli auditEvidence:', JSON.stringify(f.auditEvidence));
});
