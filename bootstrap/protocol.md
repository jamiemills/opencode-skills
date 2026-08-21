# Universal Agent Skills Bootstrap Protocol

Protocol ID: `csm-skills-bootstrap/1`
Report schema: `csm-agent-report/1` (see `bootstrap/agent-report.schema.json`)
Consumes: a validated `csm-bootstrap/2` envelope (trust boundary defined by the envelope spec and its trusted keyring) and a `csm-payload-index/1` payload index shipped inside the fixed package `@jamiemills/csm-skills-bootstrap@0.1.0` (bin `csm-skills-bootstrap`).

This document is the normative contract between any capable AI agent and the bootstrap payload. The agent owns discovery, destination choice, user confirmation, final placement, reload, and host transaction semantics. The machine side owns capability gating, guidance-boundary enforcement, payload format/path validation, and hash verification. Nothing in the envelope's Markdown steps, the payload, or this document may add shell commands, package specs, executable paths, or destinations.

## Protocol States

The state chain is exactly:

`DISCOVER -> TRUST -> PLAN_DESTINATION -> CONFIRM_IF_NEEDED -> MATERIALIZE -> VERIFY -> REPORT`

`CONFIRM_IF_NEEDED` is conditional: it fires when the destination is ambiguous or the trust root is unapproved; otherwise it is recorded as a no-op pass-through. Every state appends one trace entry to the report; a refusal appends a final `refused` entry at the failing state. A refusal ends the run at the failing state with a nonzero exit code; no state after a refusal executes.

### 1. DISCOVER

- Inputs: the capability object (see Capability Input).
- Agent-owned: honestly reporting host capabilities before any work begins.
- Machine-guaranteed: capability evaluation happens before any filesystem or network effect; missing hard capabilities refuse without mutation.
- Failure codes: `E_NO_NPX` (cannot invoke exact-version npx), `E_NO_WRITE` (cannot write files).

### 2. TRUST

- Inputs: `trustRootApproved` (boolean), the validated envelope, the payload index.
- Agent-owned: establishing the trust root before use (preinstalled trusted bootstrap skill, user-approved fixed package/key, or agent-native trusted mechanism) and supplying only an envelope that passed the signed-envelope boundary.
- Machine-guaranteed: the envelope schema is `csm-bootstrap/2`; the envelope's top-level fields are checked against the exact signed key-set (fields outside `audience`, `expires_at`, `key`, `policy`, `schema`, `steps_markdown`, `steps_sha256`, `signature`, `payload_index_sha256` are refused); `steps_markdown` contains no code fences and no shell interpreter/tool words (denylist re-enforcement; the signed digest already binds the steps); the package policy is fixed to `@jamiemills/csm-skills-bootstrap@0.1.0` with bin `csm-skills-bootstrap` and registry `https://registry.npmjs.org`; when a signature is present the Ed25519 signature is verified against the trusted keyring over the canonical signed policy (schema, audience, expires_at, key, policy, steps_sha256, and `payload_index_sha256` when present), the key must be a trusted non-revoked in-validity Ed25519 key with a matching fingerprint, the envelope must be unexpired and for the `agent-skills` audience, and the steps digest must match; when the envelope carries `payload_index_sha256` it must equal the payload-index digest of the index being used — the sha256 of the exact file bytes for the shipped `payload-index.json`, or the sha256 of the canonical serialization when the index is supplied as an object (fail-closed on any mismatch or malformed signature). An envelope with no `signature` field is the documented no-signature local flow and is not crypto-verified here; hard-requiring the signature is publication-gated. The payload index schema is `csm-payload-index/1` with well-formed `classes.skills`, `classes.supportingFiles`, `classes.helperBins`, `classes.metadata`, and `fixedBin` entries (`path`, `sha256`, `bytes`, `mode`). Steps Markdown is never executed.
- Failure codes: `E_UNTRUSTED` (missing/malformed envelope, unsigned-field or forbidden envelope field, unfixed package policy, unknown/revoked/expired/fingerprint-mismatched key, wrong audience, expired envelope, steps-digest mismatch, payload-index-digest mismatch, bad or malformed signature — also the deferred refusal when an unapproved trust root reaches `CONFIRM_IF_NEEDED` without approval), `E_MALICIOUS_STEPS` (steps contain executable policy), `E_UNSUPPORTED_FORMAT` (payload index schema or entry shape mismatch).

### 3. PLAN_DESTINATION

- Inputs: `capabilities.knowsDestination`, an optional explicit absolute `destination`, optional `destinationCandidates`.
- Agent-owned: choosing the destination from its own host knowledge or from user input — never from the envelope, the payload, or this protocol.
- Machine-guaranteed: path rules (see Agent-Chosen Path Rules) are enforced component-by-component with `lstat` before any materialization; a destination is planned only when unambiguous.
- Failure codes: `E_NO_DESTINATION` (no destination known or stated, non-absolute path, or a non-directory component that cannot be created), `E_DESTINATION_SYMLINK` (any path component is a symbolic link).

### 4. CONFIRM_IF_NEEDED

- Fires when the destination is ambiguous (agent cannot choose between candidates, or knows none concretely) or the trust root is unapproved.
- Inputs: the pending question plus a `confirmation` object (`trustRootApproved`, optional `destination`).
- Agent-owned: actually asking the user and conveying the answer verbatim; never guessing on the user's behalf.
- Machine-guaranteed: without a confirmation input the run refuses with zero mutation; a confirmed destination re-passes all path rules before materialization; shell-bearing steps can never be confirmed into policy (they already refused at `TRUST`).
- Failure codes: `E_AMBIGUOUS_DESTINATION` (no confirmed destination), `E_UNTRUSTED` (no confirmed trust-root approval).

### 5. MATERIALIZE

- Inputs: planned destination, validated payload index, agent-provided mode-0700 staging sandbox, optional injectable file transport.
- Agent-owned: providing the sandbox and destination; declaring staging/locking/rollback capabilities it actually has.
- Machine-guaranteed: every index entry path (all classes plus `fixedBin`) is relative, POSIX-normalized, and free of `.`, `..`, empty, backslash, and absolute forms (`E_TRAVERSAL`); entry paths are unique across the whole index (`E_DUPLICATE`); only `classes.skills` and `classes.supportingFiles` entries under `payload/skills/` are placed — helper bins, metadata, and the fixed bin are never placed or executed by installation; an existing destination is inspected for a managed marker (`csm-managed/1`) before any overwrite; files are first copied into the staging directory and only finalized after `VERIFY` passes; a transport failure mid-copy cleans the staging directory and leaves the destination tree unchanged.
- Failure codes: `E_TRAVERSAL`, `E_DUPLICATE`, `E_MODIFIED_EXISTING` (destination holds differing bytes at an indexed path without a managed marker), `E_INTERRUPTED` (copy transport failed mid-write).

### 6. VERIFY

- Inputs: staged files and the payload index.
- Agent-owned: nothing — verification is never delegated to the agent's judgment.
- Machine-guaranteed: every staged file's sha256 must equal the payload index before finalization; every placed file's sha256 must equal the payload index after finalization (post-write verification); on mismatch the staging directory is removed, the destination is not finalized (or is restored from the managed backup when one exists), and the run refuses. For an unmanaged destination, cleanup removes exactly the indexed files that were newly written this run (identical pre-existing files are preserved) and prunes directories the run created that are now empty; a managed restore that itself fails appends the `restore-failed` limitation to the refusal report instead of crashing.
- Failure codes: `E_HASH_MISMATCH`.

### 7. REPORT

- Inputs: the state trace, placement results, capabilities, availability flags.
- Agent-owned: delivering the report to the user; honestly reporting limitations.
- Machine-guaranteed: the report validates against `bootstrap/agent-report.schema.json`; refusal reports carry the refusal code and state; success reports carry the destination, skills placed, per-file placed hashes with verification results, and availability flags marked as reported, not guaranteed.
- Failure codes: none — the report is always emitted; the exit code carries the outcome.

## Capability Input

```json
{
  "hasNpx": true,
  "hasFileWrite": true,
  "knowsDestination": true,
  "supportsStaging": true,
  "supportsLock": true,
  "supportsRollback": true,
  "knowsReload": true
}
```

| Field              | Meaning                                | Hard requirement                   |
| ------------------ | -------------------------------------- | ---------------------------------- |
| `hasNpx`           | host can invoke exact-version `npx`    | yes — absence refuses `E_NO_NPX`   |
| `hasFileWrite`     | host can write skill files             | yes — absence refuses `E_NO_WRITE` |
| `knowsDestination` | agent knows its Agent Skills directory | no — absence asks the user         |
| `supportsStaging`  | host can stage near the destination    | no — reported                      |
| `supportsLock`     | host offers destination locking        | no — reported                      |
| `supportsRollback` | host offers rollback of replaced files | no — reported                      |
| `knowsReload`      | agent knows its reload mechanism       | no — reported as `unknown`         |

## Refusal Codes

Refusals are nonzero exits; success is `0`. Every refusal performs zero payload mutation at the destination.

| Exit | Code                      | Meaning                                                                                   | Failing state                                      |
| ---- | ------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1    | `E_NO_NPX`                | exact-version npx unavailable                                                             | DISCOVER                                           |
| 2    | `E_NO_WRITE`              | file-write capability unavailable, or the staging sandbox is missing at materialization   | DISCOVER / MATERIALIZE                             |
| 3    | `E_NO_DESTINATION`        | no absolute destination known, stated, or creatable                                       | PLAN_DESTINATION                                   |
| 4    | `E_AMBIGUOUS_DESTINATION` | destination ambiguous and no user confirmation                                            | CONFIRM_IF_NEEDED                                  |
| 5    | `E_UNTRUSTED`             | trust root missing, unapproved, or envelope policy unfixed                                | TRUST / CONFIRM_IF_NEEDED                          |
| 6    | `E_UNSUPPORTED_FORMAT`    | payload index schema or entry shape mismatch, or a placed entry outside `payload/skills/` | TRUST / MATERIALIZE                                |
| 7    | `E_MALICIOUS_STEPS`       | steps Markdown carries executable policy                                                  | TRUST                                              |
| 8    | `E_DESTINATION_SYMLINK`   | destination path contains a symlink component                                             | PLAN_DESTINATION / CONFIRM_IF_NEEDED / MATERIALIZE |
| 9    | `E_TRAVERSAL`             | payload index entry escapes its root                                                      | MATERIALIZE                                        |
| 10   | `E_DUPLICATE`             | two index entries claim the same path                                                     | MATERIALIZE                                        |
| 11   | `E_MODIFIED_EXISTING`     | unmanaged existing content would be overwritten                                           | MATERIALIZE                                        |
| 12   | `E_HASH_MISMATCH`         | staged or placed sha256 differs from the index                                            | VERIFY                                             |
| 13   | `E_INTERRUPTED`           | file transport failed mid-copy                                                            | MATERIALIZE                                        |

## User Confirmation

`CONFIRM_IF_NEEDED` is the single confirmation point. It fires when (a) the destination is ambiguous — the agent has candidates but cannot choose, or knows no concrete path — or (b) the trust root is unapproved. The agent asks the user and supplies the answer as the `confirmation` input (`trustRootApproved` boolean, optional absolute `destination`). A confirmed destination is re-validated against all path rules. Absent or partial confirmation refuses with `E_AMBIGUOUS_DESTINATION` or `E_UNTRUSTED`; the protocol never proceeds on a guess and never treats shell-bearing steps as confirmable.

## Agent-Chosen Path Rules

- The destination is an absolute path provided by the agent or user — never sourced from the envelope, payload, steps, or this protocol; envelopes carrying path-like fields are refused as untrusted.
- Every path component from the filesystem root to the destination is checked with `lstat` at planning: any symbolic-link component refuses `E_DESTINATION_SYMLINK`.
- Each component must already exist as a directory or be creatable (its first missing ancestor ends the plan-time walk); an existing non-directory component refuses `E_NO_DESTINATION`.
- Destination paths may contain spaces; they are ordinary absolute paths.
- Immediately before every final write the engine re-lstats every component from the filesystem root down to the immediate parent directory, creating missing components one at a time — never through a recursive `mkdir`, which could traverse a symlink planted at a mid-depth component — and lstat-verifies each created component. Any symlink component refuses `E_DESTINATION_SYMLINK` at `MATERIALIZE`.
- The file is written to a fresh crypto-random temp name inside that re-validated directory; the temp path is reserved with `O_CREAT|O_EXCL` so a pre-planted entry at that name (for example a symlink) fails `EEXIST` instead of being followed, and the file is atomically renamed onto its final name. `rename()` replaces any existing entry at the final name, including a symlink, rather than following it.
- Disclosed residual window: a component swapped after the final lstat but before the write completes (a same-directory race between check and rename) is not re-checked. It cannot redirect placement outside the re-validated parent inode, and any resulting content corruption is caught by the post-write sha256 verification. A symlink planted before or during the write walk therefore refuses `E_DESTINATION_SYMLINK` at `MATERIALIZE` with zero writes through it.

## Post-Write Hash Verification

Verification is machine-performed twice: once on the staged copies before any destination finalization, and once on the placed files after finalization. Every placed file's sha256 must equal the corresponding `csm-payload-index/1` entry (`skills` and `supportingFiles` classes; file modes are applied from the index). A staged mismatch never finalizes the destination; a placed mismatch attempts restore from the managed backup and refuses.

## Report Fields

Reports use schema `csm-agent-report/1`:

- `schema`, `protocol`, `result` (`placed` | `refused`), `exitCode`
- `refusal` (`{code, state}`) — present on refusals
- `states` — ordered trace of the seven protocol states with actions and the refusal marker
- `destination` — the finalized absolute destination, or `null` on refusals
- `skillsPlaced`, `filesPlaced` (`{path, sha256, bytes, verified}`), `hashVerification` (`{algorithm, verified, total}`)
- `reloadAction` — `{status: declared|unknown, action}` derived from `knowsReload`
- `capabilities` — the seven capability flags as evaluated
- `availability` — `{staging, locking, rollback}` as REPORTED, not guaranteed
- `backupPath` — managed-replacement backup location, or `null`
- `limitations` — deterministic limitation tokens (`capabilities-are-agent-reported`, `reload-unknown`, `locking-unavailable`, `restore-failed`)

## Machine Guarantees vs Agent-Reported Guarantees (D10)

| Concern           | Machine-guaranteed                                                                                                                                                                                                                                                                                             | Agent-reported (never guaranteed)              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Capability gating | refusal before mutation when `hasNpx`/`hasFileWrite` are false                                                                                                                                                                                                                                                 | honesty of the capability self-report          |
| Envelope trust    | fixed package policy, no envelope path/exec fields, steps denylist, steps never executed                                                                                                                                                                                                                       | trust-root establishment and approval          |
| Destination       | absolute, agent/user-supplied, symlink-free components, existent-or-creatable                                                                                                                                                                                                                                  | discovery of the correct host skills directory |
| Confirmation      | no progress without explicit confirmation input                                                                                                                                                                                                                                                                | that the user was actually asked               |
| Payload integrity | traversal/duplicate rejection, staged + post-write sha256 equality, modes from the index                                                                                                                                                                                                                       | —                                              |
| Placement scope   | only `payload/skills/**` classes placed; helpers/metadata/fixed bin untouched                                                                                                                                                                                                                                  | final placement mechanics the host performs    |
| Transactions      | staging cleanup on interruption; managed backup before managed replacement; managed restore on finalize failure; unmanaged finalize failure removes only this run's newly written files (identical pre-existing files preserved) and prunes emptied directories; `restore-failed` limitation on failed restore | staging/locking/rollback availability flags    |
| Reload            | reloadAction limited to `declared` or `unknown`                                                                                                                                                                                                                                                                | actual reload semantics                        |

## Reference Engine

`tests/protocol/engine.mjs` implements this state machine as deterministic library code (Node built-ins only) for the acceptance matrix in `tests/protocol/*.test.mjs`. It reads `bootstrap/payload-index.json` and copies read-only from `bootstrap/package/payload/**`; all temporary work happens inside a caller-provided mode-0700 `mkdtemp('/tmp/csm-protocol-')` sandbox cleaned by the tests. The engine's TRUST state calls the shared trust validator `tests/protocol/trust-policy.mjs` (F-049), which re-enforces the guidance boundary (shell denylist), the fixed package policy (including the registry), and — when the envelope carries a signature — the Ed25519 signature over the canonical signed policy, the keyring trust (unknown/revoked/expired/fingerprint-mismatched keys refused), the envelope expiry and audience, the steps digest, and the `payload_index_sha256` binding to the actual payload-index.json bytes; a malformed signature fails closed. The `payload_index_sha256` binding is a FILE-BYTE digest: it is the sha256 of the exact bytes of the shipped `payload-index.json` (the same convention the shipped bin's `verify` subcommand uses). When the agent supplies the index as an OBJECT rather than the file, the engine hashes the deterministic canonical serialization (`canonicalJson`) of that object — the same byte string a signer must produce via the shared signing tooling — so a signer binding an object-form index must serialize canonically; the two conventions are documented and the engine applies whichever corresponds to the input mode. An envelope with no `signature` field is the documented no-signature local flow and keeps working; hard-requiring the signature stays publication-gated (deferred T009). The engine also enforces payload format, path, and hash rules, and re-lstats every component from the filesystem root down to the immediate parent directory immediately before each final write, reserves a crypto-random temp name with `O_CREAT|O_EXCL` inside that re-validated directory, and atomically renames onto the final name (F-047).

The shipped fixed bin `bootstrap/package/bin/csm-skills-bootstrap.js` embeds the same keyring and a dependency-free copy of the envelope validator and exposes it as the `verify <envelope.json>` subcommand (F-045): it verifies the envelope against the embedded keyring, and when the envelope carries `payload_index_sha256` it asserts equality with the shipped payload-index.json's sha256, exiting 0 with `{verification:{ok:true}}` or 1 with the refusal code on failure.
