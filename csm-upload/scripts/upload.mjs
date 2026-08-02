#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import { writeFile, mkdir, copyFile, access, constants } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PAGES_REPO = 'https://github.com/jamiemills/csm-browse-pages.git';
const PAGES_DIR = '/tmp/csm-pages';
const BASE_URL = 'https://jamiemills.github.io/csm-browse-pages';

const args = process.argv.slice(2);
let label = '';
const files = [];
let description = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--label' && i + 1 < args.length) label = args[++i];
  else if (args[i] === '--desc' && i + 1 < args.length) description = args[++i];
  else if (!args[i].startsWith('--')) files.push(args[i]);
}

if (!label) {
  console.error('Usage: node scripts/upload.mjs --label <name> [--desc <text>] <file1> [file2...]');
  console.error('Creates demo-YYYY-MM-DD-<label>/ on your GitHub Pages site with the uploaded files.');
  process.exit(1);
}

const date = new Date().toISOString().split('T')[0];
const demoDir = `demo-${date}-${label.replace(/[^a-z0-9._-]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')}`;
const demoPath = join(PAGES_DIR, demoDir);

async function ensureRepo() {
  try {
    await access(join(PAGES_DIR, '.git'), constants.F_OK);
    await execFileAsync('git', ['-C', PAGES_DIR, 'pull', '--rebase']);
    console.log('Pages repo updated');
  } catch {
    console.log('Cloning pages repo...');
    await execFileAsync('git', ['clone', PAGES_REPO, PAGES_DIR]);
    console.log('Cloned');
  }
}

async function gitCommit() {
  await execFileAsync('git', ['-C', PAGES_DIR, 'add', '-A']);
  const { stdout } = await execFileAsync('git', ['-C', PAGES_DIR, 'status', '--porcelain']);
  if (stdout.trim()) {
    await execFileAsync('git', ['-C', PAGES_DIR, 'commit', '-m', `upload ${demoDir}`]);
    await execFileAsync('git', ['-C', PAGES_DIR, 'push']);
    console.log('Pushed');
  } else {
    console.log('No changes to push');
  }
}

async function main() {
  if (files.length === 0) {
    console.error('No files specified');
    process.exit(1);
  }

  await ensureRepo();
  await mkdir(demoPath, { recursive: true });

  const uploaded = [];
  for (const f of files) {
    const name = basename(f);
    const dest = join(demoPath, name);
    await copyFile(f, dest);
    uploaded.push({ name, path: `${BASE_URL}/${demoDir}/${name}`, ext: name.split('.').pop().toLowerCase() });
    console.log(`Copied: ${name}`);
  }

  // Generate index.html
  const imgs = uploaded.filter(f => ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(f.ext));
  const vids = uploaded.filter(f => ['webm', 'mp4', 'mov'].includes(f.ext));
  const other = uploaded.filter(f => !imgs.includes(f) && !vids.includes(f));

  let html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${demoDir}</title>
<style>body{font-family:sans-serif;margin:40px;background:#111;color:#eee}img,video{max-width:100%;margin:20px 0;border:1px solid #333}.meta{color:#888;font-size:13px}a{color:#5af}</style></head>
<body>
<h1>${demoDir}</h1>`;

  if (description) html += `<p>${description}</p>`;
  html += `<p class="meta">${uploaded.length} file(s) — uploaded ${new Date().toISOString()}</p>\n`;

  for (const f of imgs) {
    html += `<h2>${f.name}</h2>\n<img src="${f.name}" alt="${f.name}">\n`;
  }
  for (const f of vids) {
    html += `<h2>${f.name}</h2>\n<video controls autoplay loop muted width="1920"><source src="${f.name}" type="video/${f.ext}"></video>\n`;
  }
  for (const f of other) {
    html += `<p><a href="${f.name}">${f.name}</a></p>\n`;
  }

  html += `</body></html>\n`;

  const indexPath = join(demoPath, 'index.html');
  await writeFile(indexPath, html, 'utf-8');
  console.log('Generated index.html');

  await gitCommit();

  const url = `${BASE_URL}/${demoDir}/`;
  console.log(url);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
