import test from 'node:test';
import assert from 'node:assert/strict';
import { createLineWriter } from '../../lib/daemon-log.mjs';

// Sub-item 2 (T004): per-LINE daemon-log timestamps. A line-buffered transform
// must stamp each complete line exactly once across (a) multi-line writes,
// (b) writes split mid-line across chunk boundaries, and (c) a partial line
// left at EOF — with no bytes lost or duplicated.
const stamp = (text) => `TS ${text}`;

function collector() {
  const written = [];
  return { written, writer: createLineWriter({ write: (l) => written.push(l), transform: stamp }) };
}

test('(a) multi-line single write: each line gets exactly one timestamp', () => {
  const { written, writer } = collector();
  writer.append('line one\nline two\nline three\n');
  assert.deepEqual(written, ['TS line one\n', 'TS line two\n', 'TS line three\n']);
  assert.equal(writer.flush(), null, 'no partial line left behind');
});

test('(b) split writes: a line broken mid-way across chunks is stamped once, no bytes lost', () => {
  const { written, writer } = collector();
  writer.append('part A');
  assert.deepEqual(written, [], 'no stamp until the line completes');
  writer.append(' and B\nnext');
  assert.deepEqual(written, ['TS part A and B\n'], 'broken line merges into one stamped record');
  writer.append(' line\n');
  assert.deepEqual(written, ['TS part A and B\n', 'TS next line\n']);
  assert.equal(writer.flush(), null);
});

test('(c) partial line at EOF: flush/close releases it exactly once, bytes preserved', () => {
  const { written, writer } = collector();
  writer.append('line one\nincomplete');
  assert.deepEqual(written, ['TS line one\n']);
  const tail = writer.flush();
  assert.equal(tail, 'TS incomplete', 'partial line stamped and returned for persistence');
  assert.equal(writer.flush(), null, 'flush is idempotent — no duplication');
});

test('close() flushes the trailing partial line and is idempotent', () => {
  const { written, writer } = collector();
  writer.append('a\nb');
  assert.deepEqual(written, ['TS a\n']);
  assert.equal(writer.close(), 'TS b');
  assert.equal(writer.close(), null, 'second close must not re-stamp');
  assert.deepEqual(written, ['TS a\n'], 'complete lines are not re-written on close');
  writer.append('c\n');
  assert.deepEqual(written, ['TS a\n'], 'writes after close are dropped');
});

test('multi-byte UTF-8 split across a chunk boundary is not corrupted', () => {
  const { written, writer } = collector();
  writer.append(Buffer.from([0x63, 0x61, 0x66, 0xc3])); // "caf" + first byte of é
  writer.append(Buffer.from([0xa9, 0x0a]));             // second byte of é + \n
  assert.deepEqual(written, ['TS café\n']);
});

test('Buffer and string inputs are both accepted', () => {
  const { written, writer } = collector();
  writer.append(Buffer.from('bin\n'));
  writer.append('str\n');
  assert.deepEqual(written, ['TS bin\n', 'TS str\n']);
});
