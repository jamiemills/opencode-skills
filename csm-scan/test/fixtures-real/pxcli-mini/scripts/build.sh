#!/usr/bin/env bash
# Fixture stand-in for the real repository's scripts/ directory: architecture
# entry-point detection must exclude scripts/ paths.
set -euo pipefail

make build
