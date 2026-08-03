// Maintainability dimension — exact token-duplicate detection.
//
// T214 owns this module. It finds exact duplicate token spans of at least
// `DUPLICATE_WINDOW` (50) tokens across measured files using a hash bucket
// plus longest-common-extension verification and merge.
//
// Algorithm (all deterministic):
//   1. Every sliding window of exactly 50 normalized tokens is hashed.
//   2. Windows sharing a hash are verified for exact token equality and
//      grouped by identical content.
//   3. For each verified group, every occurrence pair is extended by
//      longest-common-extension (backward then forward) to a maximal block.
//   4. Blocks are merged by union-find into duplicate groups of identical
//      content; overlapping regions within one group and file are merged into
//      maximal intervals.
//   5. Groups are sorted deterministically and capped with disclosed flags
//      (windows, groups, spans, blocks, and per-group occurrences).
//
// Exactness note: duplicate equality is decided on the *normalized token
// stream* produced by the tokenizer (string literals are `STR`, numeric
// literals `NUM`), so two spans are "exact duplicates" when their normalized
// token sequences are byte-identical. Hashing is only an index; every reported
// duplicate is verified against the actual token slices.
//
// ESM only. Zero npm deps. node: builtins only (node:crypto for hashing).
// Pure DATA; no filesystem, network, child-process, or executable access.
//
// Source-policy note (T201): this module imports only node:crypto and pure
// helpers; it never touches node:fs / node:child_process / node:process /
// node:vm / node:module, so the recurring capability gate remains closed.

import { createHash } from 'node:crypto';

export const DUPLICATE_WINDOW = 50;

const DUPLICATE_LIMITS = Object.freeze({
  maxWindows: 100_000,
  maxGroups: 256,
  maxSpansPerGroup: 64,
  maxOccurrencesPerGroup: 32,
  maxBlocks: 40_000,
});

export class DuplicateError extends TypeError {
  constructor(code, message) {
    super(`Duplicate detection failed: ${message}`);
    this.name = 'DuplicateError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new DuplicateError(code, message);
}

function plainFiles(value) {
  if (!Array.isArray(value)) fail('INVALID_INPUT', 'files must be an array');
  const normalized = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || typeof entry.path !== 'string'
        || !Array.isArray(entry.tokens)) {
      fail('INVALID_INPUT', 'each file must carry a path and a token array');
    }
    const values = [];
    const lines = [];
    for (const token of entry.tokens) {
      if (token === null || typeof token !== 'object' || typeof token.value !== 'string'
          || !Number.isSafeInteger(token.line) || token.line < 1) {
        fail('INVALID_TOKEN', 'tokens must be { value, line } records');
      }
      values.push(token.value);
      lines.push(token.line);
    }
    normalized.push({ path: entry.path, values, lines });
  }
  return normalized;
}

function hashWindow(values, start) {
  let hasher = createHash('sha256');
  for (let index = start; index < start + DUPLICATE_WINDOW; index++) {
    hasher = hasher.update(values[index]);
    hasher = hasher.update('\u0001');
  }
  return hasher.digest('hex');
}

function slicesEqual(valuesA, startA, valuesB, startB) {
  for (let offset = 0; offset < DUPLICATE_WINDOW; offset++) {
    if (valuesA[startA + offset] !== valuesB[startB + offset]) return false;
  }
  return true;
}

function occurrencesEqual(values, reference, candidate) {
  return slicesEqual(values[reference.f], reference.s, values[candidate.f], candidate.s);
}

function blockLength(values, refF, refS, otherF, otherS) {
  let back = 0;
  while (refS - back - 1 >= 0 && otherS - back - 1 >= 0
      && values[refF][refS - back - 1] === values[otherF][otherS - back - 1]) back++;
  let forward = 0;
  while (refS + DUPLICATE_WINDOW + forward < values[refF].length
      && otherS + DUPLICATE_WINDOW + forward < values[otherF].length
      && values[refF][refS + DUPLICATE_WINDOW + forward]
          === values[otherF][otherS + DUPLICATE_WINDOW + forward]) forward++;
  const startA = refS - back;
  const endA = refS + DUPLICATE_WINDOW + forward;
  const startB = otherS - back;
  const endB = otherS + DUPLICATE_WINDOW + forward;
  const length = endA - startA;
  if (length < DUPLICATE_WINDOW) return null;
  return {
    a: { f: refF, s: startA, e: endA },
    b: { f: otherF, s: startB, e: endB },
    length,
  };
}

function regionKey(region) {
  return `${region.f}:${region.s}:${region.e}`;
}

function DisjointSet() {
  const parent = new Map();
  const size = new Map();

  const find = (key) => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(key) !== key) {
      const next = parent.get(key);
      parent.set(key, root);
      key = next;
    }
    return root;
  };

  return {
    add(key) {
      if (!parent.has(key)) {
        parent.set(key, key);
        size.set(key, 1);
      }
    },
    union(left, right) {
      const a = find(left);
      const b = find(right);
      if (a === b) return;
      if (size.get(a) < size.get(b)) {
        parent.set(a, b);
        size.set(b, size.get(b) + size.get(a));
      } else {
        parent.set(b, a);
        size.set(a, size.get(a) + size.get(b));
      }
    },
    root(key) {
      return parent.has(key) ? find(key) : null;
    },
    entries() {
      return parent;
    },
  };
}

function mergeOverlapping(regions) {
  if (regions.length < 2) return regions;
  const sorted = [...regions].sort((left, right) => left.s - right.s);
  const merged = [];
  let current = null;
  for (const region of sorted) {
    if (current === null) {
      current = { ...region };
      continue;
    }
    if (region.s < current.e) {
      current.e = Math.max(current.e, region.e);
      continue;
    }
    merged.push(current);
    current = { ...region };
  }
  if (current !== null) merged.push(current);
  return merged;
}

/**
 * Find exact duplicate token spans across measured files.
 *
 * @param {object[]} files - `[{ path, tokens }]` where tokens are the
 *   `{ value, line }` records from the tokenizer.
 * @param {object} [options] - `DUPLICATE_LIMITS`-shaped bounds.
 * @returns {object} A deep-frozen `{ groups, capped }` envelope. `groups` is a
 *   deterministically sorted array of `{ id, tokenCount, spans }` records
 *   where each span is `{ path, startLine, endLine, tokenCount }`. `capped` is
 *   `{ windows, groups, spans, blocks, occurrences }` booleans disclosing
 *   truncation (window, group, span, verification-block, and per-group
 *   occurrence bounds).
 */
export function findDuplicateGroups(files, options = DUPLICATE_LIMITS) {
  const normalized = plainFiles(files);
  const limits = { ...DUPLICATE_LIMITS, ...options };
  const values = normalized.map((entry) => entry.values);
  const lines = normalized.map((entry) => entry.lines);

  const buckets = new Map();
  let windowsInspected = 0;
  let windowsCapped = false;
  for (let f = 0; f < normalized.length; f++) {
    const count = values[f].length;
    for (let s = 0; s + DUPLICATE_WINDOW <= count; s++) {
      if (windowsInspected >= limits.maxWindows) {
        windowsCapped = true;
        break;
      }
      windowsInspected++;
      const hash = hashWindow(values[f], s);
      let bucket = buckets.get(hash);
      if (bucket === undefined) {
        bucket = [];
        buckets.set(hash, bucket);
      }
      bucket.push({ f, s });
    }
    if (windowsCapped) break;
  }

  const blocks = [];
  let blocksCapped = false;
  let occurrencesCapped = false;
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    if (bucket.length > limits.maxOccurrencesPerGroup) occurrencesCapped = true;
    const occurrences = bucket.slice(0, limits.maxOccurrencesPerGroup);
    const reference = occurrences[0];
    if (occurrences.some((candidate) => !occurrencesEqual(values, reference, candidate))) continue;
    for (let left = 0; left < occurrences.length; left++) {
      for (let right = left + 1; right < occurrences.length; right++) {
        if (blocks.length >= limits.maxBlocks) {
          blocksCapped = true;
          break;
        }
        const block = blockLength(
          values,
          occurrences[left].f,
          occurrences[left].s,
          occurrences[right].f,
          occurrences[right].s,
        );
        if (block !== null) blocks.push(block);
      }
      if (blocksCapped) break;
    }
    if (blocksCapped) break;
  }

  const set = DisjointSet();
  for (const block of blocks) {
    const aKey = regionKey(block.a);
    const bKey = regionKey(block.b);
    set.add(aKey);
    set.add(bKey);
    set.union(aKey, bKey);
  }

  const groups = new Map();
  for (const [key, root] of set.entries()) {
    if (key !== root) continue;
    groups.set(root, []);
  }
  for (const block of blocks) {
    const aKey = regionKey(block.a);
    const bKey = regionKey(block.b);
    const root = set.root(aKey);
    groups.get(root).push(block.a, block.b);
  }

  const rawGroups = [];
  for (const regions of groups.values()) {
    const unique = new Map();
    for (const region of regions) {
      const key = regionKey(region);
      if (!unique.has(key)) unique.set(key, { ...region });
    }
    const byFile = new Map();
    for (const region of unique.values()) {
      const list = byFile.get(region.f) ?? [];
      list.push(region);
      byFile.set(region.f, list);
    }
    const merged = [];
    for (const list of byFile.values()) merged.push(...mergeOverlapping(list));
    rawGroups.push(merged);
  }

  const groupsOut = rawGroups
    .map((regions) => regions.map((region) => ({
      path: normalized[region.f].path,
      startLine: lines[region.f][region.s],
      endLine: lines[region.f][region.e - 1],
      tokenCount: region.e - region.s,
    })))
    .filter((spans) => spans.length >= 2);

  groupsOut.sort((left, right) => {
    const leftKey = left.map((span) => `${span.path}:${span.startLine}`).sort().join('\u0001');
    const rightKey = right.map((span) => `${span.path}:${span.startLine}`).sort().join('\u0001');
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });

  let groupsCapped = false;
  let spansCapped = false;
  const boundedGroups = [];
  for (const spans of groupsOut) {
    if (boundedGroups.length >= limits.maxGroups) {
      groupsCapped = true;
      break;
    }
    const sortedSpans = [...spans].sort((left, right) => (
      left.path < right.path ? -1 : left.path > right.path ? 1 : left.startLine - right.startLine
    ));
    let boundedSpans = sortedSpans;
    if (sortedSpans.length > limits.maxSpansPerGroup) {
      boundedSpans = sortedSpans.slice(0, limits.maxSpansPerGroup);
      spansCapped = true;
    }
    const tokenCount = Math.min(...boundedSpans.map((span) => span.tokenCount));
    boundedGroups.push({
      id: `duplicate-${String(boundedGroups.length + 1).padStart(3, '0')}`,
      tokenCount,
      spans: boundedSpans,
    });
  }

  return Object.freeze({
    groups: Object.freeze(boundedGroups),
    capped: Object.freeze({
      windows: windowsCapped,
      groups: groupsCapped,
      spans: spansCapped,
      blocks: blocksCapped,
      occurrences: occurrencesCapped,
    }),
    windowsInspected,
  });
}
