import { isNullishFinding } from './enrich.mjs';

export async function validate(enrichResult) {
  const { enriched, contradictions, gaps, inferredPatterns = [] } = enrichResult;
  const coverage = enrichResult.coverage || enrichResult.cohesiveness || {};

  const taggedDimensions = enriched.map((dim) => {
    const dimensionCoverage = coverage[dim.dimension] ?? 0;
    const confidence = dimensionCoverage === 0
      ? 'unverified'
      : inferredPatterns.some((pattern) => pattern.dimension === dim.dimension)
        ? 'inferred'
        : 'observed';

    const tags = {};
    for (const key of Object.keys(dim.findings || {})) {
      tags[key] = isNullishFinding(dim.findings[key]) ? 'unverified' : confidence;
    }

    return {
      dimension: dim.dimension,
      signal: dim.signal,
      findings: dim.findings || {},
      confidence,
      coverage: dimensionCoverage,
      quality: dimensionCoverage,
      tags,
      cohesiveness: dimensionCoverage,
    };
  });

  const needsRetry = [];
  const signalReport = {};

  for (const dim of taggedDimensions) {
    signalReport[dim.dimension] = {
      coverage: dim.coverage,
      basis: dim.confidence,
    };

    if (dim.coverage < 40) {
      needsRetry.push(dim.dimension);
    }
  }

  const validated = needsRetry.length === 0;

  return {
    validated,
    findings: taggedDimensions,
    needsRetry,
    signalReport,
    contradictions,
    gaps,
    cohesiveness: { ...coverage },
    coverage: { ...coverage },
  };
}
