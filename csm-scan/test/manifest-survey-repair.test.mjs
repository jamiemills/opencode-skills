import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withFixture } from './harness.mjs';
import { readManifest } from '../lib/scan/shared/manifest.mjs';
import { expandRepositoryDirectoryPatterns } from '../lib/scan/shared/glob.mjs';
import { survey } from '../lib/scan/survey.mjs';

const MEMBER_PACKAGE = `[package]
name = "member"
version = "0.1.0"
`;

test('manifest repair: Cargo glob members resolve, exclude, and union all dependency classes', async () => {
  await withFixture('cargo-glob', {
    'Cargo.toml': `[workspace]
members = ["crates/*"]
exclude = ["crates/excluded"]

[dependencies]
root-only = "9"

[dev-dependencies]
root-dev = "9"

[build-dependencies]
root-build = "9"

[workspace.dependencies]
serde = "1.0"
`,
    'crates/alpha/Cargo.toml': `${MEMBER_PACKAGE}
[dependencies]
serde = { workspace = true }
alpha-runtime = "1"

[dev-dependencies]
alpha-dev = "2"

[build-dependencies]
alpha-build = "3"
`,
    'crates/beta/Cargo.toml': `${MEMBER_PACKAGE}
[dependencies]
beta-runtime = { version = "4", features = ["full"] }

[dev-dependencies]
beta-dev = "5"

[build-dependencies]
beta-build = "6"
`,
    'crates/excluded/Cargo.toml': `${MEMBER_PACKAGE}
[dependencies]
excluded-runtime = "7"
`,
  }, async (dir) => {
    const manifest = readManifest(dir);

    assert.deepEqual(manifest.workspace.members, ['crates/*']);
    assert.deepEqual(manifest.workspace.exclude, ['crates/excluded']);
    assert.deepEqual(manifest.workspace.resolvedMembers, ['crates/alpha', 'crates/beta']);
    assert.deepEqual(manifest.dependencies, {
      'root-only': '9',
      serde: '1.0',
      'alpha-runtime': '1',
      'beta-runtime': '4',
    });
    assert.deepEqual(manifest.devDependencies, {
      'root-dev': '9',
      'alpha-dev': '2',
      'beta-dev': '5',
    });
    assert.deepEqual(manifest.buildDependencies, {
      'root-build': '9',
      'alpha-build': '3',
      'beta-build': '6',
    });
    assert.ok(!('excluded-runtime' in manifest.dependencies));
  });
});

test('manifest repair: exact Cargo member remains declared and resolves', async () => {
  await withFixture('cargo-exact', {
    'Cargo.toml': '[workspace]\nmembers = ["tools/cli"]\n',
    'tools/cli/Cargo.toml': `${MEMBER_PACKAGE}\n[dependencies]\nclap = "4"\n`,
  }, async (dir) => {
    const manifest = readManifest(dir);
    assert.deepEqual(manifest.workspace.members, ['tools/cli']);
    assert.deepEqual(manifest.workspace.resolvedMembers, ['tools/cli']);
    assert.equal(manifest.dependencies.clap, '4');
  });
});

test('manifest repair: Cargo classes, ranges, negation, globstar, question, and exclusions resolve safely', async () => {
  const expectedMembers = ['crates/a', 'plugins', 'plugins/deep', 'tools/one'];
  await withFixture('cargo-complex-globs', {
    'Cargo.toml': `[workspace]\nmembers = ["crates/[a-c]", "plugins/**", "tools/?ne", "ignored/[!x]"]\nexclude = ["crates/b", "crates/c"]\n`,
    'crates/a/Cargo.toml': `${MEMBER_PACKAGE}\n[dependencies]\ndep-a = "1"\n`,
    'crates/b/Cargo.toml': `${MEMBER_PACKAGE}\n[dependencies]\nexcluded-b = "1"\n`,
    'crates/c/Cargo.toml': `${MEMBER_PACKAGE}\n[dependencies]\nexcluded-c = "1"\n`,
    'plugins/Cargo.toml': `${MEMBER_PACKAGE}\n[dependencies]\ndep-plugin-root = "1"\n`,
    'plugins/deep/Cargo.toml': `${MEMBER_PACKAGE}\n[dependencies]\ndep-plugin-deep = "1"\n`,
    'tools/one/Cargo.toml': `${MEMBER_PACKAGE}\n[dependencies]\ndep-tool-one = "1"\n`,
    'tools/two/Cargo.toml': `${MEMBER_PACKAGE}\n[dependencies]\nunmatched-two = "1"\n`,
    'ignored/x/Cargo.toml': `${MEMBER_PACKAGE}\n[dependencies]\nnegated-x = "1"\n`,
  }, async (dir) => {
    const manifest = readManifest(dir);
    assert.deepEqual(manifest.workspace.members, ['crates/[a-c]', 'plugins/**', 'tools/?ne', 'ignored/[!x]']);
    assert.deepEqual(manifest.workspace.resolvedMembers, expectedMembers);
    assert.deepEqual(Object.keys(manifest.dependencies).toSorted(), [
      'dep-a',
      'dep-plugin-deep',
      'dep-plugin-root',
      'dep-tool-one',
    ]);
  });
});

test('manifest repair: Cargo globstar prunes generated, dependency, and VCS directories', async () => {
  await withFixture('cargo-globstar-pruning', {
    'Cargo.toml': '[workspace]\nmembers = ["**"]\n',
    'crates/kept/Cargo.toml': MEMBER_PACKAGE,
    'target/generated/Cargo.toml': MEMBER_PACKAGE,
    'node_modules/dependency/Cargo.toml': MEMBER_PACKAGE,
    '.git/worktrees/copied/Cargo.toml': MEMBER_PACKAGE,
  }, async (dir) => {
    assert.deepEqual(expandRepositoryDirectoryPatterns(dir, '**', { marker: 'Cargo.toml' }), ['crates/kept']);
    assert.deepEqual(readManifest(dir).workspace.resolvedMembers, ['crates/kept']);
  });
});

test('manifest repair: Cargo globstar stops safely at the directory budget', async () => {
  await withFixture('cargo-globstar-budget', {
    'a/Cargo.toml': MEMBER_PACKAGE,
    'a/deep/Cargo.toml': MEMBER_PACKAGE,
    'b/Cargo.toml': MEMBER_PACKAGE,
  }, async (dir) => {
    assert.doesNotThrow(() => expandRepositoryDirectoryPatterns(dir, '**', {
      marker: 'Cargo.toml',
      maxDirectories: 2,
    }));
    assert.deepEqual(expandRepositoryDirectoryPatterns(dir, '**', {
      marker: 'Cargo.toml',
      maxDirectories: 2,
    }), ['a']);
  });
});

test('manifest repair: repository directory glob rejects absolute and parent traversal patterns', async () => {
  await withFixture('cargo-unsafe-globs', {
    'Cargo.toml': '[workspace]\nmembers = ["../*", "/tmp/*"]\n',
    'safe/Cargo.toml': MEMBER_PACKAGE,
  }, async (dir) => {
    const manifest = readManifest(dir);
    assert.deepEqual(manifest.workspace.resolvedMembers, []);
    assert.deepEqual(expandRepositoryDirectoryPatterns(dir, '../*', { marker: 'Cargo.toml' }), []);
    assert.deepEqual(expandRepositoryDirectoryPatterns(dir, '/tmp/*', { marker: 'Cargo.toml' }), []);
  });
});

test('manifest repair: missing and unmatched Cargo members return safely', async () => {
  await withFixture('cargo-missing', {
    'Cargo.toml': '[workspace]\nmembers = ["missing", "crates/*"]\n',
  }, async (dir) => {
    const manifest = readManifest(dir);
    assert.deepEqual(manifest.workspace.members, ['missing', 'crates/*']);
    assert.deepEqual(manifest.workspace.resolvedMembers, []);
  });
});

for (const [lockfile, expected, manifest] of [
  ['bun.lock', 'bun', { name: 'bun-text' }],
  ['bun.lockb', 'bun', { name: 'bun-binary' }],
  ['pdm.lock', 'pdm', null],
]) {
  test(`survey repair: ${lockfile} selects ${expected}`, async () => {
    const files = manifest
      ? { 'package.json': JSON.stringify(manifest), 'index.js': 'export {};\n', [lockfile]: '' }
      : { 'pyproject.toml': '[project]\nname = "pdm-project"\nversion = "0.1.0"\n', 'main.py': '', [lockfile]: '' };
    await withFixture(`survey-${expected}`, files, async (dir) => {
      const overview = await survey(dir);
      assert.equal(overview.packageManager, expected);
    });
  });
}
