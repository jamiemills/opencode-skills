export const manifest = 'Makefile';

export const files = {
  'Makefile': `.PHONY: build test

build:
	./scripts/build.sh

test:
	bats tests/
`,
  'scripts/build.sh': `#!/usr/bin/env bash
set -euo pipefail
source ./lib.sh

build() {
  echo "building: \${PROJECT_NAME}"
}
`,
  'scripts/lib.sh': `#!/usr/bin/env bash
PROJECT_NAME="demo"

helper() {
  echo "\${PROJECT_NAME}"
}
`,
  'tests/test_build.bats': `#!/usr/bin/env bats

@test "lib exposes PROJECT_NAME" {
  run bash -c "source ./scripts/lib.sh && echo \${PROJECT_NAME}"
  [ "$status" -eq 0 ]
}
`,
  'tests/spec_helper.sh': `#!/usr/bin/env bash
set -euo pipefail
source ../../scripts/lib.sh
# shellspec and shunit2 fixture markers
`,
  '.shellcheckrc': `enable=all
disable=SC2086
`,
  '.editorconfig': `root = true

[*]
indent_style = space
indent_size = 2

[*.py]
indent_size = 4
`,
  '.cache/x': `noise
`,
};
