// T225 — synthetic all-dimension plugin proof.
//
// Owned by T225. Proves the declarative plugin framework end-to-end using only
// production-exported components and a temporary injected skill root (never the
// production plugin root):
//   - A temp skill root holds `plugins/fixturelang/plugin.json` whose declarative
//     rules and provider capabilities cover ALL 15 provider dimensions (T222
//     builtin index dimension set; T202 category allowlists). It is valid per
//     the T203 schema and loads through the production `loadPlugins` loader.
//   - The Fixturelang fixture repository map (inlined below) holds `.fixturelang`
//     artifacts and manifests that the plugin rules match.
//   - `evaluateRules` over the fixture artifacts produces matches for every one
//     of the 15 provider dimensions; the production provider catalogs merge the
//     derived plugin observations into built-in results built-in-first, never
//     replacing built-in findings.
//   - The production exported pipeline `runExpandedPipeline` accepts the injected
//     skill-root registry and, at the OUTPUT level, renders plugin-labeled
//     evidence (rule ids + plugin provider id as provenance) for all 15 provider
//     dimensions in NORMS.md with byte-identical repeated runs.
//   - Removing `plugin.json` yields an empty registry; the same fixture repo then
//     renders generic artifact-only evidence through the generic fallback with
//     no plugin tokens, and the two outputs differ.
//   - `fixturelang` appears nowhere in production source (`lib/`, `scripts/`) or
//     the production plugin root.
//
// Scope (own-only): this test file, the temporary skill-root fixture created by
// the test, and the Fixturelang fixture repository map. Nothing else is edited.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdir, mkdtemp, rm, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { PROVIDER_CATEGORIES, validateProvider } from '../lib/scan/contracts/provider.mjs';
import { PROVIDER_DIMENSION_IDS } from '../lib/scan/contracts/dimension.mjs';
import { loadPlugins } from '../lib/scan/plugins/loader.mjs';
import { validatePlugin } from '../lib/scan/plugins/schema.mjs';
import { evaluateRules } from '../lib/scan/providers/rules.mjs';
import {
  pluginObservationsFromMatches,
  runtimeCatalogResults,
} from '../lib/scan/providers/runtime-catalog.mjs';
import {
  analysisPluginProviderResults,
  analysisProviderResults,
  mergeAnalysisResults,
} from '../lib/scan/providers/analysis-catalog.mjs';
import {
  assurancePluginObservations,
  assuranceCatalogResults,
} from '../lib/scan/providers/assurance-catalog.mjs';
import { GENERIC_PROVIDER_ID } from '../lib/scan/providers/generic.mjs';
import { runExpandedPipeline } from '../lib/scan/pipeline/run.mjs';
import { makeFixture, cleanupFixture } from './harness.mjs';

const execFileAsync = promisify(execFile);

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TEST_ROOT, '..');

const RUNTIME_DIMENSIONS = ['DIM-stack-v1', 'DIM-config-v1', 'DIM-testing-v1'];

// Fixture repository map for the synthetic Fixturelang language (T225). This is
// the ONLY place in the skill that knows Fixturelang content; it is deliberately
// excluded from `test/fixtures/` so the T201 fixture-inventory baseline stays
// unchanged. The artifacts below are matched by the injected plugin rules.
const FIXTURELANG_FILES = Object.freeze({
  'src/main.fixturelang': [
    ';; fixturelang main module',
    'route: /api/health',
    'entity: User',
    'service: web',
    'token=fixturelang-secret',
    '',
  ].join('\n'),
  'src/lib.fixturelang': ';; fixturelang library\n',
  'test/unit.fixturelang': ';; fixturelang unit test\n',
  'Fixturefile': 'name = "fixturelang-demo"\nversion = "1.0.0"\n',
  'fixturelang.json': '{ "name": "fixturelang-demo", "version": "1.0.0" }\n',
  'fixturelang.lock': 'lock: sha256:abcdef\n',
  'README.fixturelang': '# Fixturelang demo\n',
  'POLICY.fixturelang': 'policy: secure-by-default\n',
  'Fixtureworkflow': 'workflow: ci\n',
  'src/practice.fixturelang': ';; fixturelang practice\npractice: bdd\n',
  '.fixturelangrc': 'strict = true\n',
});

// ---------------------------------------------------------------------------
// Rule/selector design for the synthetic Fixturelang plugin
// ---------------------------------------------------------------------------
// One declarative rule per provider dimension. The category of every rule is
// allowlisted for its dimension by the T202 contract (validated against
// PROVIDER_CATEGORIES below) and declared by the plugin's single provider
// capability, so `loadPlugins` accepts the plugin unchanged.
const RULE_BLUEPRINTS = Object.freeze([
  ['DIM-stack-v1', 'language', { extensions: ['.fixturelang'] }],
  ['DIM-config-v1', 'configuration', { basenames: ['Fixturefile'] }],
  ['DIM-testing-v1', 'test_file', { artifactTokens: ['test'], extensions: ['.fixturelang'] }],
  ['DIM-conventions-v1', 'comment', { extensions: ['.fixturelang'], literal: ';;' }],
  ['DIM-architecture-v1', 'module', { artifactTokens: ['src'], extensions: ['.fixturelang'] }],
  ['DIM-documentation-v1', 'readme', { basenames: ['README.fixturelang'] }],
  ['DIM-security-v1', 'secret_pattern', { extensions: ['.fixturelang'], literal: 'token=' }],
  ['DIM-operations-v1', 'workflow', { basenames: ['Fixtureworkflow'] }],
  ['DIM-api-v1', 'route', { extensions: ['.fixturelang'], literal: 'route:' }],
  ['DIM-data-v1', 'entity', { extensions: ['.fixturelang'], literal: 'entity:' }],
  ['DIM-deployment-v1', 'service', { extensions: ['.fixturelang'], literal: 'service:' }],
  ['DIM-maintainability-v1', 'file_metric', { extensions: ['.fixturelang'] }],
  ['DIM-governance-v1', 'policy', { basenames: ['POLICY.fixturelang'] }],
  ['DIM-assurance-v1', 'manifest', { manifestNames: ['fixturelang.json'] }],
  ['DIM-practices-v1', 'methodology', { extensions: ['.fixturelang'], literal: 'practice:' }],
]);

function dimensionShort(dimensionId) {
  return dimensionId.replace(/^DIM-/, '').replace(/-v[1-9]\d*$/, '');
}

// A valid T203 plugin whose one provider declares a capability for every
// provider dimension using the T202 category allowlists, and one rule per
// dimension whose category is declared by that capability.
function fixturelangPlugin() {
  const dimensions = RULE_BLUEPRINTS.map(([dimensionId, category]) => ({
    dimensionId,
    categories: [category],
  }));
  const rules = RULE_BLUEPRINTS.map(([dimensionId, category, selectors]) => ({
    id: `RUL-fixturelang-${dimensionShort(dimensionId)}-v1`,
    label: `Fixturelang ${dimensionShort(dimensionId)}`,
    dimensionId,
    category,
    ...selectors,
  }));
  return {
    id: 'fixturelang',
    apiVersion: 1,
    label: 'Fixturelang synthetic language',
    aliases: ['fxlang'],
    providers: [{ id: 'PRV-fixturelang-v1', apiVersion: 1, dimensions }],
    rules,
  };
}

async function temporarySkillRoot(t, plugin) {
  const skillRoot = await mkdtemp(join(tmpdir(), 'csm-scan-t225-skill-'));
  t.after(() => rm(skillRoot, { recursive: true, force: true }));
  const pluginDir = join(skillRoot, 'plugins', plugin.id);
  await mkdir(pluginDir, { recursive: true });
  await writeFile(join(pluginDir, 'plugin.json'), JSON.stringify(plugin));
  return skillRoot;
}

function artifactsFromFiles(files) {
  return Object.entries(files)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, content]) => ({ path, size: Buffer.byteLength(content), content }));
}

// Run the three production provider catalogs over the fixture deep findings and
// the plugin's declarative matches, returning the merged per-dimension results.
function mergeCatalogs({ matches, deep, overview, repoPath }) {
  const byDim = Object.fromEntries(deep.map((d) => [d.dimension, d.findings]));
  const languages = overview.languages ?? [];
  const ecosystems = overview.ecosystems?.all ?? [];
  const manifestEcosystems = overview.manifest?.ecosystems ?? [];

  const runtimePluginObservations = {};
  for (const dimensionId of RUNTIME_DIMENSIONS) {
    runtimePluginObservations[dimensionId] = pluginObservationsFromMatches(
      matches.filter((m) => m.dimensionId === dimensionId),
    );
  }
  const runtime = runtimeCatalogResults({
    stack: byDim.stack,
    config: byDim.config,
    testing: byDim.testing,
    languages,
    ecosystems,
    manifestEcosystems,
    pluginObservations: runtimePluginObservations,
  });

  const analysisPlugin = analysisPluginProviderResults({ matches });
  const analysisBuiltin = analysisProviderResults({
    architecture: { findings: byDim.architecture, facts: {} },
    conventions: byDim.conventions,
    documentation: { repoPath, findings: byDim.documentation },
    practices: byDim.practices,
    generic: null,
  });
  const analysis = mergeAnalysisResults({ builtin: analysisBuiltin.results, plugin: analysisPlugin });

  const assuranceObservationsByDimension = {};
  for (const group of assurancePluginObservations(matches)) {
    assuranceObservationsByDimension[group.dimensionId] = group.observations;
  }
  const assurance = assuranceCatalogResults({
    security: byDim.security,
    operations: byDim.operations,
    api: byDim.api,
    data: byDim.data,
    deployment: byDim.deployment,
    maintainability: byDim.maintainability,
    governance: byDim.governance,
    assurance: byDim.assurance,
    languages,
    ecosystems,
    manifestEcosystems,
    pluginObservations: assuranceObservationsByDimension,
  });

  return { runtime, analysis, assurance, byDim };
}

function pluginContributed(observations) {
  return observations.filter((o) => o.matchedKey.startsWith('plugin-rule:')
    || o.matchedKey.startsWith('plugin:'));
}

// ---------------------------------------------------------------------------
// T203 validity and 14-dimension coverage of the injected skill root
// ---------------------------------------------------------------------------

test('T225 plugin fixture is valid per T203 and covers all 15 provider dimensions', async (t) => {
  const plugin = fixturelangPlugin();
  const validated = validatePlugin(plugin);
  assert.equal(validated.id, 'fixturelang');
  assert.equal(validated.providers.length, 1);
  assert.equal(validated.providers[0].dimensions.length, PROVIDER_DIMENSION_IDS.length);

  // Every capability dimension is the T222 builtin dimension set, and every
  // declared category is allowlisted by the T202 contract.
  const declared = new Set(validated.providers[0].dimensions.map((d) => d.dimensionId));
  assert.equal(declared.size, PROVIDER_DIMENSION_IDS.length);
  for (const dimensionId of PROVIDER_DIMENSION_IDS) {
    assert.ok(declared.has(dimensionId), `${dimensionId} must be declared`);
    const capability = validated.providers[0].dimensions.find((d) => d.dimensionId === dimensionId);
    for (const category of capability.categories) {
      assert.ok(PROVIDER_CATEGORIES[dimensionId].includes(category),
        `${dimensionId}:${category} must be allowlisted`);
    }
  }
  assert.ok(validateProvider(validated.providers[0]), 'provider validates in isolation');

  // One rule per provider dimension, each targeting a declared category.
  const ruleDimensions = new Set(validated.rules.map((r) => r.dimensionId));
  assert.equal(ruleDimensions.size, PROVIDER_DIMENSION_IDS.length);
  for (const dimensionId of PROVIDER_DIMENSION_IDS) {
    assert.ok(ruleDimensions.has(dimensionId), `${dimensionId} must own a rule`);
  }

  const skillRoot = await temporarySkillRoot(t, plugin);
  const registry = await loadPlugins({ skillRoot });
  assert.equal(registry.length, 1);
  assert.equal(registry[0].id, 'fixturelang');
});

// ---------------------------------------------------------------------------
// Rule evaluation over the fixture repo -> all 15 provider dimensions
// ---------------------------------------------------------------------------

test('T225 Fixturelang rules match the fixture artifacts on all 15 provider dimensions', async (t) => {
  const plugin = fixturelangPlugin();
  const skillRoot = await temporarySkillRoot(t, plugin);
  const [loaded] = await loadPlugins({ skillRoot });

  const artifacts = artifactsFromFiles(FIXTURELANG_FILES);
  const first = evaluateRules({ rules: loaded.rules, artifacts });
  const second = evaluateRules({ rules: [...loaded.rules].reverse(), artifacts: [...artifacts].reverse() });

  assert.equal(first.matches.length > 0, true);
  assert.equal(first.capped, false);
  assert.equal(JSON.stringify(first.matches), JSON.stringify(second.matches),
    'rule evaluation is insertion-order independent');

  const matchedDimensions = new Set(first.matches.map((m) => m.dimensionId));
  assert.equal(matchedDimensions.size, PROVIDER_DIMENSION_IDS.length);
  for (const dimensionId of PROVIDER_DIMENSION_IDS) {
    assert.ok(matchedDimensions.has(dimensionId), `${dimensionId} must match fixture artifacts`);
  }
  // Matches carry only rule identity + normalized path (never matched content).
  for (const match of first.matches) {
    assert.ok(typeof match.ruleId === 'string' && match.ruleId.length > 0);
    assert.ok(typeof match.path === 'string' && !match.path.includes('fixturelang-secret'));
  }
});

// ---------------------------------------------------------------------------
// Production catalogs merge plugin observations built-in-first
// ---------------------------------------------------------------------------

test('T225 plugin observations contribute to all 15 provider dimensions, built-in-first', async (t) => {
  const plugin = fixturelangPlugin();
  const skillRoot = await temporarySkillRoot(t, plugin);
  const [loaded] = await loadPlugins({ skillRoot });

  const repoPath = makeFixture('t225-repo', FIXTURELANG_FILES);
  t.after(() => cleanupFixture(repoPath));

  const artifacts = artifactsFromFiles(FIXTURELANG_FILES);
  const { matches } = evaluateRules({ rules: loaded.rules, artifacts });

  const pipeline = await runExpandedPipeline({
    repos: [repoPath],
    clock: () => '2026-07-01',
    sink: () => '',
    pluginRegistry: [loaded],
  });
  const overview = pipeline.semantic[0].overview;
  const deep = pipeline.semantic[0].deepResults;

  const { runtime, analysis, assurance, byDim } = mergeCatalogs({ matches, deep, overview, repoPath });

  // All 15 provider dimensions appear across the three merged catalogs, and
  // every result carries at least one plugin-contributed observation.
  const merged = [...runtime.results, ...analysis, ...assurance.results];
  const mergedDimensions = new Set(merged.map((r) => r.dimensionId));
  assert.equal(mergedDimensions.size, PROVIDER_DIMENSION_IDS.length);
  for (const dimensionId of PROVIDER_DIMENSION_IDS) {
    assert.ok(mergedDimensions.has(dimensionId), `${dimensionId} must appear in the merged catalogs`);
    const result = merged.find((r) => r.dimensionId === dimensionId);
    assert.ok(pluginContributed(result.observations).length > 0,
      `${dimensionId} must carry a plugin observation`);
  }

  // Built-in-first: for dimensions where a built-in result exists, the merged
  // result begins with exactly the built-in observations (never replaced).
  const runtimeWithoutPlugin = runtimeCatalogResults({
    stack: byDim.stack,
    config: byDim.config,
    testing: byDim.testing,
    languages: overview.languages ?? [],
    ecosystems: overview.ecosystems?.all ?? [],
    manifestEcosystems: overview.manifest?.ecosystems ?? [],
  });
  for (const dimensionId of RUNTIME_DIMENSIONS) {
    const builtinOnly = runtimeWithoutPlugin.results.find((r) => r.dimensionId === dimensionId);
    const mergedResult = runtime.results.find((r) => r.dimensionId === dimensionId);
    if (builtinOnly) {
      assert.deepEqual(
        mergedResult.observations.slice(0, builtinOnly.observations.length),
        builtinOnly.observations,
        `${dimensionId}: built-in observations are a prefix and never replaced`,
      );
      assert.ok(
        pluginContributed(mergedResult.observations.slice(builtinOnly.observations.length)).length > 0,
        `${dimensionId}: plugin observations are appended after the built-ins`,
      );
    }
  }

  const stack = runtime.results.find((r) => r.dimensionId === 'DIM-stack-v1');
  const stackBuiltin = runtimeWithoutPlugin.results.find((r) => r.dimensionId === 'DIM-stack-v1');
  assert.deepEqual(
    stack.observations.slice(0, stackBuiltin.observations.length),
    stackBuiltin.observations,
    'stack built-in language/runtime findings are preserved byte-identically',
  );

  // Deterministic ordering: repeated catalog merges are byte-identical.
  const again = mergeCatalogs({ matches, deep, overview, repoPath });
  assert.equal(JSON.stringify(runtime.results), JSON.stringify(again.runtime.results));
  assert.equal(JSON.stringify(analysis), JSON.stringify(again.analysis));
  assert.equal(JSON.stringify(assurance.results), JSON.stringify(again.assurance.results));
});

// ---------------------------------------------------------------------------
// Production pipeline with the injected plugin registry: output-level evidence
// ---------------------------------------------------------------------------

test('T225 runExpandedPipeline renders plugin-labeled evidence for all 15 provider dimensions and is byte-identical', async (t) => {
  const plugin = fixturelangPlugin();
  const skillRoot = await temporarySkillRoot(t, plugin);
  const [loaded] = await loadPlugins({ skillRoot });

  const repoPath = makeFixture('t225-pipe', FIXTURELANG_FILES);
  t.after(() => cleanupFixture(repoPath));
  const outDir = await mkdtemp(join(tmpdir(), 'csm-scan-t225-out-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));

  const options = {
    repos: [repoPath],
    clock: () => '2026-07-01',
  };
  const first = await runExpandedPipeline({ ...options, out: join(outDir, 'first.md'), pluginRegistry: [loaded] });
  const second = await runExpandedPipeline({ ...options, out: join(outDir, 'second.md'), pluginRegistry: [loaded] });
  assert.equal(first.markdown, second.markdown, 'repeated runs are byte-identical');
  assert.equal(first.context.pluginRegistry.length, 1, 'the injected plugin registry is threaded through the scan context');
  assert.equal(first.context.pluginRegistry[0].id, 'fixturelang');
  assert.equal(first.repos[0].deep.length, 17, 'all 17 dimensions scan the fixture repo');

  // Output level: every provider dimension renders plugin-labeled evidence.
  for (const dimensionId of PROVIDER_DIMENSION_IDS) {
    const short = dimensionId.replace(/^DIM-/, '').replace(/-v[1-9]\d*$/, '');
    assert.ok(first.markdown.includes(`RUL-fixturelang-${short}-v1`),
      `${dimensionId}: NORMS.md must contain plugin-labeled evidence`);
  }
  assert.ok(first.markdown.includes('PRV-fixturelang-v1'),
    'the plugin provider id must appear as provenance in NORMS.md');
  assert.ok(first.markdown.includes('### Provider Evidence'),
    'provider evidence sections must render in the expanded output');
});

// ---------------------------------------------------------------------------
// Generic fallback after plugin removal + no plugin tokens
// ---------------------------------------------------------------------------

test('T225 removing the plugin yields generic artifact-only evidence with no plugin tokens; the outputs differ', async (t) => {
  const plugin = fixturelangPlugin();
  const skillRoot = await temporarySkillRoot(t, plugin);
  const [loaded] = await loadPlugins({ skillRoot });

  const repoPath = makeFixture('t225-removal', FIXTURELANG_FILES);
  t.after(() => cleanupFixture(repoPath));
  const outDir = await mkdtemp(join(tmpdir(), 'csm-scan-t225-removal-out-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));

  // Remove the synthetic plugin from the temporary skill root.
  await rm(join(skillRoot, 'plugins', 'fixturelang'), { recursive: true, force: true });
  const empty = await loadPlugins({ skillRoot });
  assert.deepEqual(empty, [], 'removing plugin.json yields an empty registry');

  const files = artifactsFromFiles(FIXTURELANG_FILES).map((a) => a.path);

  // The same fixture repo, treated as an unknown language, receives only
  // artifact-only generic findings through the generic fallback.
  const runtime = runtimeCatalogResults({ languages: ['Fixturelang'], ecosystems: [], files });
  assert.equal(runtime.mode, 'generic');
  assert.ok(runtime.results.length > 0);
  assert.ok(runtime.results.every((r) => r.providerId === GENERIC_PROVIDER_ID));
  assert.ok(!runtime.results.some((r) => r.dimensionId === 'DIM-stack-v1'
    || r.dimensionId === 'DIM-config-v1' || r.dimensionId === 'DIM-testing-v1'),
  'generic mode never claims built-in stack/config/testing semantics');

  const assurance = assuranceCatalogResults({ security: {}, languages: ['Fixturelang'], ecosystems: [], files });
  assert.equal(assurance.mode, 'generic');
  assert.ok(assurance.results.every((r) => r.providerId === GENERIC_PROVIDER_ID));

  // Output level: with the plugin the repo renders plugin-labeled evidence;
  // after removal it renders generic artifact-only evidence with no plugin
  // tokens, and the two outputs differ.
  const options = {
    repos: [repoPath],
    clock: () => '2026-07-01',
  };
  const withPlugin = await runExpandedPipeline({ ...options, out: join(outDir, 'with.md'), pluginRegistry: [loaded] });
  const withoutPlugin = await runExpandedPipeline({ ...options, out: join(outDir, 'without.md') });
  const again = await runExpandedPipeline({ ...options, out: join(outDir, 'again.md') });

  assert.notEqual(withPlugin.markdown, withoutPlugin.markdown,
    'plugin evidence and generic evidence must produce different outputs');
  assert.equal(withoutPlugin.markdown, again.markdown, 'generic-mode repeated runs are byte-identical');
  assert.ok(withoutPlugin.markdown.includes('PRV-generic-artifacts-v1'),
    'the generic artifact fallback provider must render in the output');
  assert.ok(withoutPlugin.markdown.includes('### Provider Evidence'),
    'provider evidence sections render in generic mode');
  for (const token of ['RUL-fixturelang', 'PRV-fixturelang', 'Fixturelang']) {
    assert.equal(withoutPlugin.markdown.includes(token), false,
      `generic output must not contain the plugin token ${token}`);
  }
});

test('T225 fixturelang appears nowhere in production source or the production plugin root', async () => {
  const productionRoots = [join(ROOT, 'lib'), join(ROOT, 'scripts')];
  const { stdout } = await execFileAsync('rg', [
    '--files-with-matches', '--no-messages', '-i', 'fixturelang',
    ...productionRoots,
  ], { cwd: ROOT }).catch((error) => {
    if (error.code === 1) return { stdout: '' }; // no matches
    throw error;
  });
  assert.equal(stdout.trim(), '', 'production lib/ and scripts/ must not mention fixturelang');

  // The production plugin root must not exist or must not mention fixturelang.
  const pluginsRoot = join(ROOT, 'plugins');
  let absent = false;
  try {
    const { stdout: out } = await execFileAsync('rg', [
      '--files-with-matches', '--no-messages', '-i', 'fixturelang', pluginsRoot,
    ], { cwd: ROOT }).catch((error) => {
      if (error.code === 1) return { stdout: '' };
      if (error.code === 2) return { stdout: '' };
      throw error;
    });
    absent = out.trim() === '';
  } catch {
    absent = true;
  }
  assert.ok(absent, 'the production plugin root must not mention fixturelang');
});
