import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { makeFixture, cleanupFixture } from './harness.mjs';
import { files as pythonFiles, manifest as pythonManifest } from './fixtures/python.mjs';
import { files as javascriptFiles, manifest as javascriptManifest } from './fixtures/javascript.mjs';
import { files as typescriptFiles, manifest as typescriptManifest } from './fixtures/typescript.mjs';
import { files as shellFiles, manifest as shellManifest } from './fixtures/shell.mjs';
import { files as rustFiles, manifest as rustManifest } from './fixtures/rust.mjs';

const FIXTURES = [
  { name: 'python', files: pythonFiles, manifest: pythonManifest },
  { name: 'javascript', files: javascriptFiles, manifest: javascriptManifest },
  { name: 'typescript', files: typescriptFiles, manifest: typescriptManifest },
  { name: 'shell', files: shellFiles, manifest: shellManifest },
  { name: 'rust', files: rustFiles, manifest: rustManifest },
];

for (const fixture of FIXTURES) {
  test(`harness builds ${fixture.name} fixture under os.tmpdir() with manifest present`, () => {
    const dir = makeFixture(fixture.name, fixture.files);
    try {
      assert.ok(
        dir.startsWith(os.tmpdir()),
        `temp dir ${dir} must live under ${os.tmpdir()}`
      );
      const manifestPath = path.join(dir, fixture.manifest);
      assert.ok(
        fs.existsSync(manifestPath),
        `manifest ${fixture.manifest} missing in ${dir}`
      );
    } finally {
      cleanupFixture(dir);
      assert.ok(!fs.existsSync(dir), `cleanup failed for ${dir}`);
    }
  });
}
