// Stack dimension scanner.
//
// Ecosystem-aware technology-stack detection. Reads the normalized manifest
// and the ecosystem descriptor table (single source of truth) instead of
// hardcoding JS-only maps. Runtime/version/build/test/deploy findings are
// derived ONLY from static declarations (manifest fields, version files,
// workflow/container images, tool-version files); no host binary is ever
// executed and no "actual runtime" is claimed. Conflicting declarations COEXIST
// with provenance in `runtimeDeclarations`.
//
// ESM only. Zero npm deps. node: builtins only.
// Read-only with respect to the scanned repo.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { commandBroker } from '../shared/command.mjs';
import { DESCRIPTORS, detectEcosystems, descriptorFor } from '../shared/ecosystem.mjs';
import { readManifest } from '../shared/manifest.mjs';
import { extractDeclarations } from '../shared/declarations.mjs';

// Lockfile basename -> package manager name. Cross-referenced against each
// descriptor's `lockfiles` list so detection stays ecosystem-driven.
const LOCKFILE_TO_PM = {
  'uv.lock': 'uv',
  'poetry.lock': 'poetry',
  'Pipfile.lock': 'pipenv',
  'pdm.lock': 'pdm',
  'Cargo.lock': 'cargo',
  'package-lock.json': 'npm',
  'yarn.lock': 'yarn',
  'pnpm-lock.yaml': 'pnpm',
  'bun.lockb': 'bun',
  'bun.lock': 'bun',
};

// Fixed candidate artifacts whose declared versions/images feed runtime
// findings. Workflow files are enumerated (see listFiles) and appended.
const VERSION_FILE_PATHS = [
  '.nvmrc',
  '.node-version',
  '.python-version',
  '.ruby-version',
  'rust-toolchain',
  'rust-toolchain.toml',
  '.tool-versions',
];

const CONTAINER_PATHS = ['Dockerfile'];

const COMPOSE_PATHS = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

const RUNTIME_LIMITS = Object.freeze({
  maxBytes: 1 * 1024 * 1024,
  maxDepth: 12,
  maxFiles: 64,
  maxRecords: 4096,
});

const WORKFLOW_SOURCE_CAP = 16;

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function hasAnyFile(repoPath, names) {
  return names.some((n) => existsSync(join(repoPath, n)));
}

async function listFiles(repoPath, overview, broker) {
  const fromOverview = overview && Array.isArray(overview.files) && overview.files.length > 0
    ? overview.files
    : null;
  if (fromOverview) return fromOverview;
  try {
    const result = await broker.execute('rg:files', { cwd: repoPath });
    const raw = result.ok || result.noMatch ? result.stdout : '';
    return raw
      .split('\n')
      .map((s) => s.trim().replace(/\\/g, '/'))
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

function request(path, format) {
  return { path, format, sensitivity: 'internal' };
}

async function extractStaticDeclarations({ repoPath, overview, broker }) {
  const requests = [
    ...VERSION_FILE_PATHS.map((path) => request(path, 'text')),
    ...CONTAINER_PATHS.map((path) => request(path, 'text')),
    ...COMPOSE_PATHS.map((path) => request(path, 'text')),
    request('package.json', 'json'),
  ];
  const files = await listFiles(repoPath, overview, broker);
  const workflowFiles = files
    .filter((f) => f.startsWith('.github/workflows/') && /\.ya?ml$/i.test(f))
    .slice(0, WORKFLOW_SOURCE_CAP);
  for (const path of workflowFiles) requests.push(request(path, 'text'));
  return extractDeclarations({ root: repoPath, requests, options: RUNTIME_LIMITS });
}

function manifestSourceFor(rt, repoPath) {
  if (rt.manifestSource) return rt.manifestSource;
  return `manifest#${rt.manifestField}`;
}

function imageSource(declaration) {
  if (declaration.scope === 'from') return `${declaration.source.path}#FROM`;
  if (declaration.scope === 'service') return `${declaration.source.path}#service`;
  return `${declaration.source.path}#container`;
}

function runtimeEvidenceFor(descriptor, manifest, declarations, repoPath) {
  const evidence = [];
  for (const rt of descriptor.runtimes || []) {
    if (rt.manifestField && manifest && manifest[rt.manifestField] != null) {
      evidence.push({
        runtime: rt.name,
        kind: 'manifest',
        version: String(manifest[rt.manifestField]),
        source: manifestSourceFor(rt, repoPath),
      });
    }
    const versionFiles = rt.versionFiles || [];
    const toolVersions = rt.toolVersions || [];
    for (const declaration of declarations) {
      if (declaration.kind !== 'version') continue;
      const label = declaration.label;
      if (versionFiles.includes(label) || toolVersions.includes(label)) {
        evidence.push({
          runtime: rt.name,
          kind: 'version-file',
          version: declaration.value,
          source: declaration.source.path,
        });
      }
    }
    const images = rt.images || [];
    for (const declaration of declarations) {
      if (declaration.kind !== 'image') continue;
      const lower = String(declaration.label).toLowerCase();
      if (images.some((prefix) => lower.startsWith(prefix))) {
        evidence.push({
          runtime: rt.name,
          kind: 'container-image',
          version: declaration.label,
          source: imageSource(declaration),
        });
      }
    }
    for (const signal of rt.signals || []) {
      if (hasAnyFile(repoPath, [signal])) {
        evidence.push({ runtime: rt.name, kind: 'signal', version: null, source: signal });
      }
    }
  }
  return evidence;
}

function dedupeEvidence(evidence) {
  const seen = new Set();
  const out = [];
  for (const entry of evidence) {
    const key = `${entry.runtime}\0${entry.kind}\0${entry.version ?? ''}\0${entry.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  out.sort((left, right) => (
    left.runtime < right.runtime ? -1 : left.runtime > right.runtime ? 1
      : left.source < right.source ? -1 : left.source > right.source ? 1 : 0
  ));
  return out;
}

function runtimeNamesFor(descriptor, evidence, repoPath) {
  const names = [];
  for (const [index, rt] of (descriptor.runtimes || []).entries()) {
    const primary = index === 0;
    const hasSignal = evidence.some((entry) => entry.runtime === rt.name && entry.kind === 'signal');
    const hasDeclaration = evidence.some((entry) => entry.runtime === rt.name && entry.kind !== 'signal');
    if (primary || hasSignal || hasDeclaration) names.push(rt.name);
  }
  return names.length > 0 ? names : [descriptor.label];
}

function runtimeStringFor(descriptor, evidence, repoPath) {
  const names = runtimeNamesFor(descriptor, evidence, repoPath);
  const parts = evidence.map((entry) => (
    entry.kind === 'signal' ? `${entry.source} present` : `${entry.source} ${entry.version}`
  ));
  if (parts.length > 0) {
    return `${names.join(', ')} (declared: ${parts.join('; ')})`;
  }
  return `${names.join(', ')} (no declared runtime version)`;
}

function pinnedVersion(declarations, labels, toolNames) {
  for (const label of labels) {
    const hit = declarations.find((d) => d.kind === 'version' && d.label === label);
    if (hit) return hit.value;
  }
  for (const tool of toolNames) {
    const hit = declarations.find((d) => d.kind === 'version' && d.label === tool);
    if (hit) return hit.value;
  }
  return null;
}

function resolveEcosystems(overview, repoPath) {
  const ov = overview || {};
  if (ov.ecosystems && typeof ov.ecosystems === 'object' && ov.ecosystems.primary) {
    const all =
      Array.isArray(ov.ecosystems.all) && ov.ecosystems.all.length > 0
        ? ov.ecosystems.all
        : [ov.ecosystems.primary];
    return { primary: ov.ecosystems.primary, all };
  }
  const manifest = ov.manifest || readManifest(repoPath);
  const eco = detectEcosystems(
    { languages: ov.languages, languageScores: ov.languageScores },
    manifest,
  );
  return { primary: eco.primary, all: eco.all };
}

function deriveLanguage(ecosystems, manifest, languages) {
  if (ecosystems.primary) {
    const d = descriptorFor(ecosystems.primary);
    if (d) return d.label;
  }
  if (manifest && Array.isArray(manifest.ecosystems) && manifest.ecosystems.length > 0) {
    const d = descriptorFor(manifest.ecosystems[0]);
    if (d) return d.label;
  }
  if (Array.isArray(languages) && languages.length > 0) return languages[0];
  return 'Unknown';
}

function detectFrameworks(manifest, ecosystems) {
  const depNames = manifest && manifest.dependencies ? Object.keys(manifest.dependencies) : [];
  if (depNames.length === 0) return [];
  const ecoIds = ecosystems.all.length > 0 ? ecosystems.all : Object.keys(DESCRIPTORS);
  const out = [];
  const seen = new Set();
  for (const dep of depNames) {
    for (const id of ecoIds) {
      const d = descriptorFor(id);
      if (!d || !d.frameworks) continue;
      if (dep in d.frameworks) {
        const display = d.frameworks[dep] || dep;
        if (!seen.has(display)) {
          seen.add(display);
          out.push(display);
        }
        break;
      }
    }
  }
  return out;
}

function derivePackageManager(overview, repoPath, ecosystems) {
  const ov = overview || {};
  if (
    typeof ov.packageManager === 'string' &&
    ov.packageManager &&
    ov.packageManager !== 'unknown'
  ) {
    return ov.packageManager;
  }
  const ecoIds = ecosystems.all.length > 0 ? ecosystems.all : Object.keys(DESCRIPTORS);
  for (const id of ecoIds) {
    const d = descriptorFor(id);
    if (!d) continue;
    for (const lf of d.lockfiles) {
      if (existsSync(join(repoPath, lf))) {
        const pm = LOCKFILE_TO_PM[lf];
        if (pm) return pm;
      }
    }
  }
  if (ecosystems.primary) {
    const d = descriptorFor(ecosystems.primary);
    if (d && Array.isArray(d.packageManagers) && d.packageManagers.length === 1) {
      return d.packageManagers[0];
    }
  }
  return 'unknown';
}

export async function scan(repoPath, overview, broker = commandBroker) {
  const ov = overview || {};
  const pkgPath = join(repoPath, 'package.json');
  const pkg = readJSON(pkgPath);

  const manifest = ov.manifest || readManifest(repoPath);
  const ecosystems = resolveEcosystems(ov, repoPath);

  const deps = (manifest && manifest.dependencies) || {};
  const devDeps = (manifest && manifest.devDependencies) || {};

  const language = deriveLanguage(ecosystems, manifest, ov.languages);
  const packageManager = derivePackageManager(ov, repoPath, ecosystems);

  const extracted = await extractStaticDeclarations({ repoPath, overview: ov, broker });
  const declarations = extracted.declarations;

  const primaryDescriptor = ecosystems.primary ? descriptorFor(ecosystems.primary) : null;
  const evidence = dedupeEvidence(
    runtimeEvidenceFor(primaryDescriptor || {}, manifest, declarations, repoPath),
  );

  const runtime = primaryDescriptor
    ? runtimeStringFor(primaryDescriptor, evidence, repoPath)
    : 'unknown';

  const frameworksList = detectFrameworks(manifest, ecosystems);
  const framework = frameworksList.length > 0 ? frameworksList.join(', ') : 'None detected';

  const keyDeps = Object.keys(deps).slice(0, 30);
  const keyDevDeps = Object.keys(devDeps).slice(0, 30);

  const scripts = (pkg && pkg.scripts) || {};

  const hasDocker =
    existsSync(join(repoPath, 'Dockerfile')) ||
    existsSync(join(repoPath, 'docker-compose.yml')) ||
    existsSync(join(repoPath, 'docker-compose.yaml'));

  const hasCI = existsSync(join(repoPath, '.github', 'workflows'));

  // Version pins derived ONLY from static declarations. Each pin is the
  // highest-priority declared source; every source with provenance lives in
  // `runtimeDeclarations` so no single declaration is presented as "the"
  // runtime.
  const nodeVersion = (manifest && manifest.nodeVersion) != null
    ? String(manifest.nodeVersion)
    : pinnedVersion(declarations, ['.nvmrc', '.node-version'], ['nodejs']);
  const rustVersion = (manifest && manifest.rustVersion) != null
    ? String(manifest.rustVersion)
    : pinnedVersion(declarations, ['rust-toolchain', 'rust-toolchain.toml'], ['rust']);
  const requiresPython = (manifest && manifest.requiresPython) != null
    ? String(manifest.requiresPython)
    : pinnedVersion(declarations, ['.python-version'], ['python']);

  const runtimeDeclarations = evidence.map((entry) => ({
    runtime: entry.runtime,
    kind: entry.kind,
    version: entry.version,
    source: entry.source,
  }));

  const containerImages = [];
  const imageSeen = new Set();
  const workflowRunners = [];
  const runnerSeen = new Set();
  const workflowJobs = [];
  const jobSeen = new Set();
  for (const declaration of declarations) {
    if (declaration.kind === 'image') {
      const key = `${declaration.source.path}:${declaration.label}`;
      if (!imageSeen.has(key)) {
        imageSeen.add(key);
        containerImages.push({ image: declaration.label, source: imageSource(declaration) });
      }
    } else if (declaration.kind === 'environment' && declaration.scope === 'runs-on') {
      const key = `${declaration.source.path}:${declaration.label}`;
      if (!runnerSeen.has(key)) {
        runnerSeen.add(key);
        workflowRunners.push({ runner: declaration.label, source: declaration.source.path });
      }
    } else if (declaration.kind === 'job') {
      const key = `${declaration.source.path}:${declaration.label}`;
      if (!jobSeen.has(key)) {
        jobSeen.add(key);
        workflowJobs.push({ job: declaration.label, source: declaration.source.path });
      }
    }
  }

  const totalDeps = Object.keys(deps).length + Object.keys(devDeps).length;
  let signal = 'low';
  if (totalDeps > 10) signal = 'high';
  else if (totalDeps > 0) signal = 'medium';

  const isJs = !!pkg;

  return {
    dimension: 'stack',
    signal,
    findings: {
      hasPackageJson: isJs,
      name: isJs ? pkg.name || manifest.name || null : manifest.name || null,
      version: isJs ? pkg.version || manifest.version || null : manifest.version || null,
      type: isJs ? pkg.type || null : null,
      main: isJs ? pkg.main || null : null,
      language,
      runtime,
      framework,
      packageManager,
      keyDeps,
      keyDevDeps,
      deps,
      devDeps,
      scripts,
      docker: hasDocker,
      ci: hasCI,
      ecosystems: ecosystems.all,
      frameworks: frameworksList,
      nodeVersion,
      rustVersion,
      requiresPython,
      runtimeDeclarations,
      containerImages,
      workflowRunners,
      workflowJobs,
    },
  };
}
