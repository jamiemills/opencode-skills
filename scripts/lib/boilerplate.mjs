// Canonical shared SKILL.md sections and their per-skill parameters.
// scripts/sync-skill-boilerplate.mjs regenerates (--write) or verifies
// (--check) these heading-bounded sections; check-suite fails on drift.
// Never synced: Core Rules, R&D gates, state machines, Anti-Patterns,
// Done Criteria — those are deliberately per-skill.

function tmuxBootstrap(p) {
  return `
${p.prelude}

1. In tmux (\`TMUX\` env set, or \`tmux display-message -p '#session_name'\` succeeds)? Skip — continue with ${p.step2}.
2. Skip too when the user/prompt forbade tmux, chose another multiplexer (never start tmux alongside), or tmux is missing (note it, continue without).
3. Else, before any ${p.work} work, launch this same agent invocation in a new detached session named \`${p.skill}-<goal-slug>\` (from session + prompt; lowercase, hyphen-separated, tmux-safe; \`-2\`/\`-3\` on collision): \`tmux new-session -d -s ${p.skill}-<goal-slug> 'opencode run "<original ${p.request} request>"'\` (adapt to the agent CLI).
4. Print \`Started tmux session "${p.skill}-<goal-slug>". Attach: tmux attach-session -t ${p.skill}-<goal-slug>\`, then end the invocation — tmux does the ${p.activity} from the start.
5. Only when skipped (step 2) continue into the ${p.workflow} workflow below.
`;
}

const TMUX_PARAMS = {
  "csm-plan": {
    prelude:
      "Run first — before `INTAKE`, any planning tool use, or any other section. Not a planning state.",
    step2: "planning",
    work: "planning",
    request: "planning",
    activity: "planning",
    workflow: "planning",
  },
  "csm-build": {
    prelude:
      "Run first — before `Activation Boundary` work, locating the plan, or any execution state. Not an execution state.",
    step2: "the build",
    work: "build",
    request: "build",
    activity: "build",
    workflow: "execution",
  },
  "csm-bdd-tdd": {
    prelude:
      "Run first — before `INTAKE`, any pipeline tool use, or any other section. Not a pipeline state.",
    step2: "the BDD/TDD mutation",
    work: "BDD/TDD",
    request: "BDD/TDD",
    activity: "mutation",
    workflow: "pipeline",
  },
  "csm-scan": {
    prelude:
      "Run first — before any scan, test, or analysis command or other sections. Not a scan step. Governs agent-driven skill sessions; direct human CLI runs of `scripts/scan.mjs` are out-of-scope.",
    step2: "the scan",
    work: "scan",
    request: "scan",
    activity: "scan",
    workflow: "scan",
  },
  "csm-review": {
    prelude:
      "Run first — before `INTAKE`, any review tool use, or any other section. Not a review state.",
    step2: "review",
    work: "review",
    request: "review",
    activity: "review",
    workflow: "review",
  },
  "csm-deep-research": {
    prelude: "Run first — before any research work or other sections. Not a research state.",
    step2: "research",
    work: "research",
    request: "research",
    activity: "research",
    workflow: "research",
  },
  "csm-make-tests": {
    prelude: "Run first — before INTAKE, locating the plan, or any generation work. Not a generation state.",
    step2: "generation",
    work: "generation",
    request: "generation",
    activity: "generation",
    workflow: "generation",
  },
};

function subagentResilience(p) {
  const body = `
${p.intro}

1. Minimal-prompt retry of the same agent.
2. Re-dispatch with narrowed scope.
3. Fresh agent.
4. ${p.step4}
5. On quota-type failures (429, rate-limit, out-of-credits, context-length-exceeded) do NOT run the retry ladder — one short backoff retry for transient signals only; hard exhaustion surfaces to the primary agent for pause/stop.
`;
  return p.guard ? `${body}\n${p.guard}\n` : body;
}

const RESILIENCE_PARAMS = {
  "csm-grill": {
    intro: "Fallback ladder — journal every incident, never silently:",
    step4: "Primary completion of research and synthesis with a recorded independence caveat.",
    guard:
      "SCOUT and DEEP_DIVE dispatches must never silently degrade to primary-only research for a large idea — when the ladder lands on step 4, record the independence caveat and surface it to the user as a parked open question.",
  },
  "csm-plan": {
    intro:
      "Fallback ladder for `RESEARCH`, `CRITIQUE`, and `REMEDIATE` dispatches — journal every incident, never silently:",
    step4:
      "Primary completion (evidence gathering) / primary-led critique or review (low-risk only, with a recorded independence caveat).",
    guard:
      'Critical or high-uncertainty findings never bypass independent critique because of subagent failure — keep retrying, or cap the finding\'s confidence and record a "critique unavailable" caveat in the progress journal.',
  },
  "csm-review": {
    intro: "Fallback ladder — journal every incident, never silently:",
    step4:
      "Primary completion (evidence gathering) / primary-led challenge (low/info findings only, recorded independence caveat).",
    guard:
      'Critical/high/medium findings never bypass independent challenge because of subagent failure — keep retrying, or cap the finding\'s confidence at medium with a "challenge unavailable" caveat recorded in the finding record and surfaced in residual unknowns.',
  },
  "csm-bdd-tdd": {
    intro:
      "Fallback ladder when a pipeline subagent (SPEC, SCENARIOS, VALIDATE, TEST_DESIGN) fails — journal every incident in `specs/control.md`, never silently:",
    step4:
      "Primary completion of the spec/validation work, with a recorded independence caveat when the primary agent fills in for an independent agent.",
    guard: null,
  },
  "csm-deep-research": {
    intro:
      "Fallback ladder for `RESEARCHER`, `CHALLENGER`, and `JUDGE` dispatches — journal every incident, never silently:",
    step4: "Primary completion of research and synthesis with a recorded independence caveat.",
    guard:
      "RESEARCHER and CHALLENGER dispatches must never silently degrade to primary-only research for a STANDARD/DEEP query — when the ladder lands on step 4, record the independence caveat and surface it in the report's residual unknowns.",
  },
};

// Registry: skill -> section title -> { level, render }
const SYNC_SECTIONS = {};
for (const [skill, params] of Object.entries(TMUX_PARAMS)) {
  SYNC_SECTIONS[skill] = SYNC_SECTIONS[skill] || {};
  SYNC_SECTIONS[skill]["Tmux Session Bootstrap"] = {
    level: 2,
    render: () => tmuxBootstrap({ ...params, skill }),
  };
}
for (const [skill, params] of Object.entries(RESILIENCE_PARAMS)) {
  SYNC_SECTIONS[skill] = SYNC_SECTIONS[skill] || {};
  SYNC_SECTIONS[skill]["Subagent Resilience"] = {
    level: skill === "csm-bdd-tdd" ? 3 : 2,
    render: () => subagentResilience(params),
  };
}

export { SYNC_SECTIONS };
