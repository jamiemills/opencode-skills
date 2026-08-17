const MANIFEST = {
  'csm-grill': {
    sections: ['Interface', 'Activation Boundary', 'Core Rules', 'Grilling State Machine', 'Anti-Patterns', 'Done Criteria'],
    tmux: false,
    norms: false,
    machine: { section: 'Grilling State Machine', entryExit: false },
  },
  'csm-plan': {
    sections: ['Interface', 'Activation Boundary', 'Core Rules', 'Scale To The Ask', 'Repository Norms (NORMS.md)', 'Planning State Machine', 'Required Plan Document'],
    tmux: true,
    norms: true,
    machine: { section: 'Planning State Machine', entryExit: false },
  },
  'csm-bdd-tdd': {
    sections: ['Interface', 'Activation Boundary', 'Non-Negotiable Rules', 'Pipeline', 'Anti-Patterns', 'Done Criteria', 'Repository Norms'],
    tmux: true,
    norms: true,
    machine: { section: 'Pipeline', entryExit: false },
  },
  'csm-build': {
    sections: ['Interface', 'Activation Boundary', 'Core Rules', 'Repository Norms (NORMS.md)', 'Execution State Machine', 'Completion Gate'],
    tmux: true,
    norms: true,
    machine: { section: 'Execution State Machine', entryExit: false },
  },
  'csm-review': {
    sections: ['Interface', 'Activation Boundary', 'Core Rules', 'Write Discipline And File Allowlist', 'Review State Machine', 'Review Dimensions', 'Finding Record', 'Report Format', 'Anti-Patterns', 'Done Criteria', 'NORMS.md', 'Tmux Session Bootstrap'],
    tmux: true,
    norms: true,
    machine: { section: 'Review State Machine', entryExit: true },
  },
  'csm-scan': {
    sections: ['Interface', 'Tmux Session Bootstrap', 'When to use', 'Dimensions', 'Constraints (non-negotiable)', 'Testing'],
    tmux: true,
    norms: false,
    machine: null,
  },
  'csm-browse': {
    sections: ['Interface', 'When to use this skill', 'Verb reference', 'Isolation note'],
    tmux: false,
    norms: false,
    machine: null,
  },
  'csm-upload': {
    sections: ['Interface', 'Requirements', 'Usage'],
    tmux: false,
    norms: false,
    machine: null,
  },
};

const CONTRACTS = [
  {
    id: 'plan-save-path',
    source: { skill: 'csm-plan', needle: '.agents/plans/<yyyy-mm-dd>-<goal-slug>-csm.md' },
    consumers: [{ skill: 'csm-build', needle: '.agents/plans/' }],
    rule: 'prefix',
  },
  {
    id: 'bdd-plan-suffix',
    source: { skill: 'csm-bdd-tdd', needle: '-bdd-csm.md' },
    consumers: [{ skill: 'csm-build', needle: '-bdd-csm.md' }],
    rule: 'exact',
  },
  {
    id: 'superseded-pointer',
    source: { skill: 'csm-bdd-tdd', needle: 'Superseded for BDD/TDD' },
    consumers: [{ skill: 'csm-build', needle: 'Superseded for BDD/TDD' }],
    rule: 'exact',
  },
];

const UPLOAD_SCRIPT_REF = { skill: 'csm-upload', pattern: /csm-[a-z-]+\/scripts\/[A-Za-z0-9._-]+\.mjs/g };

const INTERFACES = {
  'csm-grill': {
    entryConditions: ['idea shared', 'explicit request to be grilled, interviewed, or stress-tested'],
    consumes: ['rough idea', 'repository and research evidence'],
    produces: ['agreed phased approach document'],
    handoff: ['phase briefs to a separately invoked csm-plan'],
    midPipeline: ['user decisions', 'research findings', 'explicit agreement'],
  },
  'csm-plan': {
    entryConditions: ['brief or phase brief', 'explicit planning request'],
    consumes: ['idea or phase brief', 'repository conventions', 'review findings'],
    produces: ['saved, verified CSM plan'],
    handoff: ['saved plan to csm-bdd-tdd or csm-build'],
    midPipeline: ['research evidence', 'critique findings', 'verified plan state'],
  },
  'csm-bdd-tdd': {
    entryConditions: ['saved CSM plan', 'explicit BDD/TDD mutation request'],
    consumes: ['saved plan', 'repository conventions'],
    produces: ['formal spec', 'Gherkin scenarios', 'unit test designs', 'mutated CSM plan'],
    handoff: ['mutated plan to csm-build'],
    midPipeline: ['spec', 'approved scenarios', 'validation report', 'test designs'],
  },
  'csm-build': {
    entryConditions: ['saved CSM plan', 'explicit implementation request'],
    consumes: ['saved plan', 'optional NORMS.md', 'BDD/TDD package when present'],
    produces: ['verified implementation', 'delivery evidence'],
    handoff: ['delivery to csm-browse'],
    midPipeline: ['task dependencies', 'checkpoints', 'review findings', 'repair evidence'],
  },
  'csm-review': {
    entryConditions: ['repository target', 'explicit review, audit, or assessment request'],
    consumes: ['repository at a pinned commit', 'optional NORMS.md'],
    produces: ['dated findings report'],
    handoff: ['review findings to a subsequent csm-plan run'],
    midPipeline: ['evidence pack', 'finder ledger', 'challenge verdicts', 'adjudicated findings'],
  },
  'csm-scan': {
    entryConditions: ['repository target', 'scan or conventions-analysis request'],
    consumes: ['committed repository declarations'],
    produces: ['NORMS.md'],
    handoff: ['optional conventions input to csm-plan, csm-bdd-tdd, csm-build, or csm-review'],
    midPipeline: ['survey', 'deep dimension scans', 'enrichment', 'deterministic render'],
  },
  'csm-browse': {
    entryConditions: ['need to drive a headful Chromium browser'],
    consumes: ['browser session', 'CDP verbs', 'delivery target'],
    produces: ['screenshots', 'videos', 'DOM, console, network, or performance evidence'],
    handoff: ['evidence files to csm-upload'],
    midPipeline: ['isolated Chromium session', 'session verbs', 'session cleanup'],
  },
  'csm-upload': {
    entryConditions: ['evidence files ready', 'configured GitHub Pages destination'],
    consumes: ['screenshots, videos, or evidence files', 'GitHub configuration'],
    produces: ['dated GitHub Pages demo page'],
    handoff: ['published evidence URL to the user'],
    midPipeline: ['clone or pull', 'copy files', 'generate index', 'commit and push'],
  },
};

// Known artifact format versions (kind -> latest known major). Corpus checks
// fail on markers with an unknown kind or a version newer than recorded here.
const FORMAT_VERSIONS = {
  'csm-plan': 1,
  'csm-review': 1,
  'csm-grill': 1,
  'csm-norms': 1,
};

// Universal never-invoke matrix (explicit literal, not a shorthand): every
// skill is terminal at its final state; handoff happens only via artifacts
// plus an explicit user invocation. Off-diagonal cells are true; diagonal false.
const NEVER_INVOKE = {
  'csm-bdd-tdd':  { 'csm-bdd-tdd': false, 'csm-browse': true, 'csm-build': true, 'csm-grill': true, 'csm-plan': true, 'csm-review': true, 'csm-scan': true, 'csm-upload': true },
  'csm-browse':   { 'csm-bdd-tdd': true, 'csm-browse': false, 'csm-build': true, 'csm-grill': true, 'csm-plan': true, 'csm-review': true, 'csm-scan': true, 'csm-upload': true },
  'csm-build':    { 'csm-bdd-tdd': true, 'csm-browse': true, 'csm-build': false, 'csm-grill': true, 'csm-plan': true, 'csm-review': true, 'csm-scan': true, 'csm-upload': true },
  'csm-grill':    { 'csm-bdd-tdd': true, 'csm-browse': true, 'csm-build': true, 'csm-grill': false, 'csm-plan': true, 'csm-review': true, 'csm-scan': true, 'csm-upload': true },
  'csm-plan':     { 'csm-bdd-tdd': true, 'csm-browse': true, 'csm-build': true, 'csm-grill': true, 'csm-plan': false, 'csm-review': true, 'csm-scan': true, 'csm-upload': true },
  'csm-review':   { 'csm-bdd-tdd': true, 'csm-browse': true, 'csm-build': true, 'csm-grill': true, 'csm-plan': true, 'csm-review': false, 'csm-scan': true, 'csm-upload': true },
  'csm-scan':     { 'csm-bdd-tdd': true, 'csm-browse': true, 'csm-build': true, 'csm-grill': true, 'csm-plan': true, 'csm-review': true, 'csm-scan': false, 'csm-upload': true },
  'csm-upload':   { 'csm-bdd-tdd': true, 'csm-browse': true, 'csm-build': true, 'csm-grill': true, 'csm-plan': true, 'csm-review': true, 'csm-scan': true, 'csm-upload': false },
};

export { MANIFEST, CONTRACTS, UPLOAD_SCRIPT_REF, INTERFACES, NEVER_INVOKE, FORMAT_VERSIONS };
