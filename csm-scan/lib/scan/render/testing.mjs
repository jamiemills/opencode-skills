import { DEFAULT_RENDER_CONTEXT } from './base.mjs';

export function renderTesting(repoName, findings, context = DEFAULT_RENDER_CONTEXT) {
  if (!findings) return '';
  const { escapeField } = context;
  const lines = [];
  lines.push(`## Testing — \`${escapeField(repoName)}\``);
  lines.push('');

  lines.push(`- **Framework**: ${escapeField(findings.framework.join(', '))}`);
  lines.push(`- **Test files**: ${findings.fileCount}${findings.naming.length > 0 ? ` (${escapeField(findings.naming.join(', '))})` : ''}`);

  // Disclosed test-file universe / counting rule (b14). Present only for the
  // python ecosystem, so repos without the disclosure keep byte-identical
  // output.
  if (typeof findings.countingRule === 'string' && findings.countingRule.length > 0) {
    lines.push(`- **Test file universe**: ${escapeField(findings.countingRule)}`);
  }

  if (findings.sampleFiles && findings.sampleFiles.length > 0) {
    lines.push(`- **Sample files**: \`${escapeField(findings.sampleFiles.slice(0, 10).join('`, `'))}\``);
  }

  if (findings.testDirs && findings.testDirs.length > 0) {
    lines.push(`- **Test directories**: \`${escapeField(findings.testDirs.slice(0, 5).join('`, `'))}\``);
  }

  if (findings.coverage) {
    lines.push(`- **Coverage**: ${escapeField(findings.coverage.join(', '))}`);
  }

  if (findings.configFiles) {
    lines.push(`- **Config files**: \`${escapeField(findings.configFiles.join('`, `'))}\``);
  }

  // Python meta-test classification (a10/d4) — conditional on the deep
  // scanner's metaTests fact.
  if (findings.metaTests && typeof findings.metaTests === 'object') {
    const count = Number(findings.metaTests.count) || 0;
    const names = Array.isArray(findings.metaTests.naming)
      ? findings.metaTests.naming.map((name) => `\`${escapeField(name)}\``).join(', ')
      : '';
    lines.push(`- **Meta-tests**: ${count} file(s) (${names})`);
  }

  // Python network guard (a11) — conditional on the deep scanner's
  // networkGuard fact.
  if (typeof findings.networkGuard === 'string' && findings.networkGuard.length > 0) {
    lines.push(`- **Network guard**: ${escapeField(findings.networkGuard)}`);
  }

  // Hypothesis profiles (a13) — conditional on the deep scanner's
  // hypothesisProfiles fact.
  if (Array.isArray(findings.hypothesisProfiles) && findings.hypothesisProfiles.length > 0) {
    const detail = findings.hypothesisProfiles
      .map((entry) => `${escapeField(entry.name)}=${entry.maxExamples}`)
      .join(', ');
    lines.push(`- **Hypothesis profiles**: ${findings.hypothesisProfiles.length} (${detail})`);
  }

  // Property-test inventory parity (a13) — conditional on the deep scanner's
  // propertyInventory fact.
  if (findings.propertyInventory && typeof findings.propertyInventory === 'object') {
    const tables = Number(findings.propertyInventory.tables) || 0;
    lines.push(`- **Property inventory**: present (${tables} tables)`);
  }

  // Coverage authority chain (a14/d6) — conditional on the deep scanner's
  // coverageAuthority fact.
  if (Array.isArray(findings.coverageAuthority) && findings.coverageAuthority.length > 0) {
    lines.push(`- **Coverage authority**: ${escapeField(findings.coverageAuthority.join('; '))}`);
  }

  // Marker-lane exclusions (c3) — conditional on the deep scanner's
  // testLanes fact.
  if (findings.testLanes && typeof findings.testLanes === 'object') {
    const parts = [];
    if (typeof findings.testLanes.markerSelector === 'string') {
      parts.push(`marker selector \`${escapeField(findings.testLanes.markerSelector)}\``);
    }
    if (Array.isArray(findings.testLanes.mutationPropertyFiles)) {
      parts.push(`MUTATION_PROPERTY_FILES manifest (${findings.testLanes.mutationPropertyFiles.length} file(s))`);
    }
    if (parts.length > 0) lines.push(`- **Test lanes**: ${parts.join('; ')}`);
  }

  // Autouse isolation fixtures (c3) — conditional on the deep scanner's
  // isolationFixtures fact.
  if (Array.isArray(findings.isolationFixtures) && findings.isolationFixtures.length > 0) {
    const fixtures = findings.isolationFixtures.map((name) => `\`${escapeField(name)}\``).join(', ');
    lines.push(`- **Isolation fixtures**: ${findings.isolationFixtures.length} (${fixtures})`);
  }

  // Hypothesis cache gitignore state (a26, hedged) — conditional on the deep
  // scanner's hypothesisCache fact. Wording avoids the literal `.hypothesis`
  // cache-dir string so the golden/noise gates stay green.
  if (findings.hypothesisCache && typeof findings.hypothesisCache === 'object') {
    const state = findings.hypothesisCache.gitignored
      ? 'listed in .gitignore'
      : 'not listed in .gitignore (inferred)';
    lines.push(`- **Hypothesis cache**: ${state}; scanner ignore rules cover it`);
  }

  // Declared pytest marker taxonomy — conditional on the deep scanner's
  // markers fact, so repos without a markers declaration keep byte-identical
  // output.
  if (Array.isArray(findings.markers) && findings.markers.length > 0) {
    const names = findings.markers.map((name) => `\`${escapeField(name)}\``).join(', ');
    lines.push(`- **Marker taxonomy**: ${findings.markers.length} markers (${names})`);
  }

  if (findings.script) {
    // T005: the detected package.json test script can embed secrets, so only
    // its presence is rendered — never the body.
    lines.push('- **Test script**: detected');
  }

  lines.push('');
  return lines.join('\n');
}
