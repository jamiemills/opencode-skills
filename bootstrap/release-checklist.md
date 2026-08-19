# Bootstrap Release Checklist

Checklist for the future release of `@jamiemills/csm-skills-bootstrap@0.1.0` and its signed bootstrap envelope. This is explicitly **not** part of any build task: every action below is a separate, user-approved release step. The packed artifact plus the five test suites already validate the flow without publication.

## Pre-release

- [ ] Gates green: `node scripts/check-suite.mjs`, `node scripts/sync-skill-boilerplate.mjs --check`, `node scripts/gen-readme-matrix.mjs --check`, and the five bootstrap suites (`tests/bootstrap-trust.test.mjs`, `tests/package-audit.test.mjs`, `tests/protocol/*.test.mjs`, `tests/offline/*.test.mjs`, `tests/integration/*.test.mjs`).
- [ ] Deterministic pack proven: run `node scripts/pack-bootstrap.mjs` twice and compare the printed `sha256` — the bytes must be identical; record sha256, byte count, and file count.
- [ ] Toolchain and cache manifest recorded: node/npm/platform versions, tarball integrity (sha256 + bytes), and a warm-cache plus `npm cache verify` transcript, per `bootstrap/cache-manifest.schema.json`.

## Release (requires explicit user approval — outside any plan)

- [ ] Publish `@jamiemills/csm-skills-bootstrap@0.1.0` to `https://registry.npmjs.org` with exactly the audited tarball bytes.
- [ ] Host the signed envelope at an immutable HTTPS URL; pin that origin in `policy.limits.allowed_origin` and re-sign the envelope.
- [ ] Rotate and record signing keys (`bootstrap/keyring.json`): fingerprint, algorithm, expiry, and revocation state.

## Post-publication

- [ ] Warm plus offline replay test against the **registry** spec (`npx --offline --no` in a dead-registry sandbox): identical installed-tree bytes to the online run and `npm cache verify` exit 0.
- [ ] Update `bootstrap/steps.md` guidance if needed and re-sign the envelope so `steps_sha256` binds the exact new bytes.

## Records

Keep with the release evidence: tarball sha256/bytes and file count, payload-index digest, key fingerprint, envelope URL, cache manifest, and the command transcripts above.
