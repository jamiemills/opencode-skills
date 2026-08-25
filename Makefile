SHELL := /bin/bash
.PHONY: help install lint fmt fmt-check fmt-staged check test test-hooks test-bootstrap test-suite-tooling test-package-index test-deterministic test-scan test-browse test-browse-unit test-upload test-ddd test-autoresearch test-e2e analyze

help: ## show all targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: ## install all deps (pnpm frozen, no lifecycle scripts)
	pnpm install --frozen-lockfile --ignore-scripts
	cd csm-browse && pnpm install --frozen-lockfile --ignore-scripts

lint: ## oxlint repo-wide, warnings fail (quality bar: .oxlintrc.json correctness+suspicious)
	pnpm exec oxlint --deny-warnings

fmt: ## format repo-wide with oxfmt
	pnpm exec oxfmt --ignore-path=.oxfmtignore .

fmt-check: ## verify formatting, no writes (CI gate)
	pnpm exec oxfmt --check --ignore-path=.oxfmtignore .

fmt-staged: ## format + re-stage + verify staged files (pre-commit hook parity)
	files=$$(git diff --cached --name-only --diff-filter=ACM); \
	if [ -n "$$files" ]; then \
	  pnpm exec oxfmt --write --ignore-path=.oxfmtignore $$files && \
	  git add $$files && \
	  pnpm exec oxfmt --check --ignore-path=.oxfmtignore $$files; \
	fi

check: ## repo conformance gate
	node scripts/check-suite.mjs

analyze: lint check ## analyzers: lint + conformance gate

test-hooks: ## lefthook/pre-commit test suite
	node --test scripts/hooks/test/pre-commit.test.mjs

test-bootstrap: ## bootstrap suites (serial; self-pack) + resume-semantics corpus contract (node >=22 via with-node22)
	node scripts/with-node22.mjs --exec node --test --test-concurrency=1 tests/bootstrap-trust.test.mjs \
	  tests/package-audit.test.mjs \
	  tests/protocol/*.test.mjs tests/offline/*.test.mjs tests/integration/*.test.mjs \
	  tests/resume-semantics.test.mjs

test-suite-tooling: ## suite tooling tests (serial; check-suite, cache health, and worktree sessions)
	node --test --test-concurrency=1 tests/check-suite.test.mjs tests/cache-health.test.mjs tests/wt-session.test.mjs

test-package-index: ## package and payload-index validation tests
	node --test --test-concurrency=1 tests/package-audit.test.mjs

test-deterministic: ## deterministic package summary and offline evaluation suites
	@set -eu; first=$$(mktemp); second=$$(mktemp); trap 'rm -f "$$first" "$$second"' EXIT; \
		node scripts/pack-bootstrap.mjs | awk '/^(sha256|bytes|files):/{print}' >"$$first"; \
		node scripts/pack-bootstrap.mjs | awk '/^(sha256|bytes|files):/{print}' >"$$second"; \
		cmp "$$first" "$$second"
	node --test --test-concurrency=1 tests/evals/*.test.mjs

test-scan: ## csm-scan authoritative suite (serial only — ~2min)
	cd csm-scan && node --test --test-concurrency=1

test-ddd: ## csm-ddd unit tests (serial; fixtures + contracts)
	cd csm-ddd && node --test --test-concurrency=1

test-autoresearch: ## csm-autoresearch unit and integration tests (offline; generated mode fails closed without sandbox)
	cd csm-autoresearch && node --test --test-concurrency=1 test/*.test.mjs

test-browse: ## csm-browse fast sanity (no Docker)
	cd csm-browse && node scripts/check-skill.mjs

test-browse-unit: ## csm-browse unit suite (offline-safe; needs pnpm install in csm-browse)
	@if [ ! -d csm-browse/node_modules/ws ]; then \
	  echo "csm-browse deps missing — run: cd csm-browse && pnpm install --frozen-lockfile" >&2; exit 1; fi
	cd csm-browse && npm test

test-upload: ## csm-upload upload-script tests (offline; stubbed git/gh)
	node --test csm-upload/tests/upload.test.mjs

test-e2e: ## csm-browse e2e (skip by default; set CSM_BROWSE_E2E_REQUIRE=1 to require chromium-vnc)
	cd csm-browse && node tests/e2e.mjs

test: test-hooks test-bootstrap test-suite-tooling test-deterministic test-browse test-browse-unit test-upload test-package-index test-ddd test-autoresearch test-scan ## primary test suites (fast -> slow; browser E2E and live/external gates remain separate)
