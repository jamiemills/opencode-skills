SHELL := /bin/bash
OXFMT_CONFIG := $(shell git rev-parse --show-toplevel 2>/dev/null)/.oxfmtrc.json
OXFMT_ARGS := --config=$(OXFMT_CONFIG) --ignore-path=.oxfmtignore
SANDBOX_IMAGE_TAG := node:22.22.0-bookworm-slim
SANDBOX_IMAGE_DIGEST := sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94
SANDBOX_IMAGE := node@$(SANDBOX_IMAGE_DIGEST)
.PHONY: help install lint fmt fmt-check fmt-staged regen precommit audit trace check check-anthropic-mapping test-corpus test test-hooks test-policy test-bootstrap test-orchestrate test-worker-runtime test-contracts test-enforcement test-suite-tooling test-package-index test-deterministic test-pack-concurrency test-gen-capabilities test-scan test-browse test-browse-unit test-upload test-review-render test-ddd test-autoresearch test-e2e test-e2e-required test-generated-sandbox-required test-adapter-integrations test-adapter-integrations-required test-patch-context analyze

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

regen: ## regenerate generated mirrors and capability payloads (scripts/regen.mjs)
	node scripts/regen.mjs

precommit: ## fast local mirror of CI gates: fmt, regen, conformance, lint, core unit suites
	make fmt
	node scripts/regen.mjs
	node scripts/check-suite.mjs
	pnpm exec oxlint --deny-warnings
	node --test --test-concurrency=1 tests/wt-session.test.mjs tests/wt-session-cleanup.test.mjs tests/trace-log.test.mjs tests/utc-timestamps.test.mjs tests/repo-state.test.mjs tests/temp-registry.test.mjs tests/regen.test.mjs tests/plan-lineage.test.mjs tests/plan-closure-fields.test.mjs tests/allowlist-policy.test.mjs tests/loop-trace-emission.test.mjs

audit: ## non-mutating dependency audit via pinned OSV-Scanner; any finding or invalid evidence fails
	node scripts/osv-audit.mjs

trace: ## append one action/decision trace; pass ARGS="action --actor ... --action ... --target ... --justification ... --outcome ..."
	node scripts/trace.mjs $(ARGS)

check: ## repo conformance gate (includes an advisory, warn-only upstream id-mapping freshness report)
	node scripts/check-suite.mjs
	node scripts/check-anthropic-mapping.mjs
	$(MAKE) test-corpus

test-corpus: ## validate the canonical JSON plan/build-state corpus (declared-revision)
	node scripts/validate-corpus-v2.mjs

check-anthropic-mapping: ## strict upstream Anthropic id-mapping freshness gate (fails on stale age/version-gate drift)
	node scripts/check-anthropic-mapping.mjs --strict

analyze: lint check ## analyzers: lint + conformance gate

test-hooks: ## lefthook/pre-commit test suites (integration + hermetic shim normalization)
	node --test scripts/hooks/test/pre-commit.test.mjs \
	  scripts/hooks/test/hook-shim.test.mjs

test-policy: ## workflow/release/toolchain trigger-policy suites (CI gate guardrails)
	node --test --test-concurrency=1 tests/workflow-trigger-policy.test.mjs \
	  tests/release-policy.test.mjs \
	  tests/toolchain-policy.test.mjs

test-bootstrap: ## bootstrap suites (serial; self-pack) + resume-semantics corpus contract (node >=22 via with-node22)
	node scripts/with-node22.mjs --exec node --test --test-concurrency=1 tests/bootstrap-trust.test.mjs \
	  tests/protocol/*.test.mjs tests/offline/*.test.mjs \
	  tests/resume-semantics.test.mjs
	node scripts/with-node22.mjs --exec node --test --test-concurrency=1 tests/package-audit.test.mjs
	node scripts/with-node22.mjs --exec node --test --test-concurrency=1 tests/bootstrap-import-closure.test.mjs
	node scripts/with-node22.mjs --exec node --test --test-concurrency=1 tests/bootstrap-schema-sync.test.mjs
	node scripts/with-node22.mjs --exec node --test --test-concurrency=1 tests/integration/*.test.mjs

test-orchestrate: ## csm-orchestrate unit and integration tests
	node scripts/with-node22.mjs --exec node --test --test-concurrency=1 tests/orchestrate-*.test.mjs \
	  tests/conditional-skill-rankings.test.mjs \
	  tests/no-budget-priming.test.mjs

test-worker-runtime: ## dynamic worker-runtime suites (telemetry, reducer, scheduler, leases, thin entry)
	node scripts/with-node22.mjs --exec node --test --test-concurrency=1 tests/telemetry/*.test.mjs tests/orchestration-store/*.test.mjs tests/orchestrate-worker-state.test.mjs tests/orchestrate-lifecycle-hooks.test.mjs tests/orchestrate-batch-width.test.mjs tests/orchestrate-dynamic-scheduler.test.mjs tests/orchestrate-sandbox-egress-schemas.test.mjs tests/worker-projection-render.test.mjs tests/run-worker.test.mjs tests/executor-hardening.test.mjs

test-contracts: ## previously-orphaned artifact/JSON contract, config-adapter, rollout, and host-assurance suites
	node scripts/with-node22.mjs --exec node --test --test-concurrency=1 \
	  tests/adapter-replay.test.mjs \
	  tests/artifact-resolver*.test.mjs \
	  tests/autoresearch-compatibility.test.mjs \
	  tests/bdd-*.test.mjs \
	  tests/browse-upload-json-contract.test.mjs \
	  tests/build-*.test.mjs \
	  tests/commit-scope.test.mjs \
	  tests/compatibility.test.mjs \
	  tests/config-artifact-adapters/*.test.mjs \
	  tests/config-baseline/*.test.mjs \
	  tests/config-envelope.test.mjs \
	  tests/config-high-risk-adapters/*.test.mjs \
	  tests/config-readonly-adapters/*.test.mjs \
	  tests/config-resolver.test.mjs \
	  tests/config-security.test.mjs \
	  tests/consumer-edge-adapter.test.mjs \
	  tests/consumer-edge-inventory.test.mjs \
	  tests/consumer-replay-matrix.test.mjs \
	  tests/ddd-*.test.mjs \
	  tests/digest-taxonomy.test.mjs \
	  tests/durable-json-safety.test.mjs \
	  tests/environment-preflight.test.mjs \
	  tests/evidence-status.test.mjs \
	  tests/evals/orchestration/*.test.mjs \
	  tests/final-receipt.test.mjs \
	  tests/grill-json-contract.test.mjs \
	  tests/grill-plan-replay.test.mjs \
	  tests/host-assurance/*.test.mjs \
	  tests/json-migration-characterization.test.mjs \
	  tests/json-only-cutover.test.mjs \
	  tests/legacy-artifact-compatibility.test.mjs \
	  tests/lifecycle-contract.test.mjs \
	  tests/make-tests-*.test.mjs \
	  tests/norms-json-contract.test.mjs \
	  tests/plan-*.test.mjs \
	  tests/progress-projection.test.mjs \
	  tests/progress-rollup.test.mjs \
	  tests/progress-schema.test.mjs \
	  tests/progress-tracker-contract.test.mjs \
	  tests/projection-discovery-negative.test.mjs \
	  tests/publication-protocol.test.mjs \
	  tests/render-*.test.mjs \
	  tests/research-json-contract.test.mjs \
	  tests/review-json-contract.test.mjs \
	  tests/rollout/*.test.mjs \
	  tests/schema-*.test.mjs \
	  tests/standalone-progress.test.mjs

test-enforcement: ## in-loop completion-enforcement suites (evaluators, guards, closure, acceptance)
	node scripts/with-node22.mjs --exec node --test --test-concurrency=1 \
	  tests/tmux-bootstrap-conditional.test.mjs \
	  tests/enforcement-*.test.mjs \
	  tests/csm-build-loop-evaluator.test.mjs \
	  tests/csm-plan-loop-evaluator.test.mjs \
	  tests/csm-review-loop-closure.test.mjs \
	  tests/csm-orchestrate-remainder.test.mjs

test-suite-tooling: ## suite tooling tests (serial; check-suite, cache health, worktree sessions, and gate wiring)
	node --test --test-concurrency=1 tests/check-suite.test.mjs tests/cache-health.test.mjs tests/wt-session.test.mjs tests/wt-session-cleanup.test.mjs tests/trace-log.test.mjs tests/trace-config.test.mjs tests/trace-cli.test.mjs tests/verify-traces.test.mjs tests/utc-timestamps.test.mjs tests/repo-state.test.mjs tests/temp-registry.test.mjs tests/adapter-gate-wiring.test.mjs tests/regen.test.mjs tests/plan-lineage.test.mjs tests/plan-closure-fields.test.mjs tests/allowlist-policy.test.mjs tests/loop-trace-emission.test.mjs

test-package-index: ## package and payload-index validation tests
	node scripts/with-node22.mjs --exec node --test --test-concurrency=1 tests/package-audit.test.mjs

test-pack-concurrency: ## pack-bootstrap fail-fast cross-process lock suite
	node --test --test-concurrency=1 tests/pack-concurrency.test.mjs

test-gen-capabilities: ## capabilities template-based digest regenerator suite
	node --test --test-concurrency=1 tests/gen-capabilities.test.mjs

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

test-osv-audit: ## OSV dependency audit verifier contract tests
	node --test --test-concurrency=1 tests/osv-audit.test.mjs

test-progress-tracker: ## skill progress tracker contract tests
	node --test --test-concurrency=1 tests/progress-tracker.test.mjs

test-e2e: ## csm-browse e2e (skip by default; set CSM_BROWSE_E2E_REQUIRE=1 to require chromium-vnc)
	cd csm-browse && node tests/e2e.mjs

test-e2e-required: ## required browser E2E (fails when chromium-vnc is unavailable)
	CSM_BROWSE_E2E_REQUIRE=1 node scripts/adapter-required-tests.mjs --browser-e2e-required

test-generated-sandbox-required: ## required generated-source containment gate (fails when sandbox is unavailable)
	node scripts/adapter-required-tests.mjs --generated-sandbox-required

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
	@test "$${CSM_ADAPTER_INTEGRATIONS:-0}" = 1
	@test "$${CSM_ADAPTER_INTEGRATIONS_APPROVED:-0}" = 1
	@set -eu; env_file="$${ADAPTER_ENV_FILE:-$${RUNNER_TEMP:-.}/csm-adapter-env}"; \
		node scripts/adapter-ci-preflight.mjs --output "$$env_file"; \
		set -a; . "$$env_file"; set +a; \
		docker image inspect '$(SANDBOX_IMAGE)' >/dev/null 2>&1 || \
			docker pull '$(SANDBOX_IMAGE)'; \
		CSM_ADAPTER_INTEGRATIONS_REQUIRED=1 node scripts/adapter-required-tests.mjs; \
		CSM_ADAPTER_INTEGRATIONS_REQUIRED=1 node scripts/adapter-required-tests.mjs --browser-e2e-required; \
		CSM_ADAPTER_INTEGRATIONS_REQUIRED=1 node scripts/adapter-required-tests.mjs --generated-sandbox-required

test: test-hooks test-policy test-bootstrap test-orchestrate test-worker-runtime test-contracts test-enforcement test-suite-tooling test-deterministic test-pack-concurrency test-gen-capabilities test-browse test-browse-unit test-upload test-review-render test-patch-context test-osv-audit test-progress-tracker test-package-index test-ddd test-autoresearch test-scan ## primary test suites (fast -> slow; opt-in adapter gates remain separate)
