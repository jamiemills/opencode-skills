import { join, resolve } from 'node:path';
import { writeNORMS } from '../lib/scan/write.mjs';
import { survey } from '../lib/scan/survey.mjs';
import { enrich } from '../lib/scan/enrich.mjs';
import { validate } from '../lib/scan/validate.mjs';
import * as structure from '../lib/scan/deep/structure.mjs';
import * as stack from '../lib/scan/deep/stack.mjs';
import * as config from '../lib/scan/deep/config.mjs';
import * as testing from '../lib/scan/deep/testing.mjs';
import * as conventions from '../lib/scan/deep/conventions.mjs';
import * as git from '../lib/scan/deep/git.mjs';
import * as architecture from '../lib/scan/deep/architecture.mjs';

function parseArgs() {
  const args = process.argv.slice(2);
  const repos = [];
  let out = null;
  let i = 0;
  while (i < args.length) {
    if (args[i] === '--repos') {
      i++;
      while (i < args.length && !args[i].startsWith('--')) {
        repos.push(args[i]);
        i++;
      }
    } else if (args[i] === '--out') {
      i++;
      if (i < args.length && !args[i].startsWith('--')) {
        out = args[i];
        i++;
      }
    } else {
      i++;
    }
  }
  const cwd = process.cwd();
  return {
    repos: repos.length > 0 ? repos : [cwd],
    out: out ? resolve(out) : join(cwd, 'NORMS.md'),
  };
}

async function safeImport(path) {
  try {
    return await import(path);
  } catch {
    return null;
  }
}

async function deepScan(dimension, repoPath, overview) {
  switch (dimension) {
    case 'structure': return structure.scan(repoPath, overview);
    case 'stack': return stack.scan(repoPath, overview);
    case 'config': return config.scan(repoPath, overview);
    case 'testing': return testing.scan(repoPath, overview);
    case 'conventions': return conventions.scan(repoPath, overview);
    case 'git': return git.scan(repoPath, overview);
    case 'architecture': return architecture.scan(repoPath, overview);
    case 'documentation': {
      const m = await safeImport('../lib/scan/deep/documentation.mjs');
      return m?.scan(repoPath, overview);
    }
    case 'security': {
      const m = await safeImport('../lib/scan/deep/security.mjs');
      return m?.scan(repoPath, overview);
    }
    case 'operations': {
      const m = await safeImport('../lib/scan/deep/operations.mjs');
      return m?.scan(repoPath, overview);
    }
    default: return null;
  }
}

async function main() {
  const { repos, out } = parseArgs();

  const findings = {
    generated: new Date().toISOString().split('T')[0],
    repos: [],
  };

  for (const rawPath of repos) {
    const resolvedPath = resolve(rawPath);

    process.stdout.write(`[CSM] SURVEY phase — scanning ${resolvedPath}\n`);
    const overview = await survey(resolvedPath);
    process.stdout.write(`  Languages: ${overview.languages.join(', ') || 'none detected'}\n`);
    process.stdout.write(`  Files: ${overview.totalFiles}\n`);

    process.stdout.write(`[CSM] DEEP phase — dispatching 10 scanners\n`);
    const docScanner = await safeImport('../lib/scan/deep/documentation.mjs');
    const secScanner = await safeImport('../lib/scan/deep/security.mjs');
    const opsScanner = await safeImport('../lib/scan/deep/operations.mjs');

    const deepResults = await Promise.all([
      structure.scan(resolvedPath, overview),
      stack.scan(resolvedPath, overview),
      config.scan(resolvedPath, overview),
      testing.scan(resolvedPath, overview),
      conventions.scan(resolvedPath, overview),
      git.scan(resolvedPath, overview),
      architecture.scan(resolvedPath, overview),
      docScanner?.scan(resolvedPath, overview),
      secScanner?.scan(resolvedPath, overview),
      opsScanner?.scan(resolvedPath, overview),
    ]);

    const deep = deepResults.filter(Boolean);

    process.stdout.write(`[CSM] DEEP complete — ${deep.length} dimensions scanned\n`);
    for (const d of deep) {
      process.stdout.write(`  ${d.dimension}: signal=${d.signal}\n`);
    }

    process.stdout.write(`[CSM] ENRICH phase — cross-referencing findings...\n`);
    const enrichedResult = await enrich(deep, overview);
    if (enrichedResult.contradictions.length > 0) {
      for (const c of enrichedResult.contradictions) {
        process.stdout.write(`  [CONTRADICTION] ${c.description} (${c.severity})\n`);
      }
    }
    if (enrichedResult.gaps.length > 0) {
      for (const g of enrichedResult.gaps) {
        process.stdout.write(`  [GAP] ${g.dimension}: ${g.reason}\n`);
      }
    }
    if (enrichedResult.inferredPatterns.length > 0) {
      for (const p of enrichedResult.inferredPatterns) {
        process.stdout.write(`  [INFERRED] ${p.dimension}: ${p.pattern} (confidence: ${p.confidence.toFixed(1)})\n`);
      }
    }
    process.stdout.write(`  Cohesiveness: ${JSON.stringify(enrichedResult.cohesiveness)}\n`);

    process.stdout.write(`[CSM] VALIDATE phase — verifying norms...\n`);
    let validated = await validate(enrichedResult);

    let retryCount = 0;
    while (validated.needsRetry.length > 0 && retryCount < 2) {
      const weak = validated.needsRetry;
      process.stdout.write(`[CSM] Retrying ${weak.length} weak dimensions: ${weak.join(', ')}\n`);
      const retries = await Promise.all(
        weak.map((dim) => deepScan(dim, resolvedPath, overview))
      );
      const retryResults = retries.filter(Boolean);

      const merged = validated.findings.map((f) => {
        const retry = retryResults.find((r) => r.dimension === f.dimension);
        if (retry) {
          return { dimension: f.dimension, signal: retry.signal, findings: retry.findings };
        }
        return { dimension: f.dimension, signal: f.signal, findings: f.findings };
      });
      for (const r of retryResults) {
        if (!merged.find((m) => m.dimension === r.dimension)) {
          merged.push({ dimension: r.dimension, signal: r.signal, findings: r.findings });
        }
      }

      const reenriched = await enrich(merged, overview);
      validated = await validate(reenriched);
      retryCount++;
    }

    if (!validated.validated) {
      process.stdout.write(`  Note: ${validated.needsRetry.length} dimensions still weak after retries\n`);
    }

    findings.repos.push({
      overview,
      deep: validated.findings,
    });
  }

  process.stdout.write(`[CSM] WRITE phase — writing ${out}\n`);
  await writeNORMS(findings, out);
  process.stdout.write(`NORMS.md written to ${out}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
