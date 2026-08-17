const MANIFEST = {
  'csm-grill': {
    sections: ['Activation Boundary', 'Core Rules', 'Grilling State Machine', 'Anti-Patterns', 'Done Criteria'],
    tmux: false,
    norms: false,
    machine: { section: 'Grilling State Machine', entryExit: false },
  },
  'csm-plan': {
    sections: ['Activation Boundary', 'Core Rules', 'Scale To The Ask', 'Repository Norms (NORMS.md)', 'Planning State Machine', 'Required Plan Document'],
    tmux: true,
    norms: true,
    machine: { section: 'Planning State Machine', entryExit: false },
  },
  'csm-bdd-tdd': {
    sections: ['Activation Boundary', 'Non-Negotiable Rules', 'Pipeline', 'Anti-Patterns', 'Done Criteria', 'Repository Norms'],
    tmux: true,
    norms: true,
    machine: { section: 'Pipeline', entryExit: false },
  },
  'csm-build': {
    sections: ['Activation Boundary', 'Core Rules', 'Repository Norms (NORMS.md)', 'Execution State Machine', 'Completion Gate'],
    tmux: true,
    norms: true,
    machine: { section: 'Execution State Machine', entryExit: false },
  },
  'csm-review': {
    sections: ['Activation Boundary', 'Core Rules', 'Write Discipline And File Allowlist', 'Review State Machine', 'Review Dimensions', 'Finding Record', 'Report Format', 'Anti-Patterns', 'Done Criteria', 'NORMS.md', 'Tmux Session Bootstrap'],
    tmux: true,
    norms: true,
    machine: { section: 'Review State Machine', entryExit: true },
  },
  'csm-scan': {
    sections: ['Tmux Session Bootstrap', 'When to use', 'Dimensions', 'Constraints (non-negotiable)', 'Testing'],
    tmux: true,
    norms: false,
    machine: null,
  },
  'csm-browse': {
    sections: ['When to use this skill', 'Verb reference', 'Isolation note'],
    tmux: false,
    norms: false,
    machine: null,
  },
  'csm-upload': {
    sections: ['Requirements', 'Usage'],
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

export { MANIFEST, CONTRACTS, UPLOAD_SCRIPT_REF };
