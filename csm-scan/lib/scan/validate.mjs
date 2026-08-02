const SIGNAL_STRENGTH = { high: 90, medium: 50, low: 20 };

function statusFor(score) {
  if (score >= 70) return 'strong';
  if (score >= 30) return 'moderate';
  return 'weak';
}

export async function validate(enrichResult) {
  const { enriched, contradictions, gaps, cohesiveness } = enrichResult;

  const taggedDimensions = enriched.map((dim) => {
    let confidence = 'unverified';
    if (dim.signal === 'high') confidence = 'observed';
    else if (dim.signal === 'medium') confidence = 'inferred';

    const tags = {};
    for (const key of Object.keys(dim.findings || {})) {
      tags[key] = confidence;
    }

    return {
      dimension: dim.dimension,
      signal: dim.signal,
      findings: dim.findings || {},
      confidence,
      tags,
      cohesiveness: cohesiveness[dim.dimension] ?? 50,
    };
  });

  const needsRetry = [];
  const signalReport = {};

  for (const dim of taggedDimensions) {
    const strength = SIGNAL_STRENGTH[dim.signal] || 20;
    signalReport[dim.dimension] = {
      strength,
      status: statusFor(strength),
      confidence: dim.confidence,
    };

    if (strength < 30) {
      needsRetry.push(dim.dimension);
    }
  }

  const hasContradictions = contradictions.length > 0;
  const validated = needsRetry.length === 0;

  return {
    validated,
    findings: taggedDimensions,
    needsRetry,
    signalReport,
    contradictions,
    gaps,
    cohesiveness,
  };
}
