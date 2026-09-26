# Live Proofs

Status of the live Docker/browser proofs (the `adapter-integrations` CI job) and
the accepted residual that remains outside this repository.

## Live proof status

The live proof job is `.github/workflows/ci.yml` → `adapter-integrations`. It runs
`make test-adapter-integrations-required`, which drives the real adapter
integrations through the actual Docker and browser runtime rather than a mocked
equivalent. The job hard-asserts its opt-in:

- `test "$CSM_ADAPTER_INTEGRATIONS" = 1`
- `test "$CSM_ADAPTER_INTEGRATIONS_APPROVED" = 1`

Because those assertions run unconditionally, the job cannot silently skip: if
the repository opt-in variables are unset, the job fails closed instead of
reporting a synthetic pass. `adapter-integrations` also carries
`if: ${{ always() }}` and `needs: gates`, and a first step asserts
`needs.gates.result == success`, so it still runs (and still fails) when the
default gates fail.

### In-repo required path

The workflow now exposes a single terminal job, `required` (`name: Required
checks`), that transitively depends on the live proof:

```yaml
required:
  name: Required checks
  needs: [frozen-install, dependency-audit, gates, adapter-integrations]
  if: ${{ always() }}
  # steps assert every needs.<job>.result = success
```

`required` fails closed whenever any dependency is unsuccessful, skipped, or
cancelled. Depending on this job therefore cannot yield a green run while the
live proof job failed. This is the repository-side wiring that makes the live
proof a required dependency/check rather than an adjacent, independently
selectable job.

### Out-of-repo setting (branch protection)

Wiring `required` inside the workflow is necessary but not sufficient. GitHub
branch protection is a **repository setting** and is not represented by any file
in this repository. To actually block merges on the live proof, an operator must
enable branch protection for the default branch and mark the `Required checks`
status check as required. Flipping GitHub branch protection to `required` is
an out-of-repo setting and cannot be performed from within this repository. The
workflow changes above only ensure that a single, correct check exists for that
setting to name.

## Accepted residual: runner-dependent freshness

Even with branch protection configured, the live proof evidence is
**runner-dependent**:

- The live decision-gate (`decision-gate.json`, `mode: live`) is produced on a
  Docker-capable host and is rewritten whenever the live tests run, so its
  freshness is a function of when and where the job last executed on a
  Docker-capable runner, not of any in-repo timestamp.
- `wt/**` worktree branches are excluded from `push` CI (`branches-ignore`).
  The merged commit on `main` (and pull requests) is what CI validates, so the
  recorded live evidence reflects the last `main`/PR run rather than every
  intermediate worktree push.
- The repository opt-in variables (`CSM_ADAPTER_INTEGRATIONS`,
  `CSM_ADAPTER_INTEGRATIONS_APPROVED`) are repository-level settings. With them
  set, the job runs and fails closed; without them, it fails rather than skips.

This residual is accepted: it is a property of the runner environment and of
GitHub repository settings, not something the workflow or a checked-in artifact
can guarantee. No in-repo change can make live-proof freshness independent of
the runner that executed it.
