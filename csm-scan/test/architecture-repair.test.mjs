import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withFixture } from './harness.mjs';
import { scan } from '../lib/scan/deep/architecture.mjs';
import { readManifest } from '../lib/scan/shared/manifest.mjs';

function edgesFrom(result, file) {
  return result.findings.importGraph.graph[file] || [];
}

test('architecture repair: JSONC aliases preserve URL strings and allow comments/trailing commas', async () => {
  const files = {
    'package.json': JSON.stringify({ name: 'jsonc-alias', dependencies: { typescript: '*' } }),
    'tsconfig.json': `{
      // https://example.test/compiler-options
      "compilerOptions": {
        "baseUrl": ".",
        "paths": { "@/*": ["src/*"], },
        "sourceRoot": "https://example.test/source",
      },
    }`,
    'src/app.ts': `import { value } from '@/value';\n`,
    'src/value.ts': `export const value = 1;\n`,
  };
  await withFixture('arch-repair-jsonc', files, async (dir) => {
    const result = await scan(dir);
    assert.deepEqual(edgesFrom(result, 'src/app.ts'), ['src/value.ts']);
  });

  const invalidFiles = {
    'package.json': JSON.stringify({ name: 'invalid-jsonc', dependencies: { typescript: '*' } }),
    'tsconfig.json': `{ "compilerOptions": { "paths": { "@/*": ["src/*"] } }`,
    'src/app.ts': `import { value } from '@/value';\n`,
    'src/value.ts': `export const value = 1;\n`,
  };
  await withFixture('arch-repair-invalid-jsonc', invalidFiles, async (dir) => {
    const result = await scan(dir);
    assert.deepEqual(edgesFrom(result, 'src/app.ts'), []);
  });
});

test('architecture repair: multiline static imports preserve runtime/type boundaries', async () => {
  const files = {
    'package.json': JSON.stringify({ name: 'multiline', dependencies: { typescript: '*' } }),
    'src/app.ts': [
      `/*`,
      `import { fake } from './fake';`,
      `const fakeDynamic = import('./fake');`,
      `*/`,
      `import {`,
      `  runtime, // a clause comment containing a semicolon;`,
      `  /* another standard comment; */ runtime as again,`,
      `} from './runtime';`,
      `import type {`,
      `  Declared, // type-only semicolon;`,
      `} from './declared';`,
      `import {`,
      `  type InlineOnly,`,
      `} from './inline';`,
      `export {`,
      `  runtime as forwarded,`,
      `} from './runtime';`,
      `export type {`,
      `  Declared as ForwardedType,`,
      `} from './declared';`,
      `const unrelated = "import { fake } from './fake'";`,
      `const alsoUnrelated = 'export { fake } from \'./fake\'';`,
      `const url = "https://example.test/a//b/*safe*/";`,
      `const template = \`https://example.test/template//safe/*still-safe*/\`;`,
      `const dynamic = import('./dynamic');`,
      `const required = require('./required');`,
      `export const value: Declared | InlineOnly = runtime;`,
    ].join('\n'),
    'src/runtime.ts': `export const runtime = 1;\n`,
    'src/declared.ts': `export type Declared = number;\n`,
    'src/inline.ts': `export type InlineOnly = number;\n`,
    'src/fake.ts': `export const fake = 1;\n`,
    'src/dynamic.ts': `export const dynamic = 1;\n`,
    'src/required.ts': `export const required = 1;\n`,
  };
  await withFixture('arch-repair-multiline', files, async (dir) => {
    const result = await scan(dir);
    assert.deepEqual(edgesFrom(result, 'src/app.ts'), [
      'src/runtime.ts',
      'src/dynamic.ts',
      'src/required.ts',
    ]);
  });
});

test('architecture repair: nested-only PEP420 top namespace resolves', async () => {
  const files = {
    'pyproject.toml': `[project]\nname = "namespace-demo"\nversion = "1"\n`,
    'src/main.py': `from acme.plugins import loader\n`,
    'src/acme/plugins/loader.py': `VALUE = 1\n`,
  };
  await withFixture('arch-repair-pep420', files, async (dir) => {
    const result = await scan(dir);
    assert.ok(edgesFrom(result, 'src/main.py').includes('src/acme/plugins/loader.py'));
  });
});

test('architecture repair: globbed Rust members use their own crate roots', async () => {
  const files = {
    'Cargo.toml': `[workspace]\nmembers = ["crates/*"]\nresolver = "2"\n`,
    'crates/member-a/Cargo.toml': `[package]\nname = "member-a"\nversion = "0.1.0"\n`,
    'crates/member-a/src/lib.rs': `mod foo;\nmod nested;\nuse crate::foo::value;\nuse member_b::other;\nuse serde::Serialize;\n`,
    'crates/member-a/src/foo.rs': `pub fn value() {}\n`,
    'crates/member-a/src/nested.rs': `mod child;\nuse self::child::item;\nuse super::foo::value;\n`,
    'crates/member-a/src/nested/child.rs': `pub fn item() {}\n`,
    'crates/member-b/Cargo.toml': `[package]\nname = "member-b"\nversion = "0.1.0"\n`,
    'crates/member-b/src/lib.rs': `pub fn other() {}\n`,
  };
  await withFixture('arch-repair-rust-workspace', files, async (dir) => {
    const result = await scan(dir);
    const root = edgesFrom(result, 'crates/member-a/src/lib.rs');
    const nested = edgesFrom(result, 'crates/member-a/src/nested.rs');
    assert.deepEqual(root.sort(), [
      'crates/member-a/src/foo.rs',
      'crates/member-a/src/nested.rs',
      'crates/member-b/src/lib.rs',
    ]);
    assert.ok(nested.includes('crates/member-a/src/nested/child.rs'), JSON.stringify(nested));
    assert.ok(nested.includes('crates/member-a/src/foo.rs'), JSON.stringify(nested));
    assert.ok(!root.some((edge) => /serde/i.test(edge)), JSON.stringify(root));
  });
});

test('architecture repair: Cargo glob classes, globstar, question, and exclusions share resolved members', async () => {
  const expectedMembers = ['crates/a', 'plugins', 'plugins/deep', 'tools/one'];
  const files = {
    'Cargo.toml': `[workspace]\nmembers = ["crates/[ab]", "plugins/**", "tools/?ne"]\nexclude = ["crates/b"]\n`,
    'crates/a/Cargo.toml': `[package]\nname = "member-a"\nversion = "1"\n[dependencies]\ndep-a = "1"\n`,
    'crates/a/src/lib.rs': `use plugin_root::x;\nuse plugin_deep::x;\nuse tool_one::x;\nuse excluded_member::x;\n`,
    'crates/b/Cargo.toml': `[package]\nname = "excluded-member"\nversion = "1"\n[dependencies]\nexcluded-dep = "1"\n`,
    'crates/b/src/lib.rs': `pub fn x() {}\n`,
    'plugins/Cargo.toml': `[package]\nname = "plugin-root"\nversion = "1"\n[dependencies]\ndep-plugin-root = "1"\n`,
    'plugins/src/lib.rs': `pub fn x() {}\n`,
    'plugins/deep/Cargo.toml': `[package]\nname = "plugin-deep"\nversion = "1"\n[dependencies]\ndep-plugin-deep = "1"\n`,
    'plugins/deep/src/lib.rs': `pub fn x() {}\n`,
    'tools/one/Cargo.toml': `[package]\nname = "tool-one"\nversion = "1"\n[dependencies]\ndep-tool-one = "1"\n`,
    'tools/one/src/lib.rs': `pub fn x() {}\n`,
    'tools/two/Cargo.toml': `[package]\nname = "tool-two"\nversion = "1"\n`,
    'tools/two/src/lib.rs': `pub fn x() {}\n`,
  };
  await withFixture('arch-repair-rust-complex-globs', files, async (dir) => {
    const manifest = readManifest(dir);
    assert.deepEqual(manifest.workspace.resolvedMembers, expectedMembers);

    const result = await scan(dir, { manifest, ecosystems: { primary: 'rust', all: ['rust'] } });
    const edges = edgesFrom(result, 'crates/a/src/lib.rs');
    assert.deepEqual(edges.sort(), [
      'plugins/deep/src/lib.rs',
      'plugins/src/lib.rs',
      'tools/one/src/lib.rs',
    ]);
    assert.ok(!edges.includes('crates/b/src/lib.rs'), JSON.stringify(edges));
  });
});

test('architecture repair: Rust C4 code includes expanded public forms only', async () => {
  const files = {
    'Cargo.toml': `[package]\nname = "exports"\nversion = "0.1.0"\n`,
    'src/lib.rs': [
      `pub trait PublicTrait {}`,
      `pub use crate::inner::Thing;`,
      `pub type PublicType = u8;`,
      `pub const PUBLIC_CONST: u8 = 1;`,
      `pub static PUBLIC_STATIC: u8 = 2;`,
      `pub mod public_mod;`,
      `pub(crate) trait CrateTrait {}`,
      `pub(crate) type CrateType = u16;`,
      `pub(crate) const CRATE_CONST: u8 = 3;`,
      `pub(crate) mod crate_mod;`,
      `trait PrivateTrait {}`,
      `type PrivateType = u32;`,
      `const PRIVATE_CONST: u8 = 4;`,
      `mod private_mod;`,
      `mod inner { pub struct Thing; }`,
    ].join('\n'),
    'src/public_mod.rs': `pub fn item() {}\n`,
    'src/crate_mod.rs': `pub fn item() {}\n`,
  };
  await withFixture('arch-repair-rust-exports', files, async (dir) => {
    const result = await scan(dir);
    const code = result.findings.c4Code;
    for (const name of ['PublicTrait', 'crate::inner::Thing', 'PublicType', 'PUBLIC_CONST', 'PUBLIC_STATIC', 'public_mod', 'CrateTrait', 'CrateType', 'CRATE_CONST', 'crate_mod']) {
      assert.ok(code.includes(name), `${name} missing from C4 code:\n${code}`);
    }
    for (const name of ['PrivateTrait', 'PrivateType', 'PRIVATE_CONST', 'private_mod']) {
      assert.ok(!code.includes(name), `${name} must not be exported:\n${code}`);
    }
    assert.match(code, /"Tr"/);
    assert.match(code, /"R"/);
    assert.match(code, /"K"/);
    assert.match(code, /"M"/);
  });
});
