import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

export function makeFixture(name, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `csm-scan-${name}-`));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

export function cleanupFixture(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

export async function runScanner(modPath, repoPath, overview = {}) {
  const url = pathToFileURL(path.resolve(modPath)).href;
  const mod = await import(url);
  return mod.scan(repoPath, overview);
}

export async function withFixture(name, files, fn) {
  const dir = makeFixture(name, files);
  try {
    return await fn(dir);
  } finally {
    cleanupFixture(dir);
  }
}

export async function surveyOverview(repoPath) {
  const url = pathToFileURL(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'lib', 'scan', 'survey.mjs')).href;
  const mod = await import(url);
  return mod.survey(repoPath);
}
