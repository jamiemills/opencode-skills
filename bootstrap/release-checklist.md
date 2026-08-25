# Bootstrap Release Checklist

Checklist for the future release of the **experimental, unpublished** `@jamiemills/csm-skills-bootstrap@0.1.0` and its signed bootstrap envelope. This is explicitly **not** part of any build task: every action below is a separate, user-approved release step. The packed local fixture plus the five test suites validate the local flow without claiming registry availability or registry replay.

## Pre-release

- [ ] Gates green: `node scripts/check-suite.mjs`, `node scripts/sync-skill-boilerplate.mjs --check`, `node scripts/gen-readme-matrix.mjs --check`, and the five bootstrap suites (`tests/bootstrap-trust.test.mjs`, `tests/package-audit.test.mjs`, `tests/protocol/*.test.mjs`, `tests/offline/*.test.mjs`, `tests/integration/*.test.mjs`).
- [ ] Repository CI gates green under Node 22: `make fmt-check`, `make lint`, `make check`, `make test-package-index`, `make test-deterministic`, and `make test`; the frozen install uses `make install` with `--frozen-lockfile --ignore-scripts` for both workspaces.
- [ ] External gates remain explicit and separate: `make test-e2e`, registry replay, publication, key rotation, and live-model evaluation are not default CI gates and require their own approval and evidence.
- [ ] Deterministic pack proven: run `node scripts/pack-bootstrap.mjs` twice and compare the printed `sha256` — the bytes must be identical; record sha256, byte count, file count, and the envelope's mandatory payload-index binding.
- [ ] Toolchain and cache manifest recorded: node/npm/platform versions, tarball integrity (sha256 + bytes), and a warm-cache plus `npm cache verify` transcript, per `bootstrap/cache-manifest.schema.json`.
- [ ] Release-only keyring gate passes: run `node scripts/pack-bootstrap.mjs --release`; it refuses non-production metadata and committed fixture markers, including renamed fixture IDs (normal `node scripts/pack-bootstrap.mjs` remains allowed for local fixture packs). Do not generate or request production keys as part of local builds.

## Release (requires explicit user approval — outside any plan)

- [ ] Publish `@jamiemills/csm-skills-bootstrap@0.1.0` to `https://registry.npmjs.org` with exactly the audited tarball bytes.
- [ ] Host the signed envelope at an immutable HTTPS URL; pin that origin in `policy.limits.allowed_origin` and re-sign the envelope.
- [ ] Rotate and record signing keys (`bootstrap/keyring.json`): fingerprint, algorithm, expiry, and revocation state.

## Post-publication

- [ ] Warm plus offline replay test against the **registry** spec (`npx --offline --no-install` in a dead-registry sandbox): identical installed-tree bytes to the online run and `npm cache verify` exit 0. Do not substitute a `file:` fixture replay for this release evidence.
- [ ] Update `bootstrap/steps.md` guidance if needed and re-sign the envelope so `steps_sha256` binds the exact new bytes.

## Records

Keep with the release evidence: tarball sha256/bytes and file count, payload-index digest, key fingerprint, envelope URL, cache manifest, and the command transcripts above.
