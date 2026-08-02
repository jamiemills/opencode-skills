const ALL_DIMENSIONS = [
  'structure', 'stack', 'config', 'testing', 'conventions',
  'git', 'architecture', 'documentation', 'security', 'operations',
];

export async function enrich(deepResults, overview) {
  const enriched = [...deepResults];
  const contradictions = [];
  const gaps = [];
  const inferredPatterns = [];
  const cohesiveness = {};

  const dim = {};
  for (const d of enriched) {
    dim[d.dimension] = d;
  }

  for (const name of ALL_DIMENSIONS) {
    if (!dim[name]) {
      gaps.push({ dimension: name, reason: 'Not scanned — dimension missing from deep results' });
    }
  }

  // 1. Config TS strict vs conventions
  const cfg = dim.config?.findings;
  const conv = dim.conventions?.findings;
  if (cfg?.typescript?.strict && conv) {
    if (conv.importStyle?.type === 'CJS (require/module.exports)') {
      contradictions.push({
        description: 'tsconfig strict:true but code uses CommonJS require() instead of ES modules',
        dimensions: ['config', 'conventions'],
        severity: 'medium',
      });
    }
  }

  // 2. Test framework detected but no test files
  const tst = dim.testing?.findings;
  if (tst) {
    const fw = tst.framework;
    const count = tst.fileCount;
    if (fw && fw.length && fw[0] !== 'unknown' && count === 0) {
      contradictions.push({
        description: 'Test framework detected but no test files found',
        dimensions: ['testing', 'structure'],
        severity: 'medium',
      });
    }
  }

  // 3. Git commit style vs changelog format
  const gitFindings = dim.git?.findings;
  const docFindings = dim.documentation?.findings;
  if (gitFindings?.commitStyle === 'Conventional Commits' && docFindings?.changelog?.present) {
    const cl = docFindings.changelog;
    if (cl.format !== 'Keep a Changelog' && cl.format !== 'conventional') {
      contradictions.push({
        description: `Git uses conventional commits but changelog format is "${cl.format}"`,
        dimensions: ['git', 'documentation'],
        severity: 'low',
      });
    }
  }

  // 4. Stack declares module but conventions shows different import pattern
  const stk = dim.stack?.findings;
  if (conv?.importStyle && stk) {
    if (conv.importStyle.type === 'ESM (import/export)' && stk.type === 'commonjs') {
      contradictions.push({
        description: 'Code uses ESM imports but package.json type is "commonjs"',
        dimensions: ['conventions', 'stack'],
        severity: 'high',
      });
    }
    if (conv.importStyle.type === 'CJS (require/module.exports)' && stk.type === 'module') {
      contradictions.push({
        description: 'Code uses CommonJS require() but package.json type is "module"',
        dimensions: ['conventions', 'stack'],
        severity: 'high',
      });
    }
  }

  // 5. Stack framework detection vs architecture layers
  if (stk?.framework && stk.framework !== '(none)' && stk.framework !== 'unknown') {
    const arch = dim.architecture?.findings;
    if (arch?.layers && arch.layers.totalFiles === 0) {
      contradictions.push({
        description: `Stack framework "${stk.framework}" detected but architecture found no source files`,
        dimensions: ['stack', 'architecture'],
        severity: 'medium',
      });
    }
  }

  // 6. Operations dockerfiles found but security docker scanning is empty
  const ops = dim.operations?.findings;
  const sec = dim.security?.findings;
  if (ops?.dockerfiles?.length > 0 && sec) {
    if (!sec.dockerfilesScanned) {
      gaps.push({ dimension: 'security', reason: 'Docker present but security docker analysis not performed' });
    }
  }

  // Gap detection — dimensions with low signal or no substantive findings
  for (const d of enriched) {
    if (d.signal === 'low') {
      gaps.push({ dimension: d.dimension, reason: 'Low signal strength — consider providing explicit config files' });
    }
    if (!d.findings || Object.keys(d.findings).length === 0) {
      gaps.push({ dimension: d.dimension, reason: 'No findings produced by scanner' });
    }
  }

  // Detect gaps in coverage — dimensions entirely missing
  for (const name of ALL_DIMENSIONS) {
    if (!dim[name]) {
      gaps.push({ dimension: name, reason: 'Dimension not scanned — scanner not available or returned null' });
    }
  }

  // Cohesiveness scores per dimension
  const baseMap = { high: 85, medium: 55, low: 25 };
  for (const name of ALL_DIMENSIONS) {
    const d = dim[name];
    let score = d ? (baseMap[d.signal] || 50) : 20;

    if (d?.findings && Object.keys(d.findings).length > 2) score += 5;
    if (d?.findings && Object.keys(d.findings).length > 5) score += 5;

    const dimContradictions = contradictions.filter((c) => c.dimensions.includes(name));
    score -= dimContradictions.length * 15;

    cohesiveness[name] = Math.max(5, Math.min(100, score));
  }

  // Infer missing patterns
  if (conv?.fileNaming?.dominant && conv.fileNaming.dominant !== 'unknown') {
    const dist = conv.fileNaming.patterns || {};
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    const top = total > 0 ? Math.max(...Object.values(dist)) : 0;
    const conf = total > 0 ? top / total : 0.5;
    inferredPatterns.push({
      dimension: 'conventions',
      pattern: `File naming: ${conv.fileNaming.dominant} (${Math.round(conf * 100)}% of sampled files)`,
      confidence: conf,
    });
  }

  if (conv?.importStyle?.type && conv.importStyle.type !== 'unknown') {
    inferredPatterns.push({
      dimension: 'conventions',
      pattern: `Import style: ${conv.importStyle.type}`,
      confidence: conv.importStyle.type === 'Mixed (ESM + CJS)' ? 0.5 : 0.8,
    });
  }

  if (gitFindings?.commitStyle && gitFindings.commitStyle !== 'unknown') {
    inferredPatterns.push({
      dimension: 'git',
      pattern: `Commit convention: ${gitFindings.commitStyle}`,
      confidence: gitFindings.logCount > 20 ? 0.8 : 0.4,
    });
  }

  if (dim.testing?.findings?.framework && dim.testing.findings.framework[0] !== 'unknown') {
    inferredPatterns.push({
      dimension: 'testing',
      pattern: `Test framework: ${dim.testing.findings.framework.join(', ')}`,
      confidence: dim.testing.signal === 'high' ? 0.9 : 0.5,
    });
  }

  if (cfg?.typescript?.strict) {
    inferredPatterns.push({
      dimension: 'config',
      pattern: 'TypeScript strict mode enabled',
      confidence: 0.9,
    });
  }

  return { enriched, contradictions, gaps, cohesiveness, inferredPatterns };
}
