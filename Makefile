SHELL := /bin/bash
.PHONY: help install lint fmt fmt-check fmt-staged check test test-hooks test-bootstrap test-scan test-browse test-e2e analyze

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

test-bootstrap: ## bootstrap suites (serial; self-pack)
	node --test tests/bootstrap-trust.test.mjs tests/package-audit.test.mjs \
	  tests/protocol/*.test.mjs tests/offline/*.test.mjs tests/integration/*.test.mjs

test-scan: ## csm-scan authoritative suite (serial only — ~2min)
	cd csm-scan && node --test --test-concurrency=1

test-browse: ## csm-browse fast sanity (no Docker)
	cd csm-browse && node scripts/check-skill.mjs

test-e2e: ## csm-browse e2e (requires chromium-vnc container)
	cd csm-browse && node tests/e2e.mjs

test: test-hooks test-bootstrap test-browse test-scan ## all test suites (fast -> slow)
