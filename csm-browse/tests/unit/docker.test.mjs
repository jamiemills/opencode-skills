import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { execDetached, execInContainer } from '../../lib/docker.mjs';

// Sub-item 1 (T004): the execLayer gained an optional `timeout` on
// execDetached/execInContainer whose DEFAULT is the previous behavior (no
// timeout / existing maxBuffer). These tests prove the timeout actually fires
// by prepending a tiny FAKE docker binary to PATH: `ok` exits 0, `fail` exits
// 1, anything else `exec sleep 30` so the spawned child IS the long-running
// process and is killable (no stray sleeps). The real docker CLI is never
// invoked, so this is Docker-free.
const FAKE_DOCKER = `#!/bin/sh
case "$FAKE_DOCKER_MODE" in
  ok) exit 0 ;;
  fail) exit 1 ;;
  *) exec sleep 30 ;;
esac
`;

const origPath = process.env.PATH;
let fakeBin;

before(async () => {
  fakeBin = await mkdtemp(join(tmpdir(), 'csm-browse-docker-bin-'));
  const script = join(fakeBin, 'docker');
  await writeFile(script, FAKE_DOCKER, { mode: 0o755 });
  await chmod(script, 0o755);
  process.env.PATH = `${fakeBin}${delimiter}${origPath}`;
});

after(async () => {
  process.env.PATH = origPath;
  await rm(fakeBin, { recursive: true, force: true });
});

function mode(value) { process.env.FAKE_DOCKER_MODE = value; }

test('execInContainer: fast command resolves and returns stdout (default behavior unchanged)', async () => {
  mode('ok');
  try {
    const out = await execInContainer('container', ['echo', 'x']);
    assert.equal(out, '');
  } finally { mode(''); }
});

test('execInContainer: timeout option fires and kills the hanging child (err.killed)', async () => {
  mode('hang');
  try {
    await assert.rejects(
      execInContainer('container', ['anything'], undefined, { timeout: 300 }),
      (err) => err.killed === true,
      'expected the timeout to kill the child with err.killed=true'
    );
  } finally { mode(''); }
});

test('execDetached: fast command resolves and nonzero exit rejects (default behavior unchanged)', async () => {
  mode('ok');
  try {
    await execDetached('container', ['true']);
  } finally { mode(''); }
  mode('fail');
  try {
    await assert.rejects(execDetached('container', ['false']), /docker exec -d failed with code 1/);
  } finally { mode(''); }
});

test('execDetached: timeout option kills a wedged docker CLI and rejects', async () => {
  mode('hang');
  try {
    await assert.rejects(
      execDetached('container', ['anything'], { timeout: 300 }),
      /docker exec -d timed out after 300ms/
    );
  } finally { mode(''); }
});
