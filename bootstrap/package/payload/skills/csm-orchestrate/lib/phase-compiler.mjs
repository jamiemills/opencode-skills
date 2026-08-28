"use strict";

import { digest } from "../../../lib/schema-runtime/index.mjs";
import { SUPPORTED_SKILLS, loadCapabilities, validateCapabilities } from "./capabilities.mjs";

const PHASE_ID = /^P[1-9][0-9]*$/;
const RUN_ID = /^run-[a-z0-9][a-z0-9-]{1,127}$/;
const slug = (value) =>
  (() => {
    const normalized = String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return normalized.length <= 110
      ? normalized
      : `${normalized.slice(0, 98)}-${digest(normalized).slice(7, 19)}`;
  })();
const unique = (values) => [...new Set(values)];
const signalId = (phaseId, signal) => `sig-${slug(phaseId)}-${digest(String(signal)).slice(7, 19)}`;
const schemaRevision = (schema) =>
  Number.parseInt(
    String(schema ?? "")
      .split("/")
      .at(-1),
    10,
  ) || null;

function fail(message) {
  throw new TypeError(`invalid approach phase graph: ${message}`);
}

function assertApproach(approach) {
  if (!approach || typeof approach !== "object" || Array.isArray(approach))
    fail("approach is required");
  if (approach.schema !== "csm-approach/1" || approach.schemaRevision !== 1)
    fail("canonical csm-approach/1 input is required");
  if (approach.status !== "agreed" || !RUN_ID.test(approach.runId))
    fail("approach is not agreed or has an invalid runId");
  if (!Array.isArray(approach.phases) || approach.phases.length === 0) fail("phases are required");
  const ids = new Set();
  for (const phase of approach.phases) {
    if (!phase || !PHASE_ID.test(phase.phaseId)) fail("phase IDs must be canonical Pn IDs");
    if (ids.has(phase.phaseId)) fail(`duplicate phase ID: ${phase.phaseId}`);
    ids.add(phase.phaseId);
    if (!Array.isArray(phase.dependencies)) fail(`dependencies missing for ${phase.phaseId}`);
    for (const field of [
      "title",
      "goal",
      "deliverables",
      "scope",
      "outOfScope",
      "constraints",
      "acceptanceHints",
      "context",
    ])
      if (!Array.isArray(phase[field]) && field !== "title" && field !== "goal")
        fail(`${field} missing for ${phase.phaseId}`);
    if (typeof phase.title !== "string" || typeof phase.goal !== "string")
      fail(`title and goal required for ${phase.phaseId}`);
    if (
      phase.dependencies.some(
        (dependency) =>
          !ids.has(dependency) &&
          !approach.phases.some((candidate) => candidate.phaseId === dependency),
      )
    )
      fail(`unknown dependency in ${phase.phaseId}`);
  }
  return ids;
}

function assertAcyclic(phases) {
  const byId = new Map(phases.map((phase) => [phase.phaseId, phase]));
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) fail(`dependency cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const phase of phases) visit(phase.phaseId);
}

function textFor(phase) {
  return [
    phase.title,
    phase.goal,
    ...phase.scope,
    ...phase.deliverables,
    ...phase.constraints,
    ...phase.context,
  ]
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

const PREDICATE_WORD = /^[a-z0-9][a-z0-9-]*$/;
const PREDICATE_CONNECTORS = new Set(["or", "and"]);

function tokenizePredicate(predicate) {
  if (typeof predicate !== "string" || predicate.trim().length === 0) return null;
  const words = predicate
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length || words.some((word) => !PREDICATE_WORD.test(word))) return null;
  return words;
}

function parsePredicate(predicate) {
  const words = tokenizePredicate(predicate);
  if (!words) return null;
  const terms = [];
  const connectors = [];
  let currentTerm = [];
  let previousWasConnector = true;
  const pushTerm = () => {
    if (!currentTerm.length) return false;
    terms.push(currentTerm);
    currentTerm = [];
    return true;
  };
  for (const word of words) {
    if (PREDICATE_CONNECTORS.has(word)) {
      if (previousWasConnector) return null;
      if (!pushTerm()) return null;
      connectors.push(word);
      previousWasConnector = true;
    } else {
      currentTerm.push(word);
      previousWasConnector = false;
    }
  }
  if (previousWasConnector) return null;
  if (!pushTerm()) return null;
  const orArms = [[]];
  terms.forEach((term, index) => {
    const connector = index === 0 ? null : connectors[index - 1];
    if (connector === "or" && (term.length >= 2 || term[0] === "explicit")) orArms.push([term]);
    else orArms.at(-1).push(term);
  });
  if (orArms.some((arm) => !arm.length)) return null;
  return orArms;
}

function phraseInText(words, text) {
  return words.every((word) =>
    new RegExp(`(^|[^a-z0-9-])${word.replace(/[-]/g, "\\-")}([^a-z0-9-]|$)`).test(text),
  );
}

/**
 * Evaluate a capability's `activation.predicate` as a simple condition when it
 * is parseable: `or`/`and` combine terms, a term is a phrase of words, and a
 * term starting with `explicit` is satisfied by an explicit skill request
 * (remaining words stay advisory). Phrase terms require every word to appear
 * in the phase text. A single-word `or` arm that is not `explicit`-led is
 * treated as a continuation of the preceding phrase (for example the trailing
 * "review" in "before planning or review") rather than a standalone
 * activation arm. Returns `{ evaluable: false }` when no predicate is present
 * or it cannot be parsed, so routing falls back to heuristic matching.
 */
export function evaluateActivationPredicate(capability, phase, signals) {
  const words = parsePredicate(capability?.activation?.predicate);
  if (!words) return { evaluable: false, activated: false };
  const requested = signals?.capabilities ?? signals?.routes ?? [];
  const explicit = requested.includes(capability.skill) || signals?.[capability.skill] === true;
  const text = textFor(phase ?? {});
  const termSatisfied = (term) => (term[0] === "explicit" ? explicit : phraseInText(term, text));
  for (const arm of words) {
    if (arm.every(termSatisfied)) return { evaluable: true, activated: true };
  }
  return { evaluable: true, activated: false };
}

function capabilityMatches(capability, phase, signals) {
  const requested = signals?.capabilities ?? signals?.routes ?? [];
  const explicit = requested.includes(capability.skill) || signals?.[capability.skill] === true;
  if (capability.activation.mode === "explicit") return explicit;
  if (explicit) return true;
  const predicate = evaluateActivationPredicate(capability, phase, signals);
  if (predicate.evaluable) return predicate.activated;
  const text = textFor(phase);
  const hints = {
    "csm-ddd": /\bdd\b|dependency|repository structure|uncertainty/,
    "csm-deep-research": /research|external|documentation|question|evidence/,
    "csm-scan": /convention|norms|repository structure/,
    "csm-review": /independent repository audit|audit|review/,
    "csm-review-python": /python|doctrine/,
    "csm-make-tests": /coverage|characterization|mutation|tests?/,
    "csm-bdd-tdd": /bdd|tdd|behavior-driven|test-driven/,
    "csm-build": /implementation|build|code change|deliverable/,
    "csm-upload": /publish|publication/,
    "csm-browse": /browser|screenshot|headful/,
    "csm-grill": /rough idea|approach framing/,
    "csm-plan": /canonical plan|planning/,
    "csm-autoresearch": /evolution region|autoresearch|evaluator/,
  };
  return capability.activation.mode === "conditional" && hints[capability.skill]?.test(text);
}

function requiredInputsAvailable(capability, phase, signals) {
  const available = new Set(["request", "repository", "host", ...(signals?.inputs ?? [])]);
  for (const input of capability.inputs) {
    if (input.required && !available.has(input.kind) && !available.has(input.name))
      fail(`${capability.skill} requires unavailable input ${input.name}`);
  }
}

function routeNodes(phase, capabilities, signals, completedEffects) {
  const selected = capabilities.filter((capability) =>
    capabilityMatches(capability, phase, signals),
  );
  if (selected.length === 0) fail(`no conditional route selected for ${phase.phaseId}`);
  const nodes = selected.map((capability, index) => {
    requiredInputsAvailable(capability, phase, signals);
    const effects = [...capability.effects].toSorted();
    if (
      effects.some((effect) => effect !== "read-only") &&
      (completedEffects.has(capability.idempotency.key) ||
        effects.some((effect) => completedEffects.has(effect)))
    )
      fail(`route repeats completed non-idempotent effect: ${capability.skill}`);
    const independent =
      capability.parallelism === "independent-read-only" &&
      effects.length === 1 &&
      effects[0] === "read-only";
    return Object.freeze({
      nodeId: `node-${slug(phase.phaseId)}-${slug(capability.skill)}`,
      skill: capability.skill,
      capabilityDigest: capability.digest,
      dependencies: Object.freeze(
        independent
          ? []
          : index === 0
            ? []
            : [`node-${slug(phase.phaseId)}-${slug(selected[index - 1].skill)}`],
      ),
      ordering: index,
      parallelGroup: independent ? "read-only" : null,
      requirementIds: Object.freeze([
        `req-${slug(signals?.ideaSlug ?? "approach")}-${slug(phase.phaseId)}`,
      ]),
      acceptanceSignals: Object.freeze(
        unique([
          ...phase.acceptanceHints,
          ...capability.outputs.map((output) => `typed ${output.name}`),
        ]),
      ),
      acceptanceSignalIds: Object.freeze(
        unique([
          ...phase.acceptanceHints,
          ...capability.outputs.map((output) => `typed ${output.name}`),
        ]).map((signal) => signalId(phase.phaseId, signal)),
      ),
      approvalScope: Object.freeze([...capability.permissions]),
      evidence: Object.freeze(
        capability.outputs.map((output) =>
          Object.freeze({ schema: output.schema ?? null, kind: output.kind }),
        ),
      ),
      inputs: Object.freeze(
        capability.inputs.map((input) =>
          Object.freeze({
            name: input.name,
            kind: input.kind,
            schema: input.schema ?? null,
            schemaRevision: schemaRevision(input.schema),
            required: input.required,
          }),
        ),
      ),
      outputs: Object.freeze(
        capability.outputs.map((output) =>
          Object.freeze({
            name: output.name,
            kind: output.kind,
            schema: output.schema ?? null,
            schemaRevision: schemaRevision(output.schema),
            terminal: output.terminal,
          }),
        ),
      ),
      sideEffects: Object.freeze(effects),
      idempotency: Object.freeze({
        key: capability.idempotency.key,
        mode: capability.idempotency.mode,
      }),
    });
  });
  const byNodeId = new Map(nodes.map((node) => [node.nodeId, node]));
  const edges = nodes.flatMap((consumer) =>
    consumer.dependencies.flatMap((producerNodeId) => {
      const producer = byNodeId.get(producerNodeId);
      if (!producer) fail(`unknown route producer ${producerNodeId}`);
      const available = new Set(["request", "repository", "host", ...(signals?.inputs ?? [])]);
      const matches = producer.outputs.flatMap((output) =>
        consumer.inputs
          .filter(
            (input) =>
              input.kind === output.kind &&
              input.schema === output.schema &&
              input.schemaRevision === output.schemaRevision &&
              !available.has(input.kind) &&
              !available.has(input.name),
          )
          .map((input) => ({ output, input })),
      );
      if (matches.some(({ output }) => output.schema === null))
        fail(`schema-less output cannot be handed off from ${producer.skill} to ${consumer.skill}`);
      const requiredExternalInput = consumer.inputs.some(
        (input) => input.required && !available.has(input.kind) && !available.has(input.name),
      );
      if (!matches.length && requiredExternalInput)
        fail(`no compatible handoff from ${producer.skill} to ${consumer.skill}`);
      return matches.map(({ output, input }) =>
        Object.freeze({
          edgeId: `edge-${slug(producer.nodeId)}-${slug(consumer.nodeId)}-${slug(output.name)}`,
          producerNodeId: producer.nodeId,
          producerSkill: producer.skill,
          producerOutput: output.name,
          consumerNodeId: consumer.nodeId,
          consumerSkill: consumer.skill,
          consumerInput: input.name,
          kind: output.kind,
          schema: output.schema,
          schemaRevision: output.schemaRevision,
        }),
      );
    }),
  );
  Object.defineProperty(nodes, "handoffEdges", {
    value: Object.freeze(edges),
    enumerable: false,
  });
  return Object.freeze(nodes);
}

export function selectRoutes(
  phase,
  { capabilities, signals = {}, completedEffects = new Set() } = {},
) {
  if (!phase || !Array.isArray(capabilities)) fail("capability contracts are required");
  if (
    capabilities.length !== SUPPORTED_SKILLS.length ||
    capabilities.some((capability) => !SUPPORTED_SKILLS.includes(capability.skill))
  )
    fail("complete supported capability manifest is required");
  for (const capability of capabilities)
    if (
      !capability.activation ||
      !Array.isArray(capability.inputs) ||
      !Array.isArray(capability.outputs) ||
      !Array.isArray(capability.permissions) ||
      !Array.isArray(capability.effects) ||
      !capability.idempotency
    )
      fail(`missing capability contract: ${capability.skill ?? "unknown"}`);
  return routeNodes(phase, capabilities, signals, completedEffects);
}

export async function compileApproach(
  approach,
  {
    capabilities,
    signals = {},
    graphRevision = 1,
    completedEffects = new Set(),
    parentPhaseId = null,
    phaseIdOverride = null,
  } = {},
) {
  assertApproach(approach);
  assertAcyclic(approach.phases);
  if (!Number.isInteger(graphRevision) || graphRevision < 1) fail("graphRevision must be positive");
  const loaded = capabilities ?? (await loadCapabilities());
  if (Array.isArray(loaded)) fail("complete supported capability manifest is required");
  const manifest = Array.isArray(loaded) ? { skills: loaded } : loaded;
  if (
    !manifest ||
    !Array.isArray(manifest.skills) ||
    manifest.skills.length !== SUPPORTED_SKILLS.length
  )
    fail("complete supported capability manifest is required");
  const trusted = capabilities ? await validateCapabilities(manifest) : manifest;
  const byId = new Map(approach.phases.map((phase) => [phase.phaseId, phase]));
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();
  const visit = (phase) => {
    if (visiting.has(phase.phaseId)) fail(`dependency cycle at ${phase.phaseId}`);
    if (visited.has(phase.phaseId)) return;
    visiting.add(phase.phaseId);
    for (const dependency of phase.dependencies) visit(byId.get(dependency));
    visiting.delete(phase.phaseId);
    visited.add(phase.phaseId);
    ordered.push(phase);
  };
  for (const phase of approach.phases) visit(phase);
  const phases = ordered.map((phase, ordinal) => {
    const nodes = selectRoutes(phase, {
      capabilities: trusted.skills,
      signals: { ...signals, ideaSlug: approach.ideaSlug },
      completedEffects,
    });
    const requirements = [`req-${slug(approach.ideaSlug)}-${slug(phase.phaseId)}`];
    const effects = unique(nodes.flatMap((node) => node.sideEffects));
    return Object.freeze({
      schema: "csm-orchestrate-phase/2",
      phaseId: phaseIdOverride ?? `phase-${slug(approach.ideaSlug)}-${slug(phase.phaseId)}`,
      parentPhaseId,
      runId: approach.runId,
      graphRevision,
      insertion: Object.freeze({ mode: "initial", ordinal }),
      order: ordinal,
      immutable: true,
      outcome: Object.freeze({
        title: phase.title,
        goal: phase.goal,
        deliverables: Object.freeze([...phase.deliverables]),
      }),
      scope: Object.freeze({
        include: Object.freeze([...phase.scope]),
        exclude: Object.freeze([...phase.outOfScope]),
      }),
      owner: "csm-orchestrate",
      route: nodes[0].skill,
      routeNodes: nodes,
      handoffEdges: nodes.handoffEdges,
      dependencies: Object.freeze(
        phase.dependencies.map(
          (dependency) => `phase-${slug(approach.ideaSlug)}-${slug(dependency)}`,
        ),
      ),
      requirementIds: Object.freeze(requirements),
      acceptanceSignals: Object.freeze(
        unique([...phase.acceptanceHints, `accepted outcome for ${phase.phaseId}`]),
      ),
      acceptanceSignalIds: Object.freeze(
        unique([...phase.acceptanceHints, `accepted outcome for ${phase.phaseId}`]).map((signal) =>
          signalId(phase.phaseId, signal),
        ),
      ),
      approvalScope: Object.freeze(unique(nodes.flatMap((node) => node.approvalScope))),
      evidence: Object.freeze(nodes.flatMap((node) => node.evidence)),
      sideEffects: Object.freeze(effects),
      idempotency: Object.freeze({
        key: digest({ runId: approach.runId, phaseId: phase.phaseId }),
        mode: effects.every((effect) => effect === "read-only") ? "read-only" : "required",
      }),
      checkpoint: Object.freeze({
        phaseId: `phase-${slug(approach.ideaSlug)}-${slug(phase.phaseId)}`,
        state: "planned",
        next: "validate-inputs",
      }),
      remediationBudget: 1,
      status: "planned",
    });
  });
  return Object.freeze({
    schema: "csm-orchestrate-phase-graph/1",
    runId: approach.runId,
    graphRevision,
    phases: Object.freeze(phases),
    digest: digest(phases),
  });
}

export const compilePhaseGraph = compileApproach;
