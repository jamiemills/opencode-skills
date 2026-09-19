// Canonical shared SKILL.md sections and their per-skill parameters.
// scripts/sync-skill-boilerplate.mjs regenerates (--write) or verifies
// (--check) these heading-bounded sections; check-suite fails on drift.
// Never synced: Core Rules, R&D gates, state machines, Anti-Patterns,
// Done Criteria — those are deliberately per-skill.

function tmuxBootstrap(p) {
  const launch = p.argvSafe
    ? `write the original request to a mode-600 temporary prompt file, then launch it without shell interpolation: \`tmux new-session -d -s "$session" -- <agent-cli> run --prompt-file "$prompt_file"\`; verify the launched invocation received the exact request before ending this invocation`
    : `launch this same agent invocation in a new detached session named \`${p.skill}-<goal-slug>\` (use a suffix such as \`-2\` or \`-3\` if that name is already taken): \`tmux new-session -d -s ${p.skill}-<goal-slug> 'opencode run "<original ${p.request} request>"'\` (adapt to the agent CLI)`;
  const agentSession =
    "this invocation is already inside an agent session — `CSM_AGENT_SESSION_EXEC=1` or any other `CSM_AGENT_SESSION_*` marker is set, i.e. it is not an interactive human CLI";
  return `
${p.prelude}

1. Derive a tmux-safe \`<goal-slug>\` from the invocation's goal and prompt: lowercase, hyphen-separated, concise, and stable for this run. The session name is \`${p.skill}-<goal-slug>\`.
2. If already in tmux (\`TMUX\` env set, or \`tmux display-message -p '#session_name'\` succeeds), rename the current session to \`${p.skill}-<goal-slug>\` with \`tmux rename-session -t "$(tmux display-message -p '#S')" "${p.skill}-<goal-slug>"\`, unless the user explicitly forbade renaming or chose another multiplexer. If renaming fails, note it and continue in the existing session.
3. If ${agentSession}, do not start a detached session and do not end the invocation: skip this step and step 4 and continue the ${p.workflow} workflow in-process (the step 2 rename may still apply). Otherwise, if not in tmux, and the user did not forbid tmux or choose another multiplexer, ${launch}.
4. Print the active session name and attach command: \`tmux attach-session -t ${p.skill}-<goal-slug>\`. Only if a new detached session was launched and no agent-session marker is set (an interactive human CLI) end the invocation — tmux does the ${p.activity} from the start; when ${agentSession}, never end the invocation and continue the ${p.workflow} workflow in-process instead.
5. When tmux is unavailable, forbidden, or a different multiplexer was chosen, note that and continue into the ${p.workflow} workflow without renaming or starting tmux.
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
    argvSafe: true,
  },
  "csm-build": {
    prelude:
      "Run first — before `Activation Boundary` work, locating the plan, or any execution state. Not an execution state.",
    step2: "the build",
    work: "build",
    request: "build",
    activity: "build",
    workflow: "execution",
    argvSafe: true,
  },
  "csm-bdd-tdd": {
    prelude:
      "Run first — before `INTAKE`, any pipeline tool use, or any other section. Not a pipeline state.",
    step2: "the BDD/TDD mutation",
    work: "BDD/TDD",
    request: "BDD/TDD",
    activity: "mutation",
    workflow: "pipeline",
    argvSafe: true,
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
    argvSafe: true,
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
    prelude:
      "Run first — before INTAKE, locating the plan, or any generation work. Not a generation state.",
    step2: "generation",
    work: "generation",
    request: "generation",
    activity: "generation",
    workflow: "generation",
  },
  "csm-review-python": {
    prelude:
      "Run first — before INTAKE, any analysis tool use, or any other section. Not an analysis state.",
    step2: "analysis",
    work: "analysis",
    request: "analysis",
    activity: "analysis",
    workflow: "analysis",
  },
};

function subagentResilience(p) {
  const body = `
${p.intro}

1. Minimal-prompt retry of the same agent.
2. Re-dispatch with narrowed scope.
3. Fresh agent.
4. ${p.step4}
5. On quota-type failures (429, rate-limit, out-of-credits, billing) do NOT run the retry ladder — one short backoff retry for transient signals only; hard exhaustion surfaces to the primary agent for pause/stop. Context exhaustion is harness-managed (automatic compaction); if it still occurs it is a non-quota fatal surfaced to the primary, never the retry ladder.
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
