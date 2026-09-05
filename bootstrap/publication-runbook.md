# Publication Runbook — @jamiemills/csm-skills-bootstrap@0.1.0

User decision gate: `.agents/plans/2026-09-05-defrelease-autonomy-gates-csm.json` T006.
Every step below requires explicit user approval; credential-bearing commands
(npm publish, DNS/hosting, key generation/rotation) are typed by the user only.
Base checklist: `bootstrap/release-checklist.md` (authoritative).

## Prerequisites

- T001 strict-signature mode shipped (flag-gated default-off)
- T002 replay runner (`scripts/replay-registry.mjs`) fixture self-test green
- Repository gates green at the release SHA (exact-SHA CI, all 4 jobs)

## Steps (ordered)

1. **Gates**: run the full pre-release checklist (`bootstrap/release-checklist.md`
   Pre-release): check-suite, boilerplate/readme matrix checks, five bootstrap
   suites, `make fmt-check lint check test-package-index test-deterministic test`,
   `make audit`. Record transcripts.
2. **Deterministic double-pack**: run `node scripts/pack-bootstrap.mjs` twice;
   the printed sha256 must be identical. Record sha256, bytes, file count,
   payload-index binding.
   2b. **Toolchain and cache manifest**: record node/npm/platform versions,
   tarball integrity, and a warm-cache plus `npm cache verify` transcript per
   `bootstrap/cache-manifest.schema.json` (checklist item, kept explicit here
   so the walkthrough is auditable step-by-step).
3. **Key ceremony (user only)**: generate/allocate the production Ed25519 keys;
   write `bootstrap/keyring.json` (`production_use: true`, real fingerprints,
   validity window, no fixture markers). Update the embedded `KEYRING_JSON`
   literal in `bootstrap/package/bin/csm-skills-bootstrap.js` to stay canonically
   equal (test-pinned). Store private keys in the user's secret store — never in
   the repo.
4. **Release pack gate**: `node scripts/pack-bootstrap.mjs --release` must pass
   (refuses fixture markers). Record the tarball sha256/bytes/file count.
5. **Signature hard-require activation (user choice per D6 of the plan)**:
   either set `CSM_BOOTSTRAP_REQUIRE_SIGNATURE=1` for every release verify
   (ceremony-strict; recorded deviation vs F-045 default-on), or instruct the
   default-on flip for the next version.
6. **Provenance (optional, separate approval)**: run
   `.github/workflows/release-provenance-check.yml` (workflow_dispatch) with
   `artifact_path` under `.release-staging/` and `approved_artifact_digest`;
   requires the `release` environment's required reviewers and a clean checkout.
7. **Publish (user only)**: `npm publish` the exact audited tarball bytes from
   the release environment with the user's npm credentials (2FA). Record the
   registry URL + resolved digest.
8. **Host the signed envelope** at the immutable HTTPS origin; pin that origin
   in `policy.limits.allowed_origin`; re-sign the envelope (key from step 3).
9. **Registry replay**: `node scripts/replay-registry.mjs --registry` — must
   pass with hash-tree-identical trees (the file: fixture result is NOT
   evidence). Also capture `npm cache verify` exit 0 and the warm-cache
   transcript.
10. **steps.md re-sign**: if `bootstrap/steps.md` changed, re-sign so
    `steps_sha256` binds the exact bytes.
11. **Close DEF-RELEASE** in `.agents/docs/deferred.md` citing this runbook
    execution's evidence records.

## Credentials required (user-typed only)

- npm account with 2FA for `@jamiemills` scope
- Private signing keys (from the user's secret store; never repo-stored)
- Hosting origin control (immutable HTTPS URL + DNS)

## Rollback

- npm: `npm unpublish` within the platform window, else `npm deprecate` +
  dist-tag removal; a patched re-release supersedes.
- Envelope: rotate the keyring (`revoked: true` + `revoked_at` on the old key)
  and re-sign — there is no envelope-revoke mechanism; revocation is
  keyring-level.
- Consumers: the bootstrap bin refuses non-pinned origins and fails closed on
  malformed envelopes, so a compromised host origin is mitigated by re-pointing
  `allowed_origin` and re-signing.

## Records to keep

Tarball sha256/bytes/file count, payload-index digest, key fingerprint, envelope
URL, cache manifest, replay transcript, provenance workflow run URL (if run),
and the approval records for each user-typed step.
