#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { accessSync, rmSync } from 'node:fs';
import { writeFile, mkdir, copyFile, readFile, rm, mkdtemp, readdir, constants as fsc } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { promisify } from 'node:util';
import { homedir, tmpdir } from 'node:os';

const execFileAsync = promisify(execFile);

const CONFIG_PATH = join(homedir(), '.agents', 'csm-upload.json');

// F-052: every value interpolated into index.html passes through escapeHtml.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// F-052: uploaded file names must stay inside the demo directory — no path
// separators, no traversal, no hostile HTML in the generated index.
const SAFE_FILENAME_RE = /^[A-Za-z0-9._-]+$/;

function assertSafeFilename(name) {
  if (!SAFE_FILENAME_RE.test(name) || name === '.' || name === '..') {
    throw new Error(
      `Unsafe filename rejected: "${name}". Filenames may only contain [A-Za-z0-9._-] (no path separators, no special characters).`
    );
  }
}

const args = process.argv.slice(2);
let label = '';
const files = [];
let description = '';
let ghOverride = '';
let repoOverride = '';
let dryRun = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--label' && i + 1 < args.length) label = args[++i];
  else if (args[i] === '--desc' && i + 1 < args.length) description = args[++i];
  else if (args[i] === '--github' && i + 1 < args.length) ghOverride = args[++i];
  else if (args[i] === '--repo' && i + 1 < args.length) repoOverride = args[++i];
  else if (args[i] === '--dry-run') dryRun = true;
  else if (!args[i].startsWith('--')) files.push(args[i]);
}

if (!label) {
  console.error('Usage: node scripts/upload.mjs --label <name> [--desc <text>] [--github <user>] [--repo <name>] [--dry-run] <file1> [file2...]');
  console.error('Creates demo-YYYY-MM-DD-<label>/ on your GitHub Pages site with the uploaded files.');
  console.error('--dry-run builds the index.html locally and performs no git/gh operations.');
  process.exit(1);
}

async function loadConfig({ probe = true } = {}) {
  let config = {};
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    config = JSON.parse(raw);
  } catch {}

  if (config.github && config.pagesRepo) return config;

  if (!config.pagesRepo) config.pagesRepo = 'csm-browse-pages';

  if (!config.github && probe) {
    // F-053: ask the API for the authenticated login first — the auth-status
    // text parse below is only a fallback (it can grab the wrong account on
    // multi-account setups).
    try {
      const { stdout } = await execFileAsync('gh', ['api', 'user', '--jq', '.login'], { timeout: 60000 });
      const login = stdout.trim();
      if (login) {
        config.github = login;
        console.log(`Detected GitHub account: ${config.github}`);
      }
    } catch {}

    if (!config.github) {
      try {
        const { stdout } = await execFileAsync('gh', ['auth', 'status'], { timeout: 60000 });
        const match = stdout.match(/account\s+(\S+)/) || stdout.match(/as\s+(\S+)/);
        if (match) {
          config.github = match[1];
          console.log(`Detected GitHub account: ${config.github}`);
        }
      } catch {}
    }

    if (!config.github) {
      console.error('GitHub username still unset — could not determine GitHub username from gh.');
      console.error('Run `gh auth status` manually or pass --github <user>.');
      console.error(`Alternatively, set it manually: echo '{"github":"YOUR_USER","pagesRepo":"csm-browse-pages"}' > ${CONFIG_PATH}`);
      process.exit(1);
    }
  }

  if (!probe) return config;

  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  return config;
}

function buildIndexHtml(demoDir, description, uploaded) {
  const imgs = uploaded.filter(f => ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(f.ext));
  const vids = uploaded.filter(f => ['webm', 'mp4', 'mov'].includes(f.ext));
  const other = uploaded.filter(f => !imgs.includes(f) && !vids.includes(f));

  let html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${escapeHtml(demoDir)}</title>
<style>body{font-family:sans-serif;margin:40px;background:#111;color:#eee}img,video{max-width:100%;margin:20px 0;border:1px solid #333}.meta{color:#888;font-size:13px}a{color:#5af}</style></head>
<body>
<h1>${escapeHtml(demoDir)}</h1>`;

  if (description) html += `<p>${escapeHtml(description)}</p>`;
  html += `<p class="meta">${uploaded.length} file(s) — uploaded ${new Date().toISOString()}</p>\n`;

  for (const f of imgs) {
    const name = escapeHtml(f.name);
    html += `<h2>${name}</h2>\n<img src="${name}" alt="${name}">\n`;
  }
  for (const f of vids) {
    const name = escapeHtml(f.name);
    html += `<h2>${name}</h2>\n<video controls autoplay loop muted width="1920"><source src="${name}" type="video/${f.ext}"></video>\n`;
  }
  for (const f of other) {
    const name = escapeHtml(f.name);
    html += `<p><a href="${name}">${name}</a></p>\n`;
  }

  html += `</body></html>\n`;
  return html;
}

// F-053: SIGINT/SIGTERM must not leave the temp pages clone in /tmp.
let pagesDir = null;
let signalCleaning = false;
function cleanupOnSignal(signal) {
  if (signalCleaning) return;
  signalCleaning = true;
  if (pagesDir) {
    try { rmSync(pagesDir, { recursive: true, force: true }); } catch {}
  }
  process.exit(signal === 'SIGINT' ? 130 : 143);
}
process.on('SIGINT', () => cleanupOnSignal('SIGINT'));
process.on('SIGTERM', () => cleanupOnSignal('SIGTERM'));

async function main() {
  if (files.length === 0) {
    console.error('No files specified');
    process.exit(1);
  }

  // F-052: validate every basename before any copy, config write, or network
  // operation — a hostile name is rejected with a clear error up front.
  for (const f of files) {
    try {
      assertSafeFilename(basename(f));
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  }

  for (const f of files) {
    try {
      accessSync(f, fsc.R_OK);
    } catch {
      console.error(`File not found or not readable: ${f}`);
      process.exit(1);
    }
  }

  // Dry-run never contacts gh and never writes the config file.
  const config = await loadConfig({ probe: !dryRun });
  const github = ghOverride || config.github || '<github-user>';
  const pagesRepo = repoOverride || config.pagesRepo;

  const PAGES_REPO = `https://github.com/${github}/${pagesRepo}.git`;
  const BASE_URL = `https://${github}.github.io/${pagesRepo}`;

  const date = new Date().toISOString().split('T')[0];
  const demoDir = `demo-${date}-${label.replace(/[^a-z0-9._-]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')}`;

  if (dryRun) {
    // F-052/F-053 dry-run: build the exact index.html locally (escaped), copy
    // nothing, run no git/gh commands — just print what WOULD be uploaded.
    const uploaded = files.map(f => {
      const name = basename(f);
      return { name, path: `${BASE_URL}/${demoDir}/${name}`, ext: name.split('.').pop().toLowerCase() };
    });

    console.log(`[dry-run] Would create ${demoDir}/ in ${PAGES_REPO}`);
    for (const u of uploaded) {
      console.log(`[dry-run] Would upload ${u.name} -> ${u.path}`);
    }

    const html = buildIndexHtml(demoDir, description, uploaded);
    const previewPath = join(tmpdir(), `${demoDir}.preview.html`);
    await writeFile(previewPath, html, 'utf-8');
    console.log(`[dry-run] Local preview written to: ${previewPath}`);
    console.log(`[dry-run] Site URL would be: ${BASE_URL}/${demoDir}/`);
    return;
  }

  if (!ghOverride && !config.github) {
    console.error('GitHub username undefined — refusing to build the clone URL.');
    console.error('Run `gh auth status` manually or pass --github <user>.');
    process.exit(1);
  }

  pagesDir = await mkdtemp(join(tmpdir(), 'csm-pages-'));

  try {
    const demoPath = join(pagesDir, demoDir);

    async function ensureRepo() {
      const entries = await readdir(pagesDir);
      if (entries.length > 0) {
        throw new Error(`Conflict: ${pagesDir} is not empty. Refusing to clone into it.`);
      }
      console.log(`Cloning pages repo: ${PAGES_REPO}...`);
      await execFileAsync('git', ['clone', PAGES_REPO, pagesDir], { timeout: 120000 });
      console.log('Cloned');
    }

    async function gitCommit() {
      await execFileAsync('git', ['-C', pagesDir, 'add', '-A'], { timeout: 60000 });
      const { stdout } = await execFileAsync('git', ['-C', pagesDir, 'status', '--porcelain'], { timeout: 60000 });
      if (stdout.trim()) {
        await execFileAsync('git', ['-C', pagesDir, 'commit', '-m', `upload ${demoDir}`], { timeout: 60000 });
        await execFileAsync('git', ['-C', pagesDir, 'push'], { timeout: 60000 });
        console.log('Pushed');
      } else {
        console.log('No changes to push');
      }
    }

    const uploaded = [];
    try {
      await ensureRepo();
      await mkdir(demoPath, { recursive: true });

      for (const f of files) {
        const name = basename(f);
        const dest = join(demoPath, name);
        await copyFile(f, dest);
        uploaded.push({ name, path: `${BASE_URL}/${demoDir}/${name}`, ext: name.split('.').pop().toLowerCase() });
        console.log(`Copied: ${name}`);
      }

      const html = buildIndexHtml(demoDir, description, uploaded);

      const indexPath = join(demoPath, 'index.html');
      await writeFile(indexPath, html, 'utf-8');
      console.log('Generated index.html');

      await gitCommit();

      const url = `${BASE_URL}/${demoDir}/`;
      console.log(url);
    } catch (err) {
      if (uploaded.length > 0) {
        console.error(`Partial upload state: ${uploaded.map(u => u.name).join(', ')} were copied into the temporary directory before the failure.`);
        console.error('The temporary directory is removed now; re-running the same command retries the upload from scratch.');
      }
      throw err;
    }
  } finally {
    await rm(pagesDir, { recursive: true, force: true });
    pagesDir = null;
  }
}

main().catch(err => {
  console.error(err.message);
  // F-053: git/gh failures put their diagnostics in err.stderr — never drop them.
  if (err.stderr) {
    const text = Buffer.isBuffer(err.stderr) ? err.stderr.toString() : String(err.stderr);
    if (text.trim()) console.error(text.trim());
  }
  process.exit(1);
});
