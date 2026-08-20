// Shared bounded-read helper for the deep scanners (F-022/F-062/F-023).
//
// Centralizes the "statSync before read, skip files above the bound" pattern
// so no scanner allocates a whole file before checking its size (F-022). It
// also enforces realpath containment for well-known-file reads (F-023): a
// symlinked well-known name that resolves OUTSIDE the repository root is
// never read, mirroring the plugin loader's boundary checks.
//
// ESM only. Zero npm deps. node: builtins only. Synchronous — the deep
// scanners are sync-heavy; async callers on the provider path use
// `readPluginArtifacts` in pipeline/run.mjs instead.
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { sep } from 'node:path';

export const DEFAULT_BYTE_LIMIT = 1024 * 1024;

function isInside(rootReal, candidateReal) {
  return candidateReal === rootReal || candidateReal.startsWith(`${rootReal}${sep}`);
}

/**
 * Read a file with a statSync size gate and an optional realpath containment
 * check. Returns the UTF-8 content when the file exists, is a regular file,
 * is within `byteLimit` bytes, and (when `containmentRoot` is set) resolves
 * inside that root. Returns null otherwise — including files above the bound,
 * symlinks escaping the root, and unreadable paths. A file above the bound is
 * never allocated.
 * @param {string} absPath - absolute path to read.
 * @param {object} [options]
 * @param {number} [options.byteLimit] - maximum file size in bytes.
 * @param {string|null} [options.containmentRoot] - repo root; the file must
 *   resolve inside it (realpath) before being read.
 * @returns {string|null}
 */
export function readBoundedFile(absPath, { byteLimit = DEFAULT_BYTE_LIMIT, containmentRoot = null } = {}) {
  try {
    if (containmentRoot !== null) {
      const rootReal = realpathSync(containmentRoot);
      const fileReal = realpathSync(absPath);
      if (!isInside(rootReal, fileReal)) return null;
    }
    const stats = statSync(absPath);
    if (!stats.isFile() || stats.size > byteLimit) return null;
    const content = readFileSync(absPath, 'utf-8');
    return content.length > byteLimit ? null : content;
  } catch {
    return null;
  }
}
