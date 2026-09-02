SHELL := /bin/bash
OXFMT_CONFIG := $(dir $(abspath $(shell git rev-parse --path-format=absolute --git-common-dir 2>/dev/null))).oxfmtrc.json
OXFMT_ARGS := --config=$(OXFMT_CONFIG) --ignore-path=.oxfmtignore
.PHONY: help install lint fmt fmt-check fmt-staged audit check test test-hooks test-bootstrap test-orchestrate test-suite-tooling test-package-index test-deterministic test-scan test-browse test-browse-unit test-upload test-review-render test-ddd test-autoresearch test-e2e test-e2e-required test-generated-sandbox-required test-adapter-integrations test-adapter-integrations-required test-patch-context analyze

help: ## show all targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: ## install all deps (pnpm frozen, no lifecycle scripts)
	pnpm install --frozen-lockfile --ignore-scripts
	cd csm-browse && pnpm install --frozen-lockfile --ignore-scripts

lint: ## oxlint repo-wide, warnings fail (quality bar: .oxlintrc.json correctness+suspicious)
	pnpm exec oxlint --deny-warnings

fmt: ## format repo-wide with oxfmt
	pnpm exec oxfmt $(OXFMT_ARGS) .

fmt-check: ## verify formatting, no writes (CI gate)
	pnpm exec oxfmt $(OXFMT_ARGS) --check .

fmt-staged: ## format + re-stage + verify staged files (pre-commit hook parity)
	files=$$(git diff --cached --name-only --diff-filter=ACM); \
	if [ -n "$$files" ]; then \
	  pnpm exec oxfmt $(OXFMT_ARGS) --write $$files && \
	  git add $$files && \
	  pnpm exec oxfmt $(OXFMT_ARGS) --check $$files; \
	fi

audit: ## non-mutating dependency audit; high/critical or unavailable advisories fail
	pnpm audit --audit-level=high

check: ## repo conformance gate
	node scripts/check-suite.mjs

analyze: lint check ## analyzers: lint + conformance gate

test-hooks: ## lefthook/pre-commit test suite
	node --test scripts/hooks/test/pre-commit.test.mjs

test-bootstrap: ## bootstrap suites (serial; self-pack) + resume-semantics corpus contract (node >=22 via with-node22)
	node scripts/with-node22.mjs --exec node --test --test-concurrency=1 tests/bootstrap-trust.test.mjs \
	  tests/protocol/*.test.mjs tests/offline/*.test.mjs \
	  tests/resume-semantics.test.mjs
	node scripts/with-node22.mjs --exec node --test --test-concurrency=1 tests/package-audit.test.mjs
	node scripts/with-node22.mjs --exec node --test --test-concurrency=1 tests/bootstrap-import-closure.test.mjs
	node scripts/with-node22.mjs --exec node --test --test-concurrency=1 tests/bootstrap-schema-sync.test.mjs
	node scripts/with-node22.mjs --exec node --test --test-concurrency=1 tests/integration/*.test.mjs

test-orchestrate: ## csm-orchestrate unit and integration tests
	node scripts/with-node22.mjs --exec node --test --test-concurrency=1 tests/orchestrate-*.test.mjs

test-suite-tooling: ## suite tooling tests (serial; check-suite, cache health, worktree sessions, and gate wiring)
	node --test --test-concurrency=1 tests/check-suite.test.mjs tests/cache-health.test.mjs tests/wt-session.test.mjs tests/adapter-gate-wiring.test.mjs

test-package-index: ## package and payload-index validation tests
	node scripts/with-node22.mjs --exec node --test --test-concurrency=1 tests/package-audit.test.mjs

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

test-review-render: ## csm-review human Markdown/HTML projection tests
	node scripts/with-node22.mjs --exec node --test --test-concurrency=1 \
	  csm-review/test/findings-render-profile.test.mjs \
	  csm-review/test/findings-render.test.mjs \
	  csm-review/test/human-projection.test.mjs \
	  tests/review-render.test.mjs

test-patch-context: ## patch-context guidance contract tests
	node --test --test-concurrency=1 tests/patch-context-guidance.test.mjs

test-e2e: ## csm-browse e2e (skip by default; set CSM_BROWSE_E2E_REQUIRE=1 to require chromium-vnc)
	cd csm-browse && node tests/e2e.mjs

test-e2e-required: ## required browser E2E (fails when chromium-vnc is unavailable)
	CSM_BROWSE_E2E_REQUIRE=1 $(MAKE) test-e2e

test-generated-sandbox-required: ## required generated-source containment gate (fails when sandbox is unavailable)
	node csm-autoresearch/scripts/probe-sandbox.mjs --required
	node --test --test-concurrency=1 csm-autoresearch/test/generated-sandbox.test.mjs

test-adapter-integrations: ## opt-in real adapter gates (set opt-in and approval variables)
	@if [ "$${CSM_ADAPTER_INTEGRATIONS:-0}" != "1" ]; then \
		printf '%s\n' 'SKIP: adapter integration gates not opted in (set CSM_ADAPTER_INTEGRATIONS=1)'; \
		if [ -n "$${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' '### Adapter integration gates' '- **Status:** SKIPPED' '- **Reason:** opt-in was not enabled' >>"$${GITHUB_STEP_SUMMARY}"; fi; \
		exit 0; \
	elif [ "$${CSM_ADAPTER_INTEGRATIONS_APPROVED:-0}" != "1" ]; then \
		printf '%s\n' 'SKIP: adapter integration gates not approved (set CSM_ADAPTER_INTEGRATIONS_APPROVED=1)'; \
		if [ -n "$${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' '### Adapter integration gates' '- **Status:** SKIPPED' '- **Reason:** approved capability evidence was not supplied' >>"$${GITHUB_STEP_SUMMARY}"; fi; \
		exit 0; \
	else \
		$(MAKE) test-adapter-integrations-required; \
	fi

test-adapter-integrations-required: ## run all approved real adapter gates; unavailable capabilities fail
	CSM_ADAPTER_INTEGRATIONS_REQUIRED=1 $(MAKE) test-orchestrate
	$(MAKE) test-e2e-required
	docker pull node:22.22.0-bookworm-slim
	$(MAKE) test-generated-sandbox-required

test: test-hooks test-bootstrap test-orchestrate test-suite-tooling test-deterministic test-browse test-browse-unit test-upload test-review-render test-patch-context test-package-index test-ddd test-autoresearch test-scan ## primary test suites (fast -> slow; opt-in adapter gates remain separate)
