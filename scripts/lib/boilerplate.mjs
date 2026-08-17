// Canonical shared SKILL.md sections and their per-skill parameters.
// scripts/sync-skill-boilerplate.mjs regenerates (--write) or verifies
// (--check) these heading-bounded sections; check-suite fails on drift.
// Never synced: Core Rules, R&D gates, state machines, Anti-Patterns,
// Done Criteria — those are deliberately per-skill.

function tmuxBootstrap(p) {
  return `
${p.prelude}

1. Check whether this invocation is already running inside tmux (the \`TMUX\` environment variable is set, or \`tmux display-message -p '#session_name'\` succeeds).
2. Skip starting a new session and proceed directly with ${p.step2} in the current context when any of these is true:
   - the invocation is already inside tmux;
   - the user or their prompt explicitly said not to use tmux or not to start a tmux session;
   - the user explicitly asked for a different terminal multiplexer (for example \`screen\` or \`zellij\`) — honor that choice instead and never start tmux alongside it;
   - tmux is not installed or cannot start a session — note this to the user and continue without tmux.

   When skipping because this invocation is already inside tmux, state the current tmux session name (for example via \`tmux display-message -p '#session_name'\`) and continue in it, so the session in use is always named.
3. Otherwise, start the orchestrating agent in a new detached tmux session before doing any ${p.work} work:
   - Derive a sensible, short, descriptive session name from the current session and the user's prompt, in the form \`${p.skill}-<goal-slug>\` (lowercase, hyphen-separated, tmux-safe characters, truncated to a reasonable length).
   - If a tmux session with that name already exists, append a numeric suffix (\`-2\`, \`-3\`, ...).
   - Launch the same agent invocation carrying the user's original ${p.request} request inside the detached session, for example:
     \`tmux new-session -d -s ${p.skill}-<goal-slug> 'opencode run "<original ${p.request} request>"'\`
     adapting the exact command to the agent CLI actually in use so the ${p.work} work continues inside tmux.
4. Immediately print a clear notice naming the session so the user can attach later, for example:
   \`Started tmux session "${p.skill}-<goal-slug>". Attach to it later with: tmux attach-session -t ${p.skill}-<goal-slug>\`
5. After printing the notice, end this invocation without performing any ${p.work} work; the tmux session performs the actual ${p.activity} from the beginning of this skill. Only when the bootstrap was skipped under step 2 does this same invocation continue directly into the ${p.workflow} workflow below.
`;
}

const TMUX_PARAMS = {
  'csm-plan': {
    prelude: 'Run this bootstrap before anything else — before `INTAKE`, before any planning tool use, and before any other section of this skill. It is not a planning state.',
    step2: 'planning', work: 'planning', request: 'planning', activity: 'planning', workflow: 'planning',
  },
  'csm-build': {
    prelude: 'Run this bootstrap before anything else — before `Activation Boundary` work, before locating the plan, and before any execution state. It is not an execution state.',
    step2: 'the build', work: 'build', request: 'build', activity: 'build', workflow: 'execution',
  },
  'csm-bdd-tdd': {
    prelude: 'Run this bootstrap before anything else — before `INTAKE`, before any pipeline tool use, and before any other section of this skill. It is not a pipeline state.',
    step2: 'the BDD/TDD mutation', work: 'BDD/TDD', request: 'BDD/TDD', activity: 'mutation', workflow: 'pipeline',
  },
  'csm-scan': {
    prelude: 'Run this bootstrap before anything else — before any scan, test, or analysis command, and before any other section of this skill. It is not a scan step. It governs agent-driven skill sessions; direct human CLI runs of `scripts/scan.mjs` from a shell are outside its scope.',
    step2: 'the scan', work: 'scan', request: 'scan', activity: 'scan', workflow: 'scan',
  },
  'csm-review': {
    prelude: 'Run this bootstrap before anything else — before `INTAKE`, before any review tool use, and before any other section of this skill. It is not a review state.',
    step2: 'review', work: 'review', request: 'review', activity: 'review', workflow: 'review',
  },
};

function subagentResilience(p) {
  const body = `
${p.intro}

1. Minimal-prompt retry of the same agent.
2. Re-dispatch with narrowed scope.
3. Fresh agent.
4. ${p.step4}
`;
  return p.guard ? `${body}\n${p.guard}\n` : body;
}

const RESILIENCE_PARAMS = {
  'csm-grill': {
    intro: 'Fallback ladder — journal every incident, never silently:',
    step4: 'Primary completion of research and synthesis with a recorded independence caveat.',
    guard: 'SCOUT and DEEP_DIVE dispatches must never silently degrade to primary-only research for a large idea — when the ladder lands on step 4, record the independence caveat and surface it to the user as a parked open question.',
  },
  'csm-plan': {
    intro: 'Fallback ladder for `RESEARCH`, `CRITIQUE`, and `REMEDIATE` dispatches — journal every incident, never silently:',
    step4: 'Primary completion (evidence gathering) / primary-led critique or review (low-risk only, with a recorded independence caveat).',
    guard: 'Critical or high-uncertainty findings never bypass independent critique because of subagent failure — keep retrying, or cap the finding\'s confidence and record a "critique unavailable" caveat in the progress journal.',
  },
  'csm-review': {
    intro: 'Fallback ladder — journal every incident, never silently:',
    step4: 'Primary completion (evidence gathering) / primary-led challenge (low/info findings only, recorded independence caveat).',
    guard: 'Critical/high/medium findings never bypass independent challenge because of subagent failure — keep retrying, or cap the finding\'s confidence at medium with a "challenge unavailable" caveat recorded in the finding record and surfaced in residual unknowns.',
  },
  'csm-bdd-tdd': {
    intro: 'Fallback ladder when a pipeline subagent (SPEC, SCENARIOS, VALIDATE, TEST_DESIGN) fails — journal every incident in `specs/control.md`, never silently:',
    step4: 'Primary completion of the spec/validation work, with a recorded independence caveat when the primary agent fills in for an independent agent.',
    guard: null,
  },
};

// Registry: skill -> section title -> { level, render }
const SYNC_SECTIONS = {};
for (const [skill, params] of Object.entries(TMUX_PARAMS)) {
  SYNC_SECTIONS[skill] = SYNC_SECTIONS[skill] || {};
  SYNC_SECTIONS[skill]['Tmux Session Bootstrap'] = { level: 2, render: () => tmuxBootstrap({ ...params, skill }) };
}
for (const [skill, params] of Object.entries(RESILIENCE_PARAMS)) {
  SYNC_SECTIONS[skill] = SYNC_SECTIONS[skill] || {};
  SYNC_SECTIONS[skill]['Subagent Resilience'] = { level: skill === 'csm-bdd-tdd' ? 3 : 2, render: () => subagentResilience(params) };
}

export { SYNC_SECTIONS };
