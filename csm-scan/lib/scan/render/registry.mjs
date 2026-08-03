// Inert renderer registry — T223.
//
// Owned by T223. Registers all 17 per-repo dimension renderers in canonical
// T222 dimension order (structure, stack, config, testing, conventions, git,
// architecture, documentation, security, operations, api, data, deployment,
// maintainability, governance, assurance, practices) plus the Cross-repo
// global renderer.
//
// The ten established renderers register their render functions directly. The
// seven new dimensions register through their inert factories (the deployment
// dimension exposes only a render function, which is registered directly).
// The Cross-repo global renderer is registered as a data-only descriptor
// (module path, factory, and export name) exactly like the T222
// CROSS_REPO_GLOBAL_STAGE, so this module never imports the T221 cross-repo
// modules or the T222 dimension registry — preserving both inert contracts.
//
// Guarantees:
//   - RENDERER_SNAPSHOT lists every registered renderer in canonical dimension
//     order (17 dimensions) followed by the Cross-repo global renderer (18).
//   - verifyRenderRegistry and createRenderRegistry fail typed and sanitized
//     (never echoing caller input) on unknown, missing, or duplicate renderer
//     registrations and on invalid labels, prose, or prose privacy hazards.
//   - createRenderRegistry produces a frozen 17-dimension renderer with an
//     existing-ten-compatible render(deep) surface and a fixed render context,
//     so injected rendering is deterministic.
//   - The default write path (existing-ten) is untouched: nothing in
//     production imports this module; activation is the T224 cutover.
//
// ESM only. Zero npm deps. node: builtins only. Pure DATA; no filesystem,
// network, child-process, or executable access.

import { deepFreeze } from '../contracts/evidence.mjs';

import { DEFAULT_RENDER_CONTEXT } from './base.mjs';

import { renderArchitecture } from './architecture.mjs';
import { renderArchitectureExpanded } from './architecture-craft.mjs';
import { renderConfig } from './config.mjs';
import { renderConventions } from './conventions.mjs';
import { renderDocumentation } from './documentation.mjs';
import { renderGit } from './git.mjs';
import { renderOperations } from './operations.mjs';
import { renderSecurity } from './security.mjs';
import { renderStack } from './stack.mjs';
import { renderStructure } from './structure.mjs';
import { renderTesting } from './testing.mjs';

import { createApiRenderer } from './api.mjs';
import { createAssuranceRenderer } from './assurance.mjs';
import { createDataRenderer } from './data.mjs';
import { renderDeployment } from './deployment.mjs';
import { createGovernanceRenderer } from './governance.mjs';
import { createMaintainabilityRenderer } from './maintainability.mjs';
import { createPracticesRenderer } from './practices.mjs';

const RENDERER_ID_PATTERN = /^RND-[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$/;

const ERROR_MESSAGES = Object.freeze({
  INVALID_RENDERER: 'Renderer registry definition is invalid',
  INVALID_ORDER: 'Renderer registry order is invalid',
  UNKNOWN_RENDERER: 'Renderer registration is unknown',
  DUPLICATE_RENDERER: 'Renderer registration is duplicated',
  MISSING_RENDERER: 'Renderer registration is missing',
  INVALID_LABEL: 'Renderer label is invalid',
  INVALID_PROSE: 'Renderer prose is invalid',
  PRIVACY_HAZARD: 'Renderer prose contains a privacy hazard',
  VOICE_HIT: 'Renderer prose contains a judgmental term',
  INVALID_FINDINGS: 'Renderer findings are invalid',
  UNKNOWN_DIMENSION: 'Renderer findings contain an unknown dimension',
});

export class RenderRegistryError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] || 'Renderer registry failed');
    this.name = 'RenderRegistryError';
    this.code = code;
  }
}

// Neutral-voice guard aligned with the established renderer voice gate. Matches
// whole words so factual plural forms (for example "recommendations") are not
// flagged, mirroring the codebase voice matcher.
const REGISTRY_VOICE_TERMS = Object.freeze([
  'should', 'must', 'ought', 'shall', 'poor', 'good', 'bad', 'weak', 'strong',
  'better', 'worse', 'best', 'worst', 'recommended', 'recommendation', 'ideally',
  'unfortunately', 'concern', 'concerning', 'problem', 'anti-pattern', 'smell',
  'suboptimal', 'inadequate', 'insufficient', 'contradiction', 'contradictions',
  'inconsistent', 'inconsistency', 'conflict', 'conflicts', 'lacking',
]);

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const VOICE_PATTERN = new RegExp(
  `\\b(?:${REGISTRY_VOICE_TERMS.map(escapeRegExp).join('|')})\\b`,
  'i',
);

// Privacy guard for developer-authored static prose: emails, URL credentials,
// private keys, known token shapes, secret assignments, and absolute paths.
const PROSE_PRIVACY_PATTERN = new RegExp(
  '(?:'
  + '-----BEGIN[ ](?:RSA |EC |OPENSSH )?PRIVATE[ ]KEY-----'
  + '|\\b(?:gh[opusr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\\b'
  + '|\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b'
  + '|\\bhttps?:\\/\\/[^\\s/@:]+:[^\\s/@]+@'
  + '|\\b(?:bearer|password|passwd|secret|token|api[_-]?key|client[_-]?secret|'
  + 'access[_-]?token|refresh[_-]?token|auth[_-]?token|session)\\s*[:=]\\s*\\S+'
  + '|(?:^|[\\s"\'=(])\\/(?!\\/)[A-Za-z0-9._~-]+(?:\\/[A-Za-z0-9._~!$&\'()*+,;=:@%+-]+)*'
  + ')',
  'i',
);

/**
 * Canonical 17-dimension renderer order, in T222 dimension order.
 */
export const DIMENSION_RENDERER_ORDER = Object.freeze([
  'structure', 'stack', 'config', 'testing', 'conventions', 'git',
  'architecture', 'documentation', 'security', 'operations', 'api', 'data',
  'deployment', 'maintainability', 'governance', 'assurance', 'practices',
]);

export const DIMENSION_RENDERER_COUNT = DIMENSION_RENDERER_ORDER.length;
export const RENDERER_SNAPSHOT_COUNT = DIMENSION_RENDERER_COUNT + 1;

function prose(...lines) {
  return deepFreeze(lines.map((line) => Object.freeze(line)));
}

// Registration sources: `render` for the ten established render functions,
// `factory` for the seven new dimensions registered through their inert
// factories (deployment exposes no factory, so it registers its render
// function).
const DIMENSION_RENDERER_SOURCES = Object.freeze([
  {
    dimension: 'structure',
    rendererId: 'RND-structure-v1',
    label: 'Repository Structure',
    render: renderStructure,
    prose: prose(
      '## Repository Structure — `repository`',
      'Directory tree (max depth 4):',
      '| Extension | Files |',
      '|-----------|------:|',
    ),
  },
  {
    dimension: 'stack',
    rendererId: 'RND-stack-v1',
    label: 'Technology Stack',
    render: renderStack,
    prose: prose(
      '## Technology Stack — `repository`',
      '| Layer | Tool | Version |',
      '|-------|------|---------|',
      '| Runtime |',
      '| Language |',
      '| Framework |',
      '| Package Manager |',
      '| Package |',
      '| Module System |',
      '| Entry Point |',
      '- **Version pins**:',
      '### Dependencies',
      '### Dev Dependencies',
      '### Scripts',
      '| Script | Command |',
      '### Infrastructure',
    ),
  },
  {
    dimension: 'config',
    rendererId: 'RND-config-v1',
    label: 'Configuration',
    render: renderConfig,
    prose: prose(
      '## Configuration — `repository`',
      '| Tool | Config File | Details |',
      '|------|-------------|---------|',
      '| Lint |',
      '| Format |',
      '| Type checking |',
      '| Hooks |',
      '- **Build tools**:',
      '- **Alternative runtimes/manifests**:',
      '- **Markers present**:',
      '### NPM Scripts',
      '### CI/CD',
      '### Docker',
      '### Environment Variables',
    ),
  },
  {
    dimension: 'testing',
    rendererId: 'RND-testing-v1',
    label: 'Testing',
    render: renderTesting,
    prose: prose(
      '## Testing — `repository`',
      '- **Framework**:',
      '- **Test files**:',
      '- **Sample files**:',
      '- **Test directories**:',
      '- **Coverage**:',
      '- **Config files**:',
      '- **Test script**:',
    ),
  },
  {
    dimension: 'conventions',
    rendererId: 'RND-conventions-v1',
    label: 'Code Conventions',
    render: renderConventions,
    prose: prose(
      '## Code Conventions — `repository`',
      '- **Import style**:',
      '- **File naming**:',
      '- **Error handling**:',
      '- **Module system**:',
      '- **Comment density**:',
      '- **Symbol naming**:',
      '- **Async/await usage**:',
      '- **Unsafe blocks**:',
      '- **Unsafe usage**:',
      '- **Shell hygiene**:',
      '- **Type hints**:',
      '- **TS annotations**:',
      '### Docstrings',
      '### Language Standards',
      '### Inferred/Detected',
      '### Largest Files',
      '| File | Size |',
    ),
  },
  {
    dimension: 'git',
    rendererId: 'RND-git-v1',
    label: 'Git Practices',
    render: renderGit,
    prose: prose(
      '## Git Practices',
      '_No git repository detected._',
      '- **Overview**:',
      '- **Branch pattern**:',
      '- **Default branch**:',
      '- **Commit style**:',
      '- **PR template**:',
      '- **Issue templates**:',
      '- **Remote**:',
      '- **Contributors**:',
      '### Top Contributors',
      '| Contributor | Commits |',
      '- PR template found (`.github/PULL_REQUEST_TEMPLATE.md`)',
      '- Issue templates found (`.github/ISSUE_TEMPLATE/`)',
    ),
  },
  {
    dimension: 'architecture',
    rendererId: 'RND-architecture-v1',
    label: 'Architecture',
    render: renderArchitectureExpanded,
    prose: prose(
      '## Architecture',
      '_No source files detected for architectural analysis._',
      '### Module Graph',
      '### Layer Breakdown',
      '| Layer | Count |',
      '| Entry Points |',
      '| Core Modules |',
      '| Shared Utilities |',
      '| Other |',
      '| **Total** |',
      '### C4 — System Context',
      '### C4 — Containers',
      '### C4 — Components',
      '### C4 — Code Level',
      '### Craft Assessment',
      '| Maximum fan-in |',
      '| Maximum fan-out |',
      '| Files above fan-in threshold',
      '| Cyclic groups |',
      '| Layer-boundary edges |',
      '| Indicator | Count |',
    ),
  },
  {
    dimension: 'documentation',
    rendererId: 'RND-documentation-v1',
    label: 'Documentation',
    render: renderDocumentation,
    prose: prose(
      '## Documentation',
      '- **README**:',
      '- **CONTRIBUTING.md**:',
      '- **CODE_OF_CONDUCT.md**: present',
      '- **License**:',
      '- **Changelog**:',
      '- **Architecture Decision Records (ADRs)**:',
      '- **Comment ratio**:',
      '- **TODO/FIXME markers**:',
    ),
  },
  {
    dimension: 'security',
    rendererId: 'RND-security-v1',
    label: 'Security',
    render: renderSecurity,
    prose: prose(
      '## Security',
      '- **Secret pattern matches**:',
      '- **Authentication**:',
      '- **Security headers**:',
      '- **Input validation**:',
      '- **Rate limiting**:',
      '- **.env.example**:',
      '- **.env in .gitignore**:',
      '- **Lockfile**:',
      '- **Dependabot**:',
      '- **Security tooling**:',
      '- **Audit evidence**:',
    ),
  },
  {
    dimension: 'operations',
    rendererId: 'RND-operations-v1',
    label: 'Operations',
    render: renderOperations,
    prose: prose(
      '## Operations',
      '### Docker',
      'Docker configuration detected:',
      '### Docker Compose',
      '### CI/CD',
      '### Environment Configuration',
      '- Config directory detected (`config/`)',
      '- App config file detected',
      '- **Health checks**:',
      '- **Graceful shutdown**:',
      '- **Monitoring/Observability**:',
      '- **Makefile**: present',
      '- **Justfile**: present',
      '- **.dockerignore**: present',
      '- **Deploy scripts**: detected',
      '- **Procfile**: present (Heroku/Platform-as-a-Service)',
    ),
  },
  {
    dimension: 'api',
    rendererId: 'RND-api-v1',
    label: 'API Surface',
    factory: 'api',
    prose: prose(
      '## API Surface',
      'Declaration-backed API surface:',
      '| Method | Path | Dialect | Evidence |',
      '|--------|------|---------|----------|',
      '| Method / signature | Operation | Dialect | Evidence |',
      '### Diagnostics',
      '#### Routes',
      '#### Contracts',
      '#### RPC operations',
      '#### Events',
      '#### CLI commands',
      '#### Public exports',
    ),
  },
  {
    dimension: 'data',
    rendererId: 'RND-data-v1',
    label: 'Data Architecture',
    factory: 'data',
    prose: prose(
      '## Data Architecture',
      '> Static literal parsing of declared stores, schemas, models, migrations, keys, relations, caches, and queues. No database connection, migration execution, query plans, PII classification, or inferred lineage.',
      'Declaration-backed data architecture:',
      '### Stores',
      '### Schemas',
      '### Migrations',
      '### Entities',
      '### Fields',
      '### Keys',
      '### Relations',
      '### Caches',
      '### Queues',
      '### Data Relations & Flow Edges',
      '### Diagnostics',
    ),
  },
  {
    dimension: 'deployment',
    rendererId: 'RND-deployment-v1',
    label: 'Deployment Topology',
    render: renderDeployment,
    prose: prose(
      '## Deployment Topology',
      '> Static literal parsing of declared resources and direct references. No execution, drift, cost, availability, or security claims.',
      '- No deployment artifacts detected.',
      '### Images',
      '### Services',
      '### Resources',
      '### Topology Edges',
      '### Template Indicators',
      '### Unresolved References',
      '### Diagnostics',
    ),
  },
  {
    dimension: 'maintainability',
    rendererId: 'RND-maintainability-v1',
    label: 'Maintainability',
    factory: 'maintainability',
    prose: prose(
      '## Maintainability',
      '> Lexical, declaration-backed measurements. No quality scores, semantic-clone claims, defect prediction, or recommendations.',
      '### Measurement universe',
      '### Size distribution (measured files)',
      '### Branch-point approximation (lexical)',
      '### Exact token duplicates',
      '### Generated and vendored boundaries',
      '### Declared maintainability tools',
      '### Diagnostics',
    ),
  },
  {
    dimension: 'governance',
    rendererId: 'RND-governance-v1',
    label: 'Governance & Ownership',
    factory: 'governance',
    prose: prose(
      '## Governance & Ownership',
      'Declaration-backed governance and ownership inventory across',
      '### CODEOWNERS',
      '### Architecture Decision Records',
      '### Policies',
      '### Contribution',
      '### Review',
      '### Release',
      '### Runbooks',
      '### Support',
      '### Funding',
      '### References (explicit links)',
      '### Diagnostics',
    ),
  },
  {
    dimension: 'assurance',
    rendererId: 'RND-assurance-v1',
    label: 'Assurance & Supply Chain',
    factory: 'assurance',
    prose: prose(
      '## Assurance & Supply Chain',
      '> Static inventory of declared supply-chain evidence. No package resolution, advisory lookup, scanner execution, or signature validation.',
      'Inventory of declared supply-chain evidence:',
      '### Dependency manifests',
      '### Lockfiles',
      '### Declared pins',
      '### Dependency sources',
      '### License references',
      '### Software bill of materials',
      '### VEX documents',
      '### Static-analysis results',
      '### Tool configuration',
      '### Tool result artifacts',
      '### Accessibility artifacts',
      '### Attestations',
      '### Standards references (metadata only)',
      '### Diagnostics',
    ),
  },
  {
    dimension: 'practices',
    rendererId: 'RND-practices-v1',
    label: 'Development Practices',
    factory: 'practices',
    prose: prose(
      '## Development Practices',
      'Declaration-backed inventory of committed development-practice declarations and measured signals across',
      '### Methodology',
      '### Enforcement',
      '### Automation',
      '### Ritual',
      '### Quality Gates',
      '### Agent Workflow',
      '### Style Guide',
      '### Style Guide & Conventions',
      '#### Ruff rules',
      '#### Line length',
      '#### Docstring dialect',
      '#### Quote style',
      '#### Make targets',
      '#### Hook stages',
      '#### Gate thresholds',
      '#### Deny rules',
      '#### Plugin inventory',
      '#### Declared conventions',
      '#### Exceptions hub',
      '### Diagnostics',
    ),
  },
]);

/**
 * Data-only descriptor for the Cross-repo global renderer. Registered by
 * reference (module path, factory, export name) so the T221 cross-repo modules
 * and the T222 registry stay un-imported and inert until activation.
 */
export const CROSS_REPO_RENDERER_ENTRY = deepFreeze({
  dimension: 'cross-repo-global',
  rendererId: 'RND-cross-repo-global-v1',
  label: 'Cross-repository Architecture',
  module: 'lib/scan/cross-repo/render.mjs',
  factory: 'createCrossRepositoryRenderer',
  exportName: 'renderCrossRepositoryGlobal',
  prose: deepFreeze([
    '## Cross-repository Architecture',
    '> Declared cross-repository references resolved against exact repository and component identities across',
    '### Repository identities',
    '| Repository | VCS | Components | Packages |',
    '### Resolved edges',
    '| Kind | Source repository | Target | Reference | Scope |',
    '### External references',
    '| Kind | Repository | Reference | Evidence | Reason |',
    '### Ambiguous references',
    '| Kind | Repository | Reference | Candidates |',
    '### Unresolved identities',
    '| Repository | Reason |',
  ]),
});

function factoryRenderers(context) {
  return Object.freeze({
    api: createApiRenderer({ context }),
    data: createDataRenderer({ context }),
    maintainability: createMaintainabilityRenderer({ context }),
    governance: createGovernanceRenderer({ context }),
    assurance: createAssuranceRenderer({ context }),
    practices: createPracticesRenderer({ context }),
  });
}

function buildDefaultEntries(context) {
  const factories = factoryRenderers(context);
  return Object.freeze(DIMENSION_RENDERER_SOURCES.map((source) => {
    const render = source.factory
      ? (repoName, findings) => factories[source.factory].render(findings)
      : source.render;
    return deepFreeze({
      dimension: source.dimension,
      rendererId: source.rendererId,
      label: source.label,
      prose: source.prose,
      render,
    });
  }));
}

function rendererEntries(entries) {
  if (Array.isArray(entries)) return entries;
  if (entries instanceof Map) return [...entries.values()];
  if (entries !== null && typeof entries === 'object') return Object.values(entries);
  throw new RenderRegistryError('INVALID_RENDERER');
}

function checkProse(label, proseLines) {
  for (const line of [label, ...proseLines]) {
    if (VOICE_PATTERN.test(line)) throw new RenderRegistryError('VOICE_HIT');
    if (PROSE_PRIVACY_PATTERN.test(line)) throw new RenderRegistryError('PRIVACY_HAZARD');
  }
}

/**
 * Validate a 17-dimension renderer registration set. Fails typed and sanitized
 * on unknown, missing, or duplicate renderers and on invalid labels, prose, or
 * prose privacy hazards. Returns the frozen entries in the given order.
 */
export function verifyRenderRegistry({
  entries,
  order = DIMENSION_RENDERER_ORDER,
} = {}) {
  if (!Array.isArray(order)) throw new RenderRegistryError('INVALID_ORDER');

  const known = new Set(DIMENSION_RENDERER_ORDER);
  const ordered = [];
  const orderedSet = new Set();
  for (const dimension of order) {
    if (!known.has(dimension)) throw new RenderRegistryError('UNKNOWN_RENDERER');
    if (orderedSet.has(dimension)) throw new RenderRegistryError('DUPLICATE_RENDERER');
    orderedSet.add(dimension);
    ordered.push(dimension);
  }
  if (ordered.length !== DIMENSION_RENDERER_ORDER.length) {
    throw new RenderRegistryError('MISSING_RENDERER');
  }

  const renderers = new Map();
  const rendererIds = new Set();
  for (const entry of rendererEntries(entries)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new RenderRegistryError('INVALID_RENDERER');
    }
    const { dimension, rendererId, label, prose: proseLines, render } = entry;
    if (!known.has(dimension)) throw new RenderRegistryError('UNKNOWN_RENDERER');
    if (renderers.has(dimension)) throw new RenderRegistryError('DUPLICATE_RENDERER');
    if (typeof rendererId !== 'string' || !RENDERER_ID_PATTERN.test(rendererId)) {
      throw new RenderRegistryError('INVALID_RENDERER');
    }
    if (rendererIds.has(rendererId)) throw new RenderRegistryError('DUPLICATE_RENDERER');
    rendererIds.add(rendererId);
    if (typeof render !== 'function') throw new RenderRegistryError('INVALID_RENDERER');
    if (typeof label !== 'string' || label.length === 0) throw new RenderRegistryError('INVALID_LABEL');
    if (!Array.isArray(proseLines) || proseLines.length === 0
        || proseLines.some((line) => typeof line !== 'string' || line.length === 0)) {
      throw new RenderRegistryError('INVALID_PROSE');
    }
    checkProse(label, proseLines);
    renderers.set(dimension, entry);
  }
  if (renderers.size !== DIMENSION_RENDERER_ORDER.length
      || ordered.some((dimension) => !renderers.has(dimension))) {
    throw new RenderRegistryError('MISSING_RENDERER');
  }
  return deepFreeze(ordered.map((dimension) => renderers.get(dimension)));
}

function verifyGlobalRenderer(global) {
  if (global === null || typeof global !== 'object' || Array.isArray(global)) {
    throw new RenderRegistryError('INVALID_RENDERER');
  }
  const keys = ['dimension', 'rendererId', 'label', 'module', 'factory', 'exportName'];
  for (const key of keys) {
    if (typeof global[key] !== 'string' || global[key].length === 0) {
      throw new RenderRegistryError('INVALID_RENDERER');
    }
  }
  if (global.dimension !== 'cross-repo-global') throw new RenderRegistryError('UNKNOWN_RENDERER');
  if (!RENDERER_ID_PATTERN.test(global.rendererId)) throw new RenderRegistryError('INVALID_RENDERER');
  if (!Array.isArray(global.prose) || global.prose.length === 0
      || global.prose.some((line) => typeof line !== 'string' || line.length === 0)) {
    throw new RenderRegistryError('INVALID_PROSE');
  }
  checkProse(global.label, global.prose);
  return global;
}

/**
 * Build a validated 17-dimension renderer registry with an existing-ten
 * compatible render(deep) surface. Deterministic for a fixed context. The
 * returned snapshot holds all 18 registered renderers (17 dimensions plus the
 * Cross-repo global descriptor) in dimension order.
 */
export function createRenderRegistry({
  entries,
  order = DIMENSION_RENDERER_ORDER,
  context = DEFAULT_RENDER_CONTEXT,
  global = CROSS_REPO_RENDERER_ENTRY,
} = {}) {
  const source = entries ?? buildDefaultEntries(context);
  const validated = verifyRenderRegistry({ entries: source, order });
  const verifiedGlobal = deepFreeze(verifyGlobalRenderer(global));
  const rendererIds = new Set(validated.map((entry) => entry.rendererId));
  if (rendererIds.has(verifiedGlobal.rendererId)) throw new RenderRegistryError('DUPLICATE_RENDERER');

  const renderers = new Map(validated.map((entry) => [entry.dimension, entry.render]));
  const known = new Set(DIMENSION_RENDERER_ORDER);
  const snapshot = Object.freeze([...validated, verifiedGlobal]);

  return Object.freeze({
    order: Object.freeze(validated.map((entry) => entry.dimension)),
    entries: validated,
    snapshot,
    render(deep, { repoName = 'repository', context: renderContext = context } = {}) {
      if (!Array.isArray(deep)) throw new RenderRegistryError('INVALID_FINDINGS');
      const sections = [];
      for (const dimResult of deep) {
        if (!dimResult || !known.has(dimResult.dimension)) {
          throw new RenderRegistryError('UNKNOWN_DIMENSION');
        }
        const lines = [];
        if (dimResult.confidence) {
          const cov = typeof dimResult.coverage === 'number'
            ? dimResult.coverage
            : typeof dimResult.cohesiveness === 'number' ? dimResult.cohesiveness : 0;
          lines.push(`> Coverage: ${cov}% of scanner fields reported · basis: ${dimResult.confidence}`);
          lines.push('');
        }
        lines.push(renderers.get(dimResult.dimension)(repoName, dimResult.findings, renderContext));
        sections.push(lines.join('\n'));
      }
      return sections;
    },
  });
}

const DEFAULT_RENDERER_REGISTRY = createRenderRegistry();

/**
 * The validated default 17-dimension renderer entries in canonical order.
 */
export const DIMENSION_RENDERER_ENTRIES = DEFAULT_RENDERER_REGISTRY.entries;

/**
 * The validated default snapshot of all 18 registered renderers in dimension
 * order (17 dimensions followed by the Cross-repo global renderer).
 */
export const RENDERER_SNAPSHOT = DEFAULT_RENDERER_REGISTRY.snapshot;
