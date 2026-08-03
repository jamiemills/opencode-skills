// Read-only expansion of repository-relative directory patterns.

import { existsSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { IGNORE_DIRS } from './ignore.mjs';

const DEFAULT_MAX_DIRECTORIES = 10_000;
const MAX_MAX_DIRECTORIES = 1_000_000;
// Mercurial and Subversion metadata supplement the shared generated/cache convention.
const RECURSIVE_IGNORE_DIRS = new Set([...IGNORE_DIRS, '.hg', '.svn']);

function normalizePattern(pattern) {
  if (typeof pattern !== 'string') return null;
  const normalized = pattern.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (!normalized || normalized.startsWith('/') || isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized)) return null;
  const components = normalized.split('/');
  if (components.some((component) => !component || component === '..')) return null;
  return components.filter((component) => component !== '.');
}

function componentRegex(component) {
  let source = '';
  for (let i = 0; i < component.length; i++) {
    const char = component[i];
    if (char === '*') {
      source += '.*';
      continue;
    }
    if (char === '?') {
      source += '.';
      continue;
    }
    if (char === '[') {
      const end = component.indexOf(']', i + 1);
      if (end > i + 1) {
        let body = component.slice(i + 1, end);
        let negated = false;
        if (body.startsWith('!')) {
          negated = true;
          body = body.slice(1);
        }
        if (body) {
          const escaped = body.replace(/\\/g, '\\\\').replace(/\^/g, '\\^').replace(/\]/g, '\\]');
          source += `[${negated ? '^' : ''}${escaped}]`;
          i = end;
          continue;
        }
      }
    }
    source += char.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }
  try { return new RegExp(`^${source}$`); } catch { return null; }
}

function expandPattern(root, components, traversal) {
  const matches = new Set();
  const visit = (abs, rel, index) => {
    if (!traversal.visited.has(abs)) {
      if (traversal.visited.size >= traversal.maxDirectories) return;
      traversal.visited.add(abs);
    }
    if (index === components.length) {
      if (rel) matches.add(rel);
      return;
    }
    const component = components[index];
    let entries = [];
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    if (component === '**') {
      visit(abs, rel, index + 1);
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory() || RECURSIVE_IGNORE_DIRS.has(entry.name)) continue;
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        visit(join(abs, entry.name), childRel, index);
      }
      return;
    }
    const matcher = componentRegex(component);
    if (!matcher) return;
    for (const entry of entries) {
      if (!entry.isDirectory() || !matcher.test(entry.name)) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      visit(join(abs, entry.name), childRel, index + 1);
    }
  };
  visit(root, '', 0);
  return [...matches];
}

/**
 * Expand repository-relative directory patterns without following symlinks.
 * Invalid, missing, and unreadable paths are ignored.
 */
export function expandRepositoryDirectoryPatterns(repoPath, patterns, options = {}) {
  if (typeof repoPath !== 'string' || !repoPath) return [];
  const include = (Array.isArray(patterns) ? patterns : [patterns]).map(normalizePattern).filter(Boolean);
  const exclude = (Array.isArray(options.exclude) ? options.exclude : []).map(normalizePattern).filter(Boolean);
  if (!include.length) return [];

  let root;
  try { root = resolve(repoPath); } catch { return []; }
  const marker = typeof options.marker === 'string' && options.marker && !options.marker.includes('/') && !options.marker.includes('\\')
    ? options.marker
    : null;
  const requestedMax = Number.isFinite(options.maxDirectories) ? Math.trunc(options.maxDirectories) : DEFAULT_MAX_DIRECTORIES;
  const traversal = {
    maxDirectories: Math.min(MAX_MAX_DIRECTORIES, Math.max(1, requestedMax)),
    visited: new Set(),
  };
  const excluded = new Set(exclude.flatMap((pattern) => expandPattern(root, pattern, traversal)));
  const matched = include.flatMap((pattern) => expandPattern(root, pattern, traversal))
    .filter((directory) => !excluded.has(directory))
    .filter((directory) => !marker || existsSync(join(root, directory, marker)));
  return [...new Set(matched)].sort();
}
