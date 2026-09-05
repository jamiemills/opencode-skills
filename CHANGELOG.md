# Changelog

All notable changes to `@jamiemills/csm-skills-bootstrap` (the packaged skill
payload) are documented here. Format follows keep-a-changelog; versions are
planned per `bootstrap/release-checklist.md`.

## [0.1.0] - 2026-09-05

Initial packaged release of the 14-skill CSM suite: csm-grill, csm-plan,
csm-deep-research, csm-bdd-tdd, csm-build, csm-review, csm-review-python,
csm-scan, csm-ddd, csm-make-tests, csm-autoresearch, csm-browse, csm-upload,
and csm-orchestrate.

### Added

- csm-orchestrate outer-loop controller with host and executor adapter seams,
  durable cursor/recovery, approval-bound dispatch, and adversarial final
  review with persisted, resolver-validated evidence records (enforced for
  both executor and host seams).
- csm-autoresearch Docker-generated provider with host-attested sandbox
  evidence, inspect-before/after controls, and fail-closed cleanup
  verification.
- csm-browse chromium-vnc adapter with CDP dispatch, owned-session lifecycle,
  and source-digest-bound JSON evidence persisted through the production
  artifact resolver.
- Skill progress tracking (`csm-skill-progress/1`): validated records,
  rendering helper with derived percentages, CLI updater, and repo gate.
- CI required lanes: raw browser E2E (89 assertions), composed
  orchestrator-to-browse and orchestrator-to-Docker live proofs, generated
  sandbox probe, and outcome-parity gate — all skip-free and cleanup-verified.
- Dependency audit via pinned OSV-Scanner with a fail-closed verifier
  (freshness, size, and coverage postconditions).
- Bootstrap protocol: hash-verifying installer, staged replacement with
  managed backup/restore, digest-pinned payload index.

### Security

- Persisted review records are tamper-evident: any missing, forged, or
  modified record yields BLOCKED/REQUIRES_REVIEW, never VERIFIED.
- Immutable image digests pinned for browser and sandbox containers;
  preflight assertions fail the job on drift.
- Reviewer/producer identity separation enforced; run-ID format validated
  before filename interpolation in review persistence.
