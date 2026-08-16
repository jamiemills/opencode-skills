import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { withFixture, surveyOverview, makeFixture, cleanupFixture } from './harness.mjs';
import { createRecordingRunner } from './helpers/recording-runner.mjs';
import { resolveRealRepo } from './helpers/real-repo.mjs';
import { createCommandBroker } from '../lib/scan/shared/command.mjs';
import { scan } from '../lib/scan/deep/security.mjs';
import { renderSecurity } from '../lib/scan/render/security.mjs';
import { runExpandedPipeline } from '../lib/scan/pipeline/run.mjs';
import { files as pythonFiles } from './fixtures/python.mjs';
import { files as jsFiles } from './fixtures/javascript.mjs';
import { files as rustFiles } from './fixtures/rust.mjs';
import { files as binariesOnlyFiles } from './fixtures/binaries.mjs';
import { files as crlfBomFiles } from './fixtures/crlf-bom.mjs';

const execFileAsync = promisify(execFile);

// T010 (F-007): CSM_SCAN_REAL_REPO when set, otherwise the checked-in
// pxcli-mini fallback fixture (uv.lock + .gitleaks.toml + SECURITY.md,
// pydantic dependency, bandit + pip-audit dev tooling).
const RESOLVED_REAL_REPO = resolveRealRepo();
const PERPLEXITY_CLI = RESOLVED_REAL_REPO.repo;

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
      'dependabot', 'securityTools', 'scanCoverage',
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

test('security: dependabot branch evidence — recording broker with dependabot/* branches reports inferred', async () => {
  const branchList = [
    '* master',
    '  remotes/origin/master',
    '  remotes/origin/dependabot/uv/httpx-1.0',
    '  dependabot/uv/pydantic-2.0',
    '  remotes/origin/dependabot/uv/pydantic-2.0',
    '',
  ].join('\n');
  const { calls, run } = createRecordingRunner((call) => {
    assert.equal(call.shell, false, 'broker calls must never request shell mode');
    if (call.executable === 'rg') {
      return { status: 0, stdout: 'pyproject.toml\n', stderr: '' };
    }
    if (call.executable === 'git' && call.argv.join(' ') === 'branch -a') {
      return { status: 0, stdout: branchList, stderr: '' };
    }
    return { status: 1, stdout: '', stderr: 'unexpected' };
  });
  const broker = createCommandBroker({ runner: { run } });

  await withFixture('sec-dep-branches', {
    'pyproject.toml': '[project]\nname = "demo"\nversion = "0.1.0"\n',
  }, async (dir) => {
    const overview = { files: ['pyproject.toml'] };
    const res = await scan(dir, overview, broker);
    const f = res.findings;

    assert.equal(f.dependabot, false, 'dependabot must remain not configured');
    assert.equal(f.dependabotEvidence.status, 'inferred');
    assert.ok(
      f.dependabotEvidence.branches.includes('dependabot/uv/httpx-1.0'),
      `expected branch evidence: ${JSON.stringify(f.dependabotEvidence.branches)}`,
    );
    assert.ok(
      f.dependabotEvidence.branches.includes('dependabot/uv/pydantic-2.0'),
      'local and remote dependabot branches of the same name must collapse into one entry',
    );
    assert.equal(f.dependabotEvidence.branchCount, 2);

    const rendered = renderSecurity('repo', f);
    assert.match(rendered, /Dependabot.*not configured \(no \.github\/dependabot\.yml\); dependabot\/\* branches present/);
    assert.ok(calls.some((call) => call.executable === 'git' && call.argv.join(' ') === 'branch -a'),
      'security must issue git:branch-list via the broker');
  });
});

test('security: dependabot — no dependabot/* branches keeps the current not-configured fact', async () => {
  const { run } = createRecordingRunner((call) => {
    if (call.executable === 'git' && call.argv.join(' ') === 'branch -a') {
      return { status: 0, stdout: '* master\n  remotes/origin/main\n', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  });
  const broker = createCommandBroker({ runner: { run } });

  await withFixture('sec-dep-nobranches', {
    'pyproject.toml': '[project]\nname = "demo"\nversion = "0.1.0"\n',
  }, async (dir) => {
    const overview = { files: ['pyproject.toml'] };
    const res = await scan(dir, overview, broker);
    const f = res.findings;
    assert.equal(f.dependabot, false);
    assert.equal(f.dependabotEvidence.status, 'not-configured');
    assert.equal(f.dependabotEvidence.branchCount, 0);
    assert.match(renderSecurity('repo', f), /Dependabot.*not configured/);
  });
});

test('security: dependabot — capped/truncated broker result emits unverified for the branch fact', async () => {
  const { run } = createRecordingRunner((call) => {
    if (call.executable === 'git' && call.argv.join(' ') === 'branch -a') {
      return { status: 1, stdout: '', stderr: 'fatal: could not read refs' };
    }
    return { status: 0, stdout: '', stderr: '' };
  });
  const broker = createCommandBroker({ runner: { run } });

  await withFixture('sec-dep-unverified', {
    'pyproject.toml': '[project]\nname = "demo"\nversion = "0.1.0"\n',
  }, async (dir) => {
    const overview = { files: ['pyproject.toml'] };
    const res = await scan(dir, overview, broker);
    const f = res.findings;
    assert.equal(f.dependabot, false);
    assert.equal(f.dependabotEvidence.status, 'unverified');
    assert.equal(f.dependabotEvidence.branchCount, 0);
    assert.match(renderSecurity('repo', f), /Dependabot.*branch evidence unverified/);
  });
});

test('security: first-party auth subsystem detected from auth/token/oauth module clusters', async () => {
  const files = {
    'pyproject.toml': '[project]\nname = "demo"\nversion = "0.1.0"\ndependencies = ["click", "rich"]\n',
    'src/demo/__init__.py': '',
    'src/demo/auth/__init__.py': '',
    'src/demo/auth/oauth_handler.py': 'def start():\n    return None\n',
    'src/demo/auth/token_manager.py': 'def issue_token():\n    return None\n',
    'src/demo/utils/session_factory.py': 'def create():\n    return None\n',
    'src/demo/utils/encryption.py': 'def encrypt(data):\n    return data\n',
    'src/demo/utils/cookies.py': 'def read():\n    return None\n',
  };
  await withFixture('sec-firstparty-auth', files, async (dir) => {
    const overview = { files: Object.keys(files) };
    const res = await scan(dir, overview);
    const f = res.findings;

    assert.equal(f.auth.detected, false, 'no third-party auth library in fixture');
    assert.ok(
      f.auth.firstParty.detected,
      `expected first-party auth subsystem: ${JSON.stringify(f.auth.firstParty)}`,
    );
    assert.deepEqual(
      f.auth.firstParty.clusters,
      ['auth', 'cookies', 'encryption', 'oauth', 'session', 'token'],
      `expected all cluster names: ${JSON.stringify(f.auth.firstParty.clusters)}`,
    );

    const rendered = renderSecurity('repo', f);
    assert.match(
      rendered,
      /Authentication.*no third-party auth library; first-party auth subsystem present \(auth, cookies, encryption, oauth, session, token\)/,
    );
  });
});

test('security: gitleaks context — allowlist paths, stopwords, ignore count, fixture-allowlisted findings', async () => {
  const files = {
    'pyproject.toml': '[project]\nname = "demo"\nversion = "0.1.0"\n',
    '.gitleaks.toml': [
      'title = "demo"',
      '',
      '[allowlist]',
      'paths = [',
      "  '''^tests/fixtures/gitleaks/secrets_test_data\\.txt$''',",
      "  '''^tests/fixtures/gitleaks/secret-repo-setup\\.sh$''',",
      ']',
      'stopwords = [',
      "  '''__mutmut_''',",
      ']',
      '',
    ].join('\n'),
    '.gitleaksignore': [
      '# revoked historical token',
      'b05b560e8816cb87513d96fb654934426db68dcc:.claudeCode/PHASE2_TEST_REPORT.md:generic-api-key:34',
      '',
    ].join('\n'),
    'tests/fixtures/gitleaks/secrets_test_data.txt': '-----BEGIN RSA PRIVATE\x20KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE\x20KEY-----\n',
  };
  await withFixture('sec-gitleaks', files, async (dir) => {
    const overview = { files: Object.keys(files) };
    const res = await scan(dir, overview);
    const f = res.findings;

    assert.equal(f.gitleaks.configPresent, true);
    assert.equal(f.gitleaks.allowlistPathCount, 2);
    assert.equal(f.gitleaks.stopwordCount, 1);
    assert.equal(f.gitleaks.ignorePresent, true);
    assert.equal(f.gitleaks.ignoreEntryCount, 1);
    assert.ok(
      f.gitleaks.fixtureAllowlisted.includes('Private Key Header'),
      `expected fixture-allowlisted Private Key Header: ${JSON.stringify(f.gitleaks.fixtureAllowlisted)}`,
    );

    const rendered = renderSecurity('repo', f);
    assert.match(rendered, /Gitleaks context.*\.gitleaks\.toml present/);
    assert.match(rendered, /Fixture-allowlisted pattern\(s\): Private Key Header/);
  });
});

test('security: AWS key regex matches UPPER and lower env-var forms, never prose (F-003)', async () => {
  const files = {
    'ci.env': 'AWS_ACCESS_KEY_ID=AKIA\x49OSFODNN7EXAMPLE\n',
    'conf.env': 'aws_access_key_id=AKIA\x49OSFODNN7EXAMPLE\n',
    'secret.env': 'aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n',
    'docs.md': 'The AWS access key ID management guide explains rotation policies in prose.\n',
  };
  await withFixture('sec-aws-case', files, async (dir) => {
    const res = await scan(dir, { files: Object.keys(files) });
    const f = res.findings;

    const access = f.secrets.findings.find((s) => s.pattern === 'AWS Access Key');
    assert.ok(access, `uppercase/lowercase access-key forms must both be detected: ${JSON.stringify(f.secrets)}`);
    assert.equal(access.totalFiles, 2, 'ci.env and conf.env both match');

    const secret = f.secrets.findings.find((s) => s.pattern === 'AWS Secret Key');
    assert.ok(secret, `lowercase aws_secret_access_key must be detected: ${JSON.stringify(f.secrets)}`);
    assert.deepEqual(secret.files, ['secret.env']);

    // The exact-case value group keeps prose from matching.
    for (const finding of f.secrets.findings) {
      assert.ok(!finding.files.includes('docs.md'), `prose must never match: ${JSON.stringify(finding)}`);
    }
  });
});

test('security: >400-file window prioritizes config files and discloses the truncation (F-002)', async () => {
  const files = {};
  for (let i = 0; i < 410; i++) files[`filler-${String(i).padStart(3, '0')}.txt`] = 'placeholder content\n';
  files['zzz-prod.env'] = 'AWS_ACCESS_KEY_ID=AKIA\x49OSFODNN7EXAMPLE\n';
  await withFixture('sec-window', files, async (dir) => {
    const overview = await surveyOverview(dir);
    assert.equal(overview.files.length, 411);

    const res = await scan(dir, overview);
    const access = res.findings.secrets.findings.find((s) => s.pattern === 'AWS Access Key');
    assert.ok(
      access,
      `the config file at the alphabetical end must land inside the prioritized window: ${JSON.stringify(res.findings.secrets)}`,
    );
    assert.deepEqual(access.files, ['zzz-prod.env']);

    assert.equal(res.findings.scanCoverage.scannedFiles, 400, 'cap is kept for DoS protection');
    assert.equal(res.findings.scanCoverage.filesSkipped, 11, 'truncation must be disclosed');

    // R3: the truncation disclosure renders as the stable scan-coverage caveat.
    assert.match(
      renderSecurity('repo', res.findings),
      /- \*\*Scan coverage\*\*: 400 of 411 visible file\(s\) scanned; \d+ hidden file\(s\) scanned; hidden enumeration OK/,
    );
  });
});

test('security: scan-coverage caveat renders exact wording and stays absent without truncation (R3)', () => {
  const truncated = renderSecurity('repo', {
    secrets: { count: 0, findings: [] },
    scanCoverage: { scannedFiles: 400, filesSkipped: 5, hiddenScanned: 11, hiddenFilesSkipped: 0 },
  });
  assert.match(
    truncated,
    /^- \*\*Scan coverage\*\*: 400 of 405 visible file\(s\) scanned; 11 hidden file\(s\) scanned; hidden enumeration OK$/m,
  );

  const hiddenFailed = renderSecurity('repo', {
    secrets: { count: 0, findings: [] },
    scanCoverage: { scannedFiles: 10, filesSkipped: 0, hiddenScanned: 0, hiddenFilesSkipped: 0, hiddenEnumerationFailed: true },
  });
  assert.match(
    hiddenFailed,
    /^- \*\*Scan coverage\*\*: 10 of 10 visible file\(s\) scanned; 0 hidden file\(s\) scanned; hidden enumeration FAILED$/m,
  );

  const complete = renderSecurity('repo', {
    secrets: { count: 0, findings: [] },
    scanCoverage: { scannedFiles: 10, filesSkipped: 0, hiddenScanned: 0, hiddenFilesSkipped: 0 },
  });
  assert.doesNotMatch(complete, /Scan coverage/, 'a fully covered window must not render a caveat');
});

test('security: failed hidden enumeration sets scanCoverage.hiddenEnumerationFailed instead of a silent empty pass (R2/F-018)', async () => {
  // Reuses the enum.test.mjs recording-runner pattern: the visible rg call
  // succeeds while the hidden pass (rg --files --hidden) fails, which must be
  // distinguishable from "no hidden files".
  const { run } = createRecordingRunner((call) => {
    if (call.executable === 'rg') {
      if (call.argv.includes('--hidden')) {
        return { status: 2, stdout: '', stderr: 'rg crashed' };
      }
      return { status: 0, stdout: 'pyproject.toml\n', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  });
  const broker = createCommandBroker({ runner: { run } });

  await withFixture('sec-hidden-enum-fail', {
    'pyproject.toml': '[project]\nname = "demo"\nversion = "0.1.0"\n',
  }, async (dir) => {
    const res = await scan(dir, { files: ['pyproject.toml'] }, broker);
    const coverage = res.findings.scanCoverage;

    assert.equal(coverage.hiddenEnumerationFailed, true, 'a failed hidden pass must be flagged');
    assert.equal(coverage.hiddenScanned, 0);
    assert.match(renderSecurity('repo', res.findings), /hidden enumeration FAILED/);
  });

  // The success path keeps the flag absent: an empty hidden window with a
  // healthy enumeration is "no hidden files", not a failure.
  const { run: okRun } = createRecordingRunner((call) => {
    if (call.executable === 'rg') {
      return { status: 1, stdout: '', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  });
  await withFixture('sec-hidden-enum-ok', {
    'pyproject.toml': '[project]\nname = "demo"\nversion = "0.1.0"\n',
  }, async (dir) => {
    const res = await scan(dir, { files: ['pyproject.toml'] }, createCommandBroker({ runner: { run: okRun } }));
    assert.equal('hiddenEnumerationFailed' in res.findings.scanCoverage, false);
  });
});

test('security: gitignored .env canary detected via the hidden/gitignored pass (F-018)', async () => {
  const files = {
    '.env': 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n',
    '.gitignore': '.env\n',
    'package.json': JSON.stringify({ name: 'hidden-env', version: '0.1.0' }),
  };
  const dir = makeFixture('sec-hidden-env', files);
  try {
    // Best-effort git init so .gitignore is honored by rg; the dotfile
    // alone already keeps .env out of the visible enumeration.
    await execFileAsync('git', ['init', '-q', dir]).catch(() => {});

    const overview = await surveyOverview(dir);
    assert.ok(!overview.files.includes('.env'), `.env must be invisible to the survey enumeration: ${JSON.stringify(overview.files)}`);

    const res = await scan(dir, overview);
    const secret = res.findings.secrets.findings.find((s) => s.pattern === 'AWS Secret Key');
    assert.ok(secret, `gitignored .env canary must be detected by the hidden pass: ${JSON.stringify(res.findings.secrets)}`);
    assert.deepEqual(secret.files, ['.env']);
    assert.ok(res.findings.scanCoverage.hiddenScanned >= 1, 'the hidden pass must be disclosed');
  } finally {
    cleanupFixture(dir);
  }
});

test('security: real perplexity-cli -> uv.lock + gitleaks + SECURITY.md, pydantic validation + bandit/pip-audit', async (t) => {
  if (PERPLEXITY_CLI === null) {
    t.skip(`CSM_SCAN_REAL_REPO is set but does not exist: ${RESOLVED_REAL_REPO.missing}`);
    return;
  }
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

// Adversarial fixtures (T010 gap FIX 2): binary artifacts must never crash
// the secret scan or fabricate matches, and CRLF + UTF-8 BOM encoding must
// never conceal a secret that an LF file would expose.
test('security: binaries-only repository scans clean with honest coverage', async () => {
  await withFixture('sec-binaries', binariesOnlyFiles, async (dir) => {
    const overview = await surveyOverview(dir);
    const res = await scan(dir, overview);
    const f = res.findings;

    assert.equal(f.secrets.count, 0, 'binary artifacts must not produce secret matches');
    assert.deepEqual(f.secrets.findings, []);
    assert.equal(f.auth.detected, false, 'no auth framework is fabricated for binaries');
    assert.equal(f.scanCoverage.scannedFiles, 2, 'the scan discloses the two enumerated files');
    assert.equal(f.scanCoverage.filesSkipped, 0);
  });
});

test('security: CRLF line endings and a UTF-8 BOM never conceal a secret', async () => {
  const TOKEN = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
  const files = {
    ...crlfBomFiles,
    'src/lf-secret.js': `export const a = 'ghp=${TOKEN}';\n`,
    'src/crlf-secret.js': `\uFEFFexport const b = 'ghp=${TOKEN}';\r\n`,
  };

  await withFixture('sec-crlfbom', files, async (dir) => {
    const result = await runExpandedPipeline({ repos: [dir], sink: () => '' });
    const security = result.repos[0].deep.find((entry) => entry.dimension === 'security').findings;

    assert.equal(security.secrets.count, 1, 'the GitHub-token pattern is reported once');
    assert.deepEqual(
      [...security.secrets.findings[0].files].sort(),
      ['src/crlf-secret.js', 'src/lf-secret.js'],
      'the CRLF+BOM file is detected exactly like the LF file — encoding never conceals',
    );
    assert.equal(security.scanCoverage.filesSkipped, 0, 'no source file is skipped');
  });
});
