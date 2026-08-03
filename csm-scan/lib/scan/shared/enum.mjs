import { statSync } from 'node:fs';
import { join } from 'node:path';
import { commandBroker } from './command.mjs';
import { isIgnoredPath } from './ignore.mjs';

function extOf(relPath) {
  const base = relPath.split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot > 0) return base.slice(dot).toLowerCase();
  return '';
}

export function byExtension(files) {
  const counts = {};
  for (const f of files) {
    const ext = extOf(f);
    counts[ext] = (counts[ext] || 0) + 1;
  }
  return counts;
}

export function sumSizes(repoPath, files) {
  let total = 0;
  for (const f of files) {
    try {
      total += statSync(join(repoPath, f)).size;
    } catch {}
  }
  return total;
}

export async function enumerate(repoPath, broker = commandBroker) {
  const result = await broker.execute('rg:files', { cwd: repoPath });
  const raw = result.ok || result.noMatch ? result.stdout : '';

  const files = raw
    .split('\n')
    .map((s) => s.trim().replace(/\\/g, '/'))
    .filter(Boolean)
    .filter((f) => !isIgnoredPath(f))
    .sort();

  const extCounts = byExtension(files);
  const totalBytes = sumSizes(repoPath, files);

  return {
    files,
    extCounts,
    totalFiles: files.length,
    totalBytes,
  };
}
