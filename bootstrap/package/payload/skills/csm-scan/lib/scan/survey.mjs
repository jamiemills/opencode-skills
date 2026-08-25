import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { enumerate } from "./shared/enum.mjs";
import { readManifest } from "./shared/manifest.mjs";
import { detectEcosystems } from "./shared/ecosystem.mjs";
import { commandBroker } from "./shared/command.mjs";

function safeReporter(reporter) {
  return typeof reporter === "function" ? reporter : console.log;
}

const LANG_SIGNALS = {
  JavaScript: { exts: [".js", ".jsx", ".mjs", ".cjs"], configs: ["package.json"], weight: 3 },
  TypeScript: { exts: [".ts", ".tsx", ".mts", ".cts"], configs: ["tsconfig.json"], weight: 5 },
  Python: {
    exts: [".py", ".pyi", ".pyx"],
    configs: ["pyproject.toml", "setup.py", "setup.cfg", "Pipfile"],
    weight: 4,
  },
  Go: { exts: [".go"], configs: ["go.mod", "go.sum"], weight: 4 },
  Rust: { exts: [".rs"], configs: ["Cargo.toml", "Cargo.lock"], weight: 4 },
  Java: { exts: [".java"], configs: ["pom.xml", "build.gradle", "build.gradle.kts"], weight: 3 },
  Ruby: { exts: [".rb"], configs: ["Gemfile", "Rakefile"], weight: 3 },
  Shell: { exts: [".sh", ".bash", ".zsh"], configs: [], weight: 1 },
  Markdown: { exts: [".md", ".mdx"], configs: [], weight: 1 },
};

function scoreLanguages(files) {
  const scores = {};
  for (const f of files) {
    const name = f.split("/").pop() || "";
    const ext = name.includes(".") ? "." + name.split(".").slice(1).join(".") : "";
    const baseExt = name.includes(".") ? "." + name.split(".").pop() : "";
    for (const [lang, sig] of Object.entries(LANG_SIGNALS)) {
      if (sig.exts.includes(ext) || sig.exts.includes(baseExt)) {
        scores[lang] = (scores[lang] || 0) + 1;
      }
      if (sig.configs.includes(name)) {
        scores[lang] = (scores[lang] || 0) + 3;
      }
    }
  }
  return scores;
}

function detectFromScores(scores) {
  const entries = Object.entries(scores);
  const total = entries.reduce((sum, [, s]) => sum + s, 0);
  const threshold = Math.max(3, 0.05 * total);
  return entries
    .toSorted((a, b) => b[1] - a[1])
    .filter(([, s]) => s >= threshold)
    .map(([lang]) => lang);
}

function derivePackageManager(primary, repoPath) {
  if (primary === "python") {
    if (existsSync(join(repoPath, "uv.lock"))) return "uv";
    if (existsSync(join(repoPath, "poetry.lock"))) return "poetry";
    if (existsSync(join(repoPath, "Pipfile.lock"))) return "pipenv";
    if (existsSync(join(repoPath, "pdm.lock"))) return "pdm";
    return "pip";
  }
  if (primary === "rust") return "cargo";
  if (primary === "javascript" || primary === "typescript") {
    if (existsSync(join(repoPath, "pnpm-lock.yaml"))) return "pnpm";
    if (existsSync(join(repoPath, "yarn.lock"))) return "yarn";
    if (existsSync(join(repoPath, "bun.lock")) || existsSync(join(repoPath, "bun.lockb")))
      return "bun";
    if (existsSync(join(repoPath, "package-lock.json"))) return "npm";
    return "unknown";
  }
  if (primary === "shell") return "none";
  return "unknown";
}

function basenameOf(repoPath) {
  const norm = String(repoPath).replace(/\\/g, "/").replace(/\/+$/, "");
  return norm.split("/").pop() || String(repoPath);
}

export async function survey(repoPath, broker = commandBroker, reporter = console.log) {
  safeReporter(reporter)("  [SURVEY] Scanning <redacted-path>...");

  const { files, extCounts, totalFiles, totalBytes, gitTracked } = await enumerate(
    repoPath,
    broker,
  );
  const languageScores = scoreLanguages(files);
  const languages = detectFromScores(languageScores);

  const manifest = readManifest(repoPath);
  const ecosystems = detectEcosystems({ languages, languageScores }, manifest);

  let gitRoot = repoPath;
  let isGit = false;
  try {
    const result = await broker.execute("git:rev-parse-toplevel", { cwd: repoPath });
    if (result.ok) {
      gitRoot = result.stdout.trim();
      isGit = true;
    }
  } catch {}

  let name = basenameOf(repoPath);
  let description = "";
  if (manifest.name) name = manifest.name;
  if (manifest.description) description = manifest.description;
  if (!manifest.name) {
    try {
      const pkg = JSON.parse(await readFile(join(repoPath, "package.json"), "utf-8"));
      if (pkg.name) name = pkg.name;
      if (!description && pkg.description) description = pkg.description;
    } catch {}
  }

  const packageManager = derivePackageManager(ecosystems.primary, repoPath);

  const overview = {
    path: repoPath,
    gitRoot,
    isGit,
    name,
    description,
    languages,
    languageScores,
    packageManager,
    totalFiles,
    totalBytes,
    files,
    extCounts,
    ecosystems,
    manifest,
  };
  if (gitTracked && gitTracked.available) {
    overview.gitTrackedTotalFiles = gitTracked.totalFiles;
    overview.gitTrackedExtCounts = gitTracked.extCounts;
  }
  return overview;
}
