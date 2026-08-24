import fs from "node:fs";
import path from "node:path";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function importerSpecs(lockfile, importer) {
  const importerPattern = importer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const section = lockfile.match(
    new RegExp(`^  ${importerPattern}:\\n([\\s\\S]*?)(?=^  \\S.*:\\n|^packages:)`, "m"),
  );
  if (!section) return null;
  const specs = {};
  for (const match of section[1].matchAll(/^      (\S+):\n        specifier: (.+)$/gm)) {
    specs[match[1]] = match[2].trim();
  }
  return specs;
}

function packageSpecs(pkg) {
  return { ...pkg.dependencies, ...pkg.devDependencies };
}

function compareSpecs(label, manifest, lockfile) {
  const expected = packageSpecs(manifest);
  const actual = importerSpecs(lockfile, label);
  if (actual === null) return [`${label} importer missing from lockfile`];
  const issues = [];
  for (const [name, spec] of Object.entries(expected)) {
    if (actual[name] !== spec) issues.push(`${label} ${name} specifier differs from manifest`);
  }
  for (const name of Object.keys(actual)) {
    if (!(name in expected)) issues.push(`${label} ${name} is not declared in manifest`);
  }
  return issues;
}

export function checkDependencyPolicy(root) {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const rootManifest = readJson(path.join(root, "package.json"));
  const browseManifest = readJson(path.join(root, "csm-browse", "package.json"));
  const rootLock = fs.readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8");
  const browseLock = fs.readFileSync(path.join(root, "csm-browse", "pnpm-lock.yaml"), "utf8");
  const issues = [];

  for (const phrase of [
    "dependency updates are manual",
    "quarterly",
    "exact pins",
    "compatible ranges",
    "track the `ws` major",
    "isolated clean install",
    "Dependabot",
    "Renovate",
  ]) {
    if (!readme.toLowerCase().includes(phrase.toLowerCase())) {
      issues.push(`README dependency policy is missing: ${phrase}`);
    }
  }

  for (const [label, manifest] of [
    [".", rootManifest],
    ["csm-browse", browseManifest],
  ]) {
    if (manifest.packageManager !== "pnpm@10.34.5") {
      issues.push(`${label} manifest must pin packageManager to pnpm@10.34.5`);
    }
    if (manifest.engines?.node !== ">=22 <25") {
      issues.push(`${label} manifest must declare Node >=22 <25`);
    }
  }
  issues.push(...compareSpecs(".", rootManifest, rootLock));
  issues.push(...compareSpecs(".", browseManifest, browseLock));
  if (fs.existsSync(path.join(root, ".github", "dependabot.yml"))) {
    issues.push("Dependabot automation is not allowed by the manual dependency policy");
  }
  if (fs.existsSync(path.join(root, ".github", "renovate.json"))) {
    issues.push("Renovate automation is not allowed by the manual dependency policy");
  }
  return issues;
}
