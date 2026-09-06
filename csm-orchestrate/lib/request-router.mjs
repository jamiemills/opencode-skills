"use strict";

// P2 (T003): up-front request classifier. classifyRequest maps a
// csm-orchestrate-request/1 envelope onto one (or more) routeable csm skills
// and derives the explicit capability signals a compiled graph consumes.
// Selection order: an explicit request.kind is authoritative; otherwise
// request.requestedSignals.capabilities win; otherwise text hints select
// CONDITIONAL-mode skills only. Explicit-mode skills (csm-grill, csm-plan,
// csm-build, csm-upload) are never reachable from free text (mirrors
// phase-compiler capabilityMatches; phase-compiler.mjs itself is untouched).
// csm-orchestrate has no self-route.
import canonicalCapabilities from "../capabilities.json" with { type: "json" };

const KIND_ROUTES = Object.freeze([
  { kind: "research", skill: "csm-deep-research" },
  { kind: "grill", skill: "csm-grill" },
  { kind: "plan", skill: "csm-plan" },
  { kind: "execute-plan", skill: "csm-build" },
  { kind: "bdd-tdd", skill: "csm-bdd-tdd" },
  { kind: "review", skill: "csm-review" },
  { kind: "review-python", skill: "csm-review-python" },
  { kind: "tests", skill: "csm-make-tests" },
  { kind: "scan", skill: "csm-scan" },
  { kind: "ddd", skill: "csm-ddd" },
  { kind: "browse", skill: "csm-browse" },
  { kind: "upload", skill: "csm-upload" },
  { kind: "autoresearch", skill: "csm-autoresearch" },
]);

const KINDS = Object.freeze(KIND_ROUTES.map((route) => route.kind));
const ROUTE_BY_KIND = new Map(KIND_ROUTES.map((route) => [route.kind, route.skill]));
const KIND_BY_SKILL = new Map(KIND_ROUTES.map((route) => [route.skill, route.kind]));

const MANIFEST_SKILLS = Object.freeze(canonicalCapabilities.skills.map((entry) => entry.skill));
const EXPLICIT_SKILLS = new Set(
  canonicalCapabilities.skills
    .filter((entry) => entry.activation.mode === "explicit")
    .map((entry) => entry.skill),
);

// Load-time invariant: the routing table spans exactly the capability manifest
// (13 routeable skills, never csm-orchestrate) and the explicit-mode set is
// stable. A manifest/source drift fails closed at import, before any request.
const routeSkills = KIND_ROUTES.map((route) => route.skill);
if (
  new Set(routeSkills).size !== routeSkills.length ||
  routeSkills.toSorted().join("\n") !== [...MANIFEST_SKILLS].toSorted().join("\n")
)
  throw new TypeError(
    "request-router: routing table must cover exactly the capabilities.json skill set",
  );
if (
  !["csm-grill", "csm-plan", "csm-build", "csm-upload"].every((skill) => EXPLICIT_SKILLS.has(skill))
)
  throw new TypeError("request-router: explicit-mode skill set drifted from capabilities.json");

// Text heuristics mirror phase-compiler.mjs capabilityMatches hints, scoped to
// activation-boundary verbs. Only conditional-mode skills appear here; the
// explicit-mode guard below never consults them for free-text selection.
const TEXT_HINTS = Object.freeze({
  "csm-deep-research":
    /research|how to build|external|documentation|question|evidence|look up|investigate/,
  "csm-bdd-tdd": /\bbdd\b|\btdd\b|behavior-driven|test-driven/,
  "csm-browse": /browse|screenshot|headful|login/,
  "csm-ddd": /\bdd\b|domain|dependency|repository structure|uncertainty/,
  "csm-make-tests": /coverage|characterization|mutation|generate tests|maintain tests|test suite/,
  "csm-review": /independent repository audit|audit|review/,
  "csm-review-python": /python|doctrine/,
  "csm-scan": /scan|convention|norms|repository structure/,
  "csm-autoresearch": /evolution region|autoresearch|evaluator|optimize a declared function/,
});

function failNoRoute(request, detail = "") {
  const suffix = detail ? ` ${detail}` : "";
  throw new TypeError(
    `request-router: no route selected for request${suffix}; accepted kinds are ${KINDS.join(", ")}`,
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function slugifyGoal(value) {
  const slug = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "request";
}

function requestedCapabilities(request) {
  const requested = request?.requestedSignals?.capabilities;
  if (!Array.isArray(requested)) return [];
  return [...new Set(requested)].filter((entry) => MANIFEST_SKILLS.includes(entry));
}

function textMatches(request) {
  const prompt = typeof request.prompt === "string" ? request.prompt.trim().toLowerCase() : "";
  if (!prompt) return [];
  const matches = [];
  for (const route of KIND_ROUTES) {
    const { skill } = route;
    if (EXPLICIT_SKILLS.has(skill)) continue;
    if (TEXT_HINTS[skill]?.test(prompt)) matches.push(skill);
  }
  return matches;
}

// artifactRef names the artifact the routed skill consumes; its kind is carried
// by the reference token or corpus file suffix so signals.inputs can satisfy
// the capability's required input without reading the referenced file.
function artifactRefInputs(artifactRef) {
  if (typeof artifactRef !== "string" || artifactRef.trim().length === 0) return [];
  const value = artifactRef.trim().toLowerCase();
  if (value === "plan" || value.endsWith("-csm.json") || value.endsWith("/plans")) return ["plan"];
  if (value === "approach" || value.endsWith("-approach.json") || value.endsWith("/approaches"))
    return ["approach"];
  return [];
}

function routeByKind(kind, request) {
  const skill = ROUTE_BY_KIND.get(kind);
  if (!skill) failNoRoute(request, `kind "${kind}" is not in the accepted enum`);
  return [skill];
}

export function classifyRequest(request) {
  if (!isPlainObject(request)) failNoRoute(request, "request must be a JSON object");
  const kind = typeof request.kind === "string" && request.kind.trim() !== "" ? request.kind : null;
  const prompt =
    typeof request.prompt === "string" && request.prompt.trim() !== "" ? request.prompt.trim() : "";
  const goalSlug =
    typeof request.goalSlug === "string" && request.goalSlug.trim() !== ""
      ? request.goalSlug
      : slugifyGoal(prompt);

  let routes;
  if (kind) {
    routes = routeByKind(kind, request);
  } else {
    const requested = requestedCapabilities(request);
    if (requested.length > 0) {
      routes = requested;
    } else {
      routes = textMatches(request);
      if (routes.length === 0) failNoRoute(request, "text did not match any conditional skill");
    }
  }
  const canonicalKind = routes.length === 1 ? (KIND_BY_SKILL.get(routes[0]) ?? null) : null;
  return {
    goalSlug,
    kind: kind ?? canonicalKind,
    routes,
    signals: {
      capabilities: [...routes],
      inputs: artifactRefInputs(request.artifactRef),
    },
  };
}
