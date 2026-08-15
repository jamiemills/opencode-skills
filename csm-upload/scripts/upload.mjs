#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import { accessSync } from 'node:fs';
import { writeFile, mkdir, copyFile, access, readFile, rm, mkdtemp, readdir, constants as fsc } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { promisify } from 'node:util';
import { homedir, tmpdir } from 'node:os';

const execFileAsync = promisify(execFile);

const CONFIG_PATH = join(homedir(), '.agents', 'csm-upload.json');

const args = process.argv.slice(2);
let label = '';
const files = [];
let description = '';
let ghOverride = '';
let repoOverride = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--label' && i + 1 < args.length) label = args[++i];
  else if (args[i] === '--desc' && i + 1 < args.length) description = args[++i];
  else if (args[i] === '--github' && i + 1 < args.length) ghOverride = args[++i];
  else if (args[i] === '--repo' && i + 1 < args.length) repoOverride = args[++i];
  else if (!args[i].startsWith('--')) files.push(args[i]);
}

if (!label) {
  console.error('Usage: node scripts/upload.mjs --label <name> [--desc <text>] [--github <user>] [--repo <name>] <file1> [file2...]');
  console.error('Creates demo-YYYY-MM-DD-<label>/ on your GitHub Pages site with the uploaded files.');
  process.exit(1);
}

async function loadConfig() {
  let config = {};
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    config = JSON.parse(raw);
  } catch {}

  if (config.github && config.pagesRepo) return config;

  if (!config.pagesRepo) config.pagesRepo = 'csm-browse-pages';

  if (!config.github) {
    try {
      const { stdout } = await execFileAsync('gh', ['auth', 'status']);
      const match = stdout.match(/account\s+(\S+)/) || stdout.match(/as\s+(\S+)/);
      if (match) {
        config.github = match[1];
        console.log(`Detected GitHub account: ${config.github}`);
      }
    } catch {}

    if (!config.github) {
      try {
        const { stdout } = await execFileAsync('gh', ['api', 'user', '--jq', '.login']);
        const login = stdout.trim();
        if (login) {
          config.github = login;
          console.log(`Detected GitHub account: ${config.github}`);
        }
      } catch {}
    }

    if (!config.github) {
      console.error('GitHub username still unset — could not determine GitHub username from gh auth status.');
      console.error('Run `gh auth status` manually or pass --github <user>.');
      console.error(`Alternatively, set it manually: echo '{"github":"YOUR_USER","pagesRepo":"csm-browse-pages"}' > ${CONFIG_PATH}`);
      process.exit(1);
    }
  }

  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  return config;
}

async function main() {
  if (files.length === 0) {
    console.error('No files specified');
    process.exit(1);
  }

  for (const f of files) {
    try {
      accessSync(f, fsc.R_OK);
    } catch {
      console.error(`File not found or not readable: ${f}`);
      process.exit(1);
    }
  }

  const config = await loadConfig();
  const github = ghOverride || config.github;
  const pagesRepo = repoOverride || config.pagesRepo;

  if (!github) {
    console.error('GitHub username undefined — refusing to build the clone URL.');
    console.error('Run `gh auth status` manually or pass --github <user>.');
    process.exit(1);
  }

  const PAGES_REPO = `https://github.com/${github}/${pagesRepo}.git`;
  const BASE_URL = `https://${github}.github.io/${pagesRepo}`;

  const date = new Date().toISOString().split('T')[0];
  const demoDir = `demo-${date}-${label.replace(/[^a-z0-9._-]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')}`;

  const pagesDir = await mkdtemp(join(tmpdir(), 'csm-pages-'));

  try {
    const demoPath = join(pagesDir, demoDir);

    async function ensureRepo() {
      let hasGit = false;
      try {
        await access(join(pagesDir, '.git'), fsc.F_OK);
        hasGit = true;
      } catch {}

      if (hasGit) {
        try {
          await execFileAsync('git', ['-C', pagesDir, 'pull', '--rebase']);
          console.log('Pages repo updated');
        } catch (err) {
          throw new Error(`git pull failed in ${pagesDir}: ${err.stderr || err.message}`);
        }
        return;
      }

      let isEmpty = true;
      try {
        isEmpty = (await readdir(pagesDir)).length === 0;
      } catch {}

      if (isEmpty) {
        console.log(`Cloning pages repo: ${PAGES_REPO}...`);
        await execFileAsync('git', ['clone', PAGES_REPO, pagesDir]);
        console.log('Cloned');
      } else {
        throw new Error(`Conflict: ${pagesDir} is not a git repo and is not empty. Refusing to clone into it.`);
      }
    }

    async function gitCommit() {
      await execFileAsync('git', ['-C', pagesDir, 'add', '-A']);
      const { stdout } = await execFileAsync('git', ['-C', pagesDir, 'status', '--porcelain']);
      if (stdout.trim()) {
        await execFileAsync('git', ['-C', pagesDir, 'commit', '-m', `upload ${demoDir}`]);
        await execFileAsync('git', ['-C', pagesDir, 'push']);
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
    } catch (err) {
      if (uploaded.length > 0) {
        console.error(`Partial upload state: ${uploaded.map(u => u.name).join(', ')} already copied to ${demoPath}.`);
        console.error('Retry by re-running the same command.');
      }
      throw err;
    }
  } finally {
    await rm(pagesDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
