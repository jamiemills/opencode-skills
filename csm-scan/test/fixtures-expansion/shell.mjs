// T226 topic fixture — Shell (negative new dimensions + deployment).
//
// Carries the "negative case" theme for the six new dimensions on a first-class
// ecosystem: the pipeline must report Shell as a built-in (so the generic
// fallback must NOT fire), api/data/governance/assurance must be `not_detected`
// with a COMPLETE search space (never `unverified`), and deployment +
// maintainability must be `observed`. The `source ./lib.sh` line gives the
// architecture import graph a real internal edge; `eval` is a dynamic
// construct that stays out of any first-class claim.

export const files = {
  'Makefile': `.PHONY: build test

build:
\t./scripts/build.sh

test:
\tbats tests/
`,
  'scripts/build.sh': '#!/usr/bin/env bash\nset -euo pipefail\nsource ./lib.sh\nbuild\n',
  'scripts/lib.sh': '#!/usr/bin/env bash\nPROJECT_NAME="demo"\n',
  'scripts/run.sh': '#!/usr/bin/env bash\nfoo() {\n  eval "echo ${USER}"\n}\n',
  'tests/test_build.bats': '#!/usr/bin/env bats\n@test "build" {\n  run ./scripts/build.sh\n}\n',
  '.github/workflows/ci.yml': [
    'name: ci',
    'on: [push]',
    'jobs:',
    '  lint:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '',
  ].join('\n'),
  'k8s/namespace.yaml': [
    'apiVersion: v1',
    'kind: Namespace',
    'metadata:',
    '  name: t226-sh',
    '',
  ].join('\n'),
  'README.md': 'shell fixture: no api surface\n',
};
