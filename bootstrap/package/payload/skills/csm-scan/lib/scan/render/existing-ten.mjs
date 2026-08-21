import { DEFAULT_RENDER_CONTEXT } from "./base.mjs";
import { renderArchitecture } from "./architecture.mjs";
import { renderConfig } from "./config.mjs";
import { renderConventions } from "./conventions.mjs";
import { renderDocumentation } from "./documentation.mjs";
import { renderGit } from "./git.mjs";
import { renderOperations } from "./operations.mjs";
import { renderSecurity } from "./security.mjs";
import { renderStack } from "./stack.mjs";
import { renderStructure } from "./structure.mjs";
import { renderTesting } from "./testing.mjs";

export const EXISTING_TEN_RENDERER_ORDER = Object.freeze([
  "structure",
  "stack",
  "config",
  "testing",
  "conventions",
  "git",
  "architecture",
  "documentation",
  "security",
  "operations",
]);

export const EXISTING_TEN_RENDERER_MAP = Object.freeze({
  structure: renderStructure,
  stack: renderStack,
  config: renderConfig,
  testing: renderTesting,
  conventions: renderConventions,
  git: renderGit,
  architecture: renderArchitecture,
  documentation: renderDocumentation,
  security: renderSecurity,
  operations: renderOperations,
});

const ERROR_MESSAGES = Object.freeze({
  INVALID_RENDERER_MAP: "Existing-ten renderer map is invalid",
  INVALID_RENDERER_ORDER: "Existing-ten renderer order is invalid",
  UNKNOWN_RENDERER: "Existing-ten renderer definition is unknown",
  DUPLICATE_RENDERER: "Existing-ten renderer definition is duplicated",
  MISSING_RENDERER: "Existing-ten renderer definition is missing",
  INVALID_RENDERER: "Existing-ten renderer definition is invalid",
  INVALID_FINDINGS: "Existing-ten findings are invalid",
  UNKNOWN_DIMENSION: "Existing-ten findings contain an unknown dimension",
});

export class ExistingTenRendererError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] || "Existing-ten rendering failed");
    this.name = "ExistingTenRendererError";
    this.code = code;
  }
}

function rendererEntries(rendererMap) {
  if (Array.isArray(rendererMap)) return rendererMap;
  if (rendererMap instanceof Map) return [...rendererMap.entries()];
  if (rendererMap && Object.getPrototypeOf(rendererMap) === Object.prototype) {
    return Object.entries(rendererMap);
  }
  throw new ExistingTenRendererError("INVALID_RENDERER_MAP");
}

export function createExistingTenRenderer({
  rendererMap = EXISTING_TEN_RENDERER_MAP,
  order = EXISTING_TEN_RENDERER_ORDER,
} = {}) {
  if (!Array.isArray(order)) throw new ExistingTenRendererError("INVALID_RENDERER_ORDER");

  const known = new Set(EXISTING_TEN_RENDERER_ORDER);
  const ordered = [];
  const orderedSet = new Set();
  for (const dimension of order) {
    if (!known.has(dimension)) throw new ExistingTenRendererError("UNKNOWN_RENDERER");
    if (orderedSet.has(dimension)) throw new ExistingTenRendererError("DUPLICATE_RENDERER");
    orderedSet.add(dimension);
    ordered.push(dimension);
  }
  if (ordered.length !== EXISTING_TEN_RENDERER_ORDER.length) {
    throw new ExistingTenRendererError("MISSING_RENDERER");
  }

  const renderers = new Map();
  for (const entry of rendererEntries(rendererMap)) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new ExistingTenRendererError("INVALID_RENDERER_MAP");
    }
    const [dimension, renderer] = entry;
    if (!known.has(dimension)) throw new ExistingTenRendererError("UNKNOWN_RENDERER");
    if (renderers.has(dimension)) throw new ExistingTenRendererError("DUPLICATE_RENDERER");
    if (typeof renderer !== "function") throw new ExistingTenRendererError("INVALID_RENDERER");
    renderers.set(dimension, renderer);
  }
  if (
    renderers.size !== EXISTING_TEN_RENDERER_ORDER.length ||
    ordered.some((dimension) => !renderers.has(dimension))
  ) {
    throw new ExistingTenRendererError("MISSING_RENDERER");
  }

  return Object.freeze({
    order: Object.freeze([...ordered]),
    render(deep, { repoName = "repository", context = DEFAULT_RENDER_CONTEXT } = {}) {
      if (!Array.isArray(deep)) throw new ExistingTenRendererError("INVALID_FINDINGS");
      const sections = [];
      for (const dimResult of deep) {
        if (!dimResult || !known.has(dimResult.dimension)) {
          throw new ExistingTenRendererError("UNKNOWN_DIMENSION");
        }
        const lines = [];
        if (dimResult.confidence) {
          const cov =
            typeof dimResult.coverage === "number"
              ? dimResult.coverage
              : typeof dimResult.cohesiveness === "number"
                ? dimResult.cohesiveness
                : 0;
          lines.push(
            `> Coverage: ${cov}% of scanner fields reported · basis: ${dimResult.confidence}`,
          );
          lines.push("");
        }
        lines.push(renderers.get(dimResult.dimension)(repoName, dimResult.findings, context));
        sections.push(lines.join("\n"));
      }
      return sections;
    },
  });
}

export const DEFAULT_EXISTING_TEN_RENDERER = createExistingTenRenderer();
