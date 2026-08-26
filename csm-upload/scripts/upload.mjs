#!/usr/bin/env node
import { execFile } from "node:child_process";
import { constants as fsc } from "node:fs";
import { writeFile, mkdir, rm, mkdtemp, readdir, open, lstat } from "node:fs/promises";
import { once } from "node:events";
import { join, basename, dirname } from "node:path";
import { homedir, tmpdir } from "node:os";
import { readDurableJson, writeDurableJson } from "../../lib/durable-json/index.mjs";

const CONFIG_PATH = join(homedir(), ".agents", "csm-upload.json");

// F-052: every value interpolated into index.html passes through escapeHtml.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// F-052: uploaded file names must stay inside the demo directory — no path
// separators, no traversal, no hostile HTML in the generated index.
const SAFE_FILENAME_RE = /^[A-Za-z0-9._-]+$/;
const CONTENT_SCAN_MAX_BYTES = 1024 * 1024;
const MAX_INPUT_FILES = 32;
const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const SCANNED_TEXT_EXTENSIONS = new Set([
  "cjs",
  "css",
  "csv",
  "html",
  "htm",
  "ini",
  "js",
  "json",
  "log",
  "md",
  "mjs",
  "properties",
  "svg",
  "toml",
  "ts",
  "tsx",
  "txt",
  "vtt",
  "webmanifest",
  "xml",
  "yaml",
  "yml",
]);
const CONTENT_SECRET_RE =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer\s+|[A-Za-z0-9_.-]*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|token|secret|password|credential|private[_-]?key)\s*[=:]\s*[^\s"'<>]+|sk-[A-Za-z0-9]{16,}|gh[pousr]_\w{16,}|AKIA[0-9A-Z]{16}/i;
const QUOTED_SECRET_KEY_RE =
  /["'](?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|token|secret|password|credential|private[_-]?key)["']\s*:\s*["']?[^\s"'<>]+/i;
const CONTENT_PATH_RE = /(?:^|[\s"'(=])(?:\/(?!\/)|[A-Za-z]:[\\/]|\\\\|file:\/\/)[^\s"'<>]+/m;
const ACTIVE_SVG_RE = /<script\b|\bon[a-z]+\s*=|javascript\s*:/i;

async function scanSupportedContent(path, content) {
  const extension = basename(path).split(".").pop()?.toLowerCase() ?? "";
  if (!SCANNED_TEXT_EXTENSIONS.has(extension)) return;
  const size = content.byteLength;
  if (size > CONTENT_SCAN_MAX_BYTES) {
    throw new Error(
      `Content scan refused: "${basename(path)}" exceeds the ${CONTENT_SCAN_MAX_BYTES}-byte supported text limit.`,
    );
  }
  if (content.includes(0)) {
    throw new Error(`Content scan refused: "${basename(path)}" is not supported text.`);
  }
  const text = content.toString("utf8");
  if (
    CONTENT_SECRET_RE.test(text) ||
    QUOTED_SECRET_KEY_RE.test(text) ||
    CONTENT_PATH_RE.test(text)
  ) {
    throw new Error(
      `Content scan refused: "${basename(path)}" contains a credential or absolute path.`,
    );
  }
  if (extension === "svg" && ACTIVE_SVG_RE.test(text)) {
    throw new Error(`Content scan refused: "${basename(path)}" contains active SVG content.`);
  }
}

function scanDescription(description) {
  const text = String(description);
  if (Buffer.byteLength(text, "utf8") > CONTENT_SCAN_MAX_BYTES) {
    throw new Error("Description scan refused: description exceeds the supported text limit.");
  }
  if (
    text.includes("\0") ||
    CONTENT_SECRET_RE.test(text) ||
    QUOTED_SECRET_KEY_RE.test(text) ||
    CONTENT_PATH_RE.test(text)
  ) {
    throw new Error(
      "Description scan refused: description contains a credential or absolute path.",
    );
  }
}

async function snapshotInputs(paths) {
  if (paths.length > MAX_INPUT_FILES) {
    throw new Error(`Upload refused: at most ${MAX_INPUT_FILES} input files are allowed.`);
  }

  const snapshots = [];
  let totalBytes = 0;
  for (const path of paths) {
    const name = basename(path);
    const entry = await lstat(path);
    if (entry.isSymbolicLink()) {
      throw new Error(`Upload refused: source symlinks are not allowed ("${name}").`);
    }
    if (!entry.isFile()) {
      throw new Error(`Upload refused: "${name}" is not a regular file.`);
    }
    const handle = await open(path, fsc.O_RDONLY | (fsc.O_NOFOLLOW ?? 0));
    try {
      const before = await handle.stat();
      if (!before.isFile()) {
        throw new Error(`Upload refused: "${name}" is not a regular file.`);
      }
      totalBytes += before.size;
      if (totalBytes > MAX_INPUT_BYTES) {
        throw new Error(
          `Upload refused: aggregate input size exceeds the ${MAX_INPUT_BYTES}-byte limit.`,
        );
      }
      const content = await handle.readFile();
      const after = await handle.stat();
      if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs
      ) {
        throw new Error(`Upload refused: source "${name}" changed during validation.`);
      }
      await scanSupportedContent(path, content);
      snapshots.push({
        name,
        content,
        ext: name.split(".").pop().toLowerCase(),
        scanned: SCANNED_TEXT_EXTENSIONS.has(name.split(".").pop()?.toLowerCase() ?? ""),
      });
    } finally {
      await handle.close();
    }
  }
  if (snapshots.some((snapshot) => !snapshot.scanned) && !acknowledgeUnscannedBinary) {
    throw new Error(
      "Upload refused: binary content is unscanned; pass --ack-unscanned-binary to acknowledge no OCR or metadata scan.",
    );
  }
  return snapshots;
}

function assertSafeFilename(name) {
  if (!SAFE_FILENAME_RE.test(name) || name === "." || name === "..") {
    throw new Error(
      `Unsafe filename rejected: "${name}". Filenames may only contain [A-Za-z0-9._-] (no path separators, no special characters).`,
    );
  }
  if (
    /(^|[._-])(env|credentials?|secrets?|tokens?|cookies?|private[-_]?key)([._-]|$)/i.test(name) ||
    /\.(pem|key|p12|pfx|kdbx)$/i.test(name)
  ) {
    throw new Error(
      `Sensitive artifact refused: "${name}". Remove credentials or use a redacted fixture.`,
    );
  }
}

function redactDiagnostic(value) {
  return String(value)
    .replace(/(token|password|secret|api[-_]?key|authorization)=?[^\s&]+/gi, "$1=[REDACTED]")
    .replace(/\/tmp\/csm-(?:pages|upload-preview)-[^\s/]+/g, "[TEMP_PATH]");
}

const isolatedGitEnv = () => ({
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_SYSTEM: "/dev/null",
  // Tests may provide a disposable config explicitly; ambient user config is
  // never consulted.
  GIT_CONFIG_GLOBAL: process.env.CSM_UPLOAD_GIT_CONFIG || "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
});

// F-048: github/pagesRepo are interpolated into the clone URL and BASE_URL —
// validate both against their real-world charsets and construct the clone URL
// with the URL class, asserting the host stays github.com (guards '@' userinfo
// injection that would otherwise redirect pushes to an attacker host).
const GITHUB_RE = /^[A-Za-z0-9-]{1,39}$/;
const PAGES_REPO_RE = /^[A-Za-z0-9._-]+$/;

function buildCloneUrl(github, pagesRepo) {
  if (!GITHUB_RE.test(github)) {
    throw new Error(
      `Invalid GitHub username: "${github}". Usernames may only contain letters, digits, and hyphens (1-39 characters).`,
    );
  }
  if (!PAGES_REPO_RE.test(pagesRepo)) {
    throw new Error(
      `Invalid pages repository name: "${pagesRepo}". Repository names may only contain letters, digits, dots, underscores, and hyphens.`,
    );
  }
  const url = new URL(`https://github.com/${github}/${pagesRepo}.git`);
  if (url.hostname !== "github.com") {
    throw new Error(
      `Refusing to build the clone URL: resolved host is "${url.hostname}", expected github.com.`,
    );
  }
  return url;
}

const args = process.argv.slice(2);
let label = "";
const files = [];
let description = "";
let ghOverride = "";
let repoOverride = "";
let dryRun = false;
let confirmPermanent = false;
let acknowledgeUnscannedBinary = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--label" && i + 1 < args.length) label = args[++i];
  else if (args[i] === "--desc" && i + 1 < args.length) description = args[++i];
  else if (args[i] === "--github" && i + 1 < args.length) ghOverride = args[++i];
  else if (args[i] === "--repo" && i + 1 < args.length) repoOverride = args[++i];
  else if (args[i] === "--dry-run") dryRun = true;
  else if (args[i] === "--confirm-permanent") confirmPermanent = true;
  else if (args[i] === "--ack-unscanned-binary" || args[i] === "--ack-unscanned-binary-content")
    acknowledgeUnscannedBinary = true;
  else if (!args[i].startsWith("--")) files.push(args[i]);
}

if (!label) {
  console.error(
    "Usage: node scripts/upload.mjs --label <name> [--desc <text>] [--github <user>] [--repo <name>] [--dry-run] [--confirm-permanent] [--ack-unscanned-binary] <file1> [file2...]",
  );
  console.error(
    "Creates demo-YYYY-MM-DD-<label>/ on your GitHub Pages site with the uploaded files.",
  );
  console.error("--dry-run builds the index.html locally and performs no git/gh operations.");
  console.error("--confirm-permanent is required before a real commit and push.");
  console.error(
    "--ack-unscanned-binary acknowledges that binary files receive no OCR or metadata scan.",
  );
  process.exit(1);
}

async function loadConfig({ probe = true } = {}) {
  let config = {};
  let configError = null;
  try {
    config = await readDurableJson(CONFIG_PATH);
  } catch (err) {
    config = {};
    // F8-07: a missing config (ENOENT) is the normal first-run state —
    // proceed with defaults silently. Any other failure (unreadable file,
    // malformed JSON) must NOT be treated as "no config": rebuilding the
    // config and saving it would silently overwrite the user's original
    // bytes. Warn, and never write the file back in that state.
    if (err.code !== "ENOENT") configError = err;
  }

  if (
    configError === null &&
    (config === null ||
      typeof config !== "object" ||
      Array.isArray(config) ||
      (config.github !== undefined && typeof config.github !== "string") ||
      (config.pagesRepo !== undefined && typeof config.pagesRepo !== "string"))
  ) {
    configError = Object.assign(new Error("invalid config shape"), {
      code: "INVALID_CONFIG",
    });
    config = {};
  }

  if (configError) {
    const reason = configError.code || configError.message;
    console.error(
      `${CONFIG_PATH} unreadable or malformed (${reason}) — ignoring its contents for this run`,
    );
    if (!ghOverride && !repoOverride) {
      console.error(
        `Refusing to continue: proceeding on defaults would overwrite the malformed config at ${CONFIG_PATH}.`,
      );
      console.error(
        "Pass --github/--repo overrides for this run, or fix or remove the config file.",
      );
      process.exit(1);
    }
  }

  if (config.github && config.pagesRepo) return config;

  if (!config.pagesRepo) config.pagesRepo = "csm-browse-pages";

  if (!config.github && probe) {
    // F-053: ask the API for the authenticated login first — the auth-status
    // text parse below is only a fallback (it can grab the wrong account on
    // multi-account setups).
    try {
      const { stdout } = await execFileTracked("gh", ["api", "user", "--jq", ".login"], {
        timeout: 60000,
      });
      const login = stdout.trim();
      if (login) {
        config.github = login;
        console.log(`Detected GitHub account: ${config.github}`);
      }
    } catch {}

    if (!config.github) {
      try {
        const { stdout } = await execFileTracked("gh", ["auth", "status"], { timeout: 60000 });
        const match = stdout.match(/account\s+(\S+)/) || stdout.match(/as\s+(\S+)/);
        if (match) {
          config.github = match[1];
          console.log(`Detected GitHub account: ${config.github}`);
        }
      } catch {}
    }

    if (!config.github) {
      console.error("GitHub username still unset — could not determine GitHub username from gh.");
      console.error("Run `gh auth status` manually or pass --github <user>.");
      console.error(
        `Alternatively, set it manually: echo '{"github":"YOUR_USER","pagesRepo":"csm-browse-pages"}' > ${CONFIG_PATH}`,
      );
      process.exit(1);
    }
  }

  if (!probe) return config;

  // F8-07: never persist a rebuilt config over an unreadable/malformed file.
  if (!configError) {
    await mkdir(dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
    await writeDurableJson(CONFIG_PATH, config, { mode: 0o600 });
  }
  return config;
}

function buildIndexHtml(demoDir, desc, uploaded) {
  const imgs = uploaded.filter((f) => ["png", "jpg", "jpeg", "gif", "webp"].includes(f.ext));
  const vids = uploaded.filter((f) => ["webm", "mp4", "mov"].includes(f.ext));
  const other = uploaded.filter((f) => !imgs.includes(f) && !vids.includes(f));

  let html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${escapeHtml(demoDir)}</title>
<style>body{font-family:sans-serif;margin:40px;background:#111;color:#eee}img,video{max-width:100%;margin:20px 0;border:1px solid #333}.meta{color:#888;font-size:13px}a{color:#5af}</style></head>
<body>
<h1>${escapeHtml(demoDir)}</h1>`;

  if (desc) html += `<p>${escapeHtml(desc)}</p>`;
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
let previewDir = null;
let previewPath = null;
let signalCleaning = false;
const activeChildren = new Set();
const pendingSetups = new Set();
let cleanupPromise = null;

function execFileTracked(file, cmdArgs, options = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = execFile(file, cmdArgs, options, (error, stdout, stderr) => {
        activeChildren.delete(child);
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
        } else {
          resolve({ stdout, stderr });
        }
      });
    } catch (error) {
      reject(error);
      return;
    }
    activeChildren.add(child);
  });
}

async function terminateChildren() {
  const children = [...activeChildren];
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
  await Promise.all(
    children.map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await Promise.race([
        once(child, "close").catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill("SIGKILL");
        } catch {}
        try {
          await once(child, "close");
        } catch {}
      }
    }),
  );
}

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    // A signal can arrive while mkdtemp is still resolving. Wait for setup so
    // its result is tracked before removing temporary paths.
    await Promise.allSettled(pendingSetups);
    await terminateChildren();
    for (const path of [pagesDir, previewDir]) {
      if (path) {
        try {
          await rm(path, { recursive: true, force: true });
        } catch {}
      }
    }
    pagesDir = null;
    previewDir = null;
    previewPath = null;
  })();
  return cleanupPromise;
}

async function createTrackedTempDir(prefix, assign) {
  const setup = mkdtemp(join(tmpdir(), prefix));
  pendingSetups.add(setup);
  try {
    const path = await setup;
    assign(path);
    return path;
  } finally {
    pendingSetups.delete(setup);
  }
}

async function writePrivatePreview(html) {
  await createTrackedTempDir("csm-upload-preview-", (path) => {
    previewDir = path;
  });
  previewPath = join(previewDir, "index.html");
  const flags = fsc.O_WRONLY | fsc.O_CREAT | fsc.O_EXCL | (fsc.O_NOFOLLOW ?? 0);
  const handle = await open(previewPath, flags, 0o600);
  try {
    await handle.writeFile(html, "utf-8");
  } finally {
    await handle.close();
  }
  return previewPath;
}

async function cleanupOnSignal(signal) {
  if (signalCleaning) return;
  signalCleaning = true;
  await cleanup();
  process.exit(signal === "SIGINT" ? 130 : 143);
}
process.on("SIGINT", () => cleanupOnSignal("SIGINT"));
process.on("SIGTERM", () => cleanupOnSignal("SIGTERM"));

async function main() {
  if (files.length === 0) {
    console.error("No files specified");
    process.exit(1);
  }

  try {
    scanDescription(description);
  } catch (err) {
    console.error(err.message);
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

  let snapshots;
  try {
    snapshots = await snapshotInputs(files);
  } catch (err) {
    console.error(
      err.code === "ELOOP" ? "Upload refused: source symlinks are not allowed." : err.message,
    );
    process.exit(1);
  }

  // Dry-run never contacts gh and never writes the config file.
  const config = await loadConfig({ probe: !dryRun });
  const github = ghOverride || config.github || "<github-user>";
  const pagesRepo = repoOverride || config.pagesRepo;

  const PAGES_REPO =
    github === "<github-user>"
      ? `https://github.com/${github}/${pagesRepo}.git`
      : buildCloneUrl(github, pagesRepo).href;
  const BASE_URL = `https://${github}.github.io/${pagesRepo}`;

  const date = new Date().toISOString().split("T")[0];
  const demoDir = `demo-${date}-${label
    .replace(/[^a-z0-9._-]/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")}`;

  if (dryRun) {
    // F-052/F-053 dry-run: build the exact index.html locally (escaped), copy
    // nothing, run no git/gh commands — just print what WOULD be uploaded.
    const uploaded = snapshots.map(({ name, ext }) => {
      return {
        name,
        path: `${BASE_URL}/${demoDir}/${name}`,
        ext,
      };
    });

    console.log(`[dry-run] Would create ${demoDir}/ in ${PAGES_REPO}`);
    for (const u of uploaded) {
      console.log(`[dry-run] Would upload ${u.name} -> ${u.path}`);
    }

    const html = buildIndexHtml(demoDir, description, uploaded);
    const previewFile = await writePrivatePreview(html);
    console.log(`[dry-run] Local preview written to: ${previewFile}`);
    console.log(`[dry-run] Site URL would be: ${BASE_URL}/${demoDir}/`);
    return;
  }

  if (!ghOverride && !config.github) {
    console.error("GitHub username undefined — refusing to build the clone URL.");
    console.error("Run `gh auth status` manually or pass --github <user>.");
    process.exit(1);
  }

  if (!confirmPermanent) {
    console.error(
      "Refusing permanent publication: pass --confirm-permanent after reviewing the local artifact and destination.",
    );
    console.log("Status: pushed=false deployed=unverified verified=unverified");
    return;
  }

  await createTrackedTempDir("csm-pages-", (path) => {
    pagesDir = path;
  });

  try {
    const demoPath = join(pagesDir, demoDir);

    async function ensureRepo() {
      const entries = await readdir(pagesDir);
      if (entries.length > 0) {
        throw new Error(`Conflict: ${pagesDir} is not empty. Refusing to clone into it.`);
      }
      console.log(`Cloning pages repo: ${PAGES_REPO}...`);
      await execFileTracked("git", ["clone", PAGES_REPO, pagesDir], {
        timeout: 120000,
        env: isolatedGitEnv(),
      });
      console.log("Cloned");
    }

    async function gitCommit() {
      const gitOptions = { timeout: 60000, env: isolatedGitEnv() };
      async function validateRemotes() {
        const { stdout: effectiveFetch } = await execFileTracked(
          "git",
          ["-C", pagesDir, "remote", "get-url", "origin"],
          gitOptions,
        );
        const { stdout: effectivePush } = await execFileTracked(
          "git",
          ["-C", pagesDir, "remote", "get-url", "--push", "origin"],
          gitOptions,
        );
        if (effectiveFetch.trim() !== PAGES_REPO || effectivePush.trim() !== PAGES_REPO) {
          throw new Error(
            `Refusing redirected Git remote: effective fetch=${redactDiagnostic(effectiveFetch.trim())} push=${redactDiagnostic(effectivePush.trim())}`,
          );
        }
        let configOutput = "";
        try {
          ({ stdout: configOutput } = await execFileTracked(
            "git",
            [
              "-C",
              pagesDir,
              "config",
              "--get-regexp",
              "^(remote\\.origin\\.pushurl|url\\..*\\.(insteadOf|pushInsteadOf))$",
            ],
            gitOptions,
          ));
        } catch {}
        if (configOutput.trim()) {
          throw new Error("Refusing Git pushurl or URL rewrite configuration for publication.");
        }
      }

      async function sanitizeLocalRewriteConfig() {
        await execFileTracked(
          "git",
          ["-C", pagesDir, "config", "--local", "--unset-all", "remote.origin.pushurl"],
          gitOptions,
        ).catch(() => {});
        let output = "";
        await execFileTracked(
          "git",
          [
            "-C",
            pagesDir,
            "config",
            "--local",
            "--get-regexp",
            "^url\\..*\\.(insteadOf|pushInsteadOf)$",
          ],
          gitOptions,
        )
          .then(({ stdout }) => {
            output = stdout;
          })
          .catch(() => {});
        for (const line of output.split("\n")) {
          const key = line.trim().split(/\s+/, 1)[0];
          if (key)
            await execFileTracked(
              "git",
              ["-C", pagesDir, "config", "--local", "--unset-all", key],
              gitOptions,
            );
        }
      }

      await sanitizeLocalRewriteConfig();
      await validateRemotes();
      await execFileTracked(
        "git",
        [
          "-C",
          pagesDir,
          "-c",
          "user.name=csm-upload",
          "-c",
          "user.email=csm-upload@localhost",
          "add",
          "-A",
        ],
        gitOptions,
      );
      const { stdout } = await execFileTracked("git", ["-C", pagesDir, "status", "--porcelain"], {
        timeout: 60000,
        env: isolatedGitEnv(),
      });
      if (stdout.trim()) {
        await execFileTracked(
          "git",
          [
            "-C",
            pagesDir,
            "-c",
            "user.name=csm-upload",
            "-c",
            "user.email=csm-upload@localhost",
            "commit",
            "-m",
            `upload ${demoDir}`,
          ],
          gitOptions,
        );
        // Re-check after commit and immediately before the side effect. This
        // prevents a changed local remote from redirecting the push.
        await validateRemotes();
        // Pass the validated destination explicitly. Do not let a changed
        // origin, pushurl, or refspec select the final publication target.
        await execFileTracked("git", ["-C", pagesDir, "push", PAGES_REPO, "HEAD"], gitOptions);
        console.log("Status: pushed=true deployed=unverified verified=unverified");
        console.log("Pages deployment is not verified; inspect the published URL separately.");
      } else {
        console.log("Status: pushed=false deployed=unverified verified=unverified");
      }
    }

    const uploaded = [];
    try {
      await ensureRepo();
      await mkdir(demoPath, { recursive: true });

      for (const snapshot of snapshots) {
        const { name } = snapshot;
        const dest = join(demoPath, name);
        await writeFile(dest, snapshot.content, { flag: "wx" });
        uploaded.push({
          name,
          path: `${BASE_URL}/${demoDir}/${name}`,
          ext: snapshot.ext,
        });
        console.log(`Copied: ${name}`);
      }

      const html = buildIndexHtml(demoDir, description, uploaded);

      const indexPath = join(demoPath, "index.html");
      await writeFile(indexPath, html, "utf-8");
      console.log("Generated index.html");

      await gitCommit();

      const url = `${BASE_URL}/${demoDir}/`;
      console.log(url);
    } catch (err) {
      if (uploaded.length > 0) {
        console.error(
          `Partial upload state: ${uploaded.map((u) => u.name).join(", ")} were copied into the temporary directory before the failure.`,
        );
        console.error(
          "The temporary directory is removed now; re-running the same command retries the upload from scratch.",
        );
      }
      throw err;
    }
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(redactDiagnostic(err.message));
  // F-053: git/gh failures put their diagnostics in err.stderr — never drop them.
  if (err.stderr) {
    const text = Buffer.isBuffer(err.stderr) ? err.stderr.toString() : String(err.stderr);
    if (text.trim()) console.error(redactDiagnostic(text.trim()));
  }
  process.exit(1);
});
