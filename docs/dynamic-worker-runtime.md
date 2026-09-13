# Dynamic Worker Runtime

The bounded worker runtime lets skills declare a decomposition and worker
policy; the orchestrator may accept a model-proposed worker set after runtime
validation and compile it into ordinary `csm-orchestrate-phase/2` route nodes.
All acceptance authority (cursor, child attempts, dispatch intents/fencing,
terminal receipt, evidence and review gates) stays with csm-orchestrate.

## Entry points

- `csm-orchestrate` remains the single coordination entry point.
- `scripts/run-worker.mjs` is a **thin, child-side** worker entry. It runs
  exactly one invocation and returns a raw child result; it compiles no phases,
  owns no cursor/receipt/gate, and accepts no work. It is env-gated by
  `CSM_AGENT_SESSION_EXEC=1` and fail-closed when disabled or without a handler.
- `scripts/lib/agent-session-executor.mjs` remains the out-of-process executor
  for csm-build-owned skills.
- `scripts/run-orchestrator.mjs --verified-sandbox <config.json|config.mjs>`
  wires the tier-2 runtime from the driver (N1): the loaded config is passed
  through to `orchestrate()`'s `verifiedSandboxRuntime`, so a verified-sandbox
  node dispatches through the live provider/broker/listener without the API
  caller hand-supplying per-request plumbing. A `.json` path is a plain config;
  a `.mjs` path default-exports the config so function fields (`provider`,
  `forward`, `sandboxExecutor`) can be supplied. An enabled config that cannot
  be constructed resolves fail-closed (never a silent unmediated sandbox).

## Isolation tiers

| Tier   | Isolation         | Workspace | Network         | Credentials                | Attestation        | Status                                                                                                                                                                                                                                                                        |
| ------ | ----------------- | --------- | --------------- | -------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tier-1 | hardened worktree | worktree  | disabled        | none                       | none               | implemented                                                                                                                                                                                                                                                                   |
| tier-2 | verified sandbox  | tmpfs     | broker-mediated | host-mediated (opaque ref) | required, periodic | **implemented: Docker provider + periodic re-attestation + dual-homed broker + host-side policy-bound listener + durable anchored egress chain + credential injection + real NFLOG per-drop capture + sustained session + live isolation wiring (gap-remediation T001–T005)** |

Tier-1 scrubs credential-shaped environment keys and kills the child process
group on timeout. Tier-2 is a build-shaped Docker sandbox (provider +
re-attestation) that stages a repo copy into a tmpfs, runs a sustained
multi-round-trip NDJSON worker session, re-attests on a cadence, and fails
closed on drift. Resource envelopes are versioned
(`csm-orchestrate-docker-worker-policy/1` frozen; `/2` adds `dropCapture`;
checked-in instance at `csm-orchestrate/policies/docker-worker-policy.json`).

## Egress and immutable logging

The egress **policy/audit core** is implemented in
`csm-orchestrate/lib/egress-broker.mjs`: a default-deny evaluator over
`csm-orchestrate-egress-policy/1`, a keyed (HMAC) hash-chained
`csm-orchestrate-egress-event/1` ledger with a `verifyEgressChain` auditor, and
broker emission of correlated `egress.decision` telemetry with
`targetHost`/`targetOrigin` (credentials only as an opaque `credentialRef`).

Durability and anchoring have since landed: `createEgressLedger({ filePath,
publishAnchor, readAnchor })` fsync-appends the chain, reloads and re-verifies
it (binding `runId`, tolerating a torn tail, rejecting a malformed interior
line), and fails closed if the persisted head does not match `readAnchor` or if
`publishAnchor` fails.

Network enforcement is wired (`csm-orchestrate/lib/egress-network.mjs`): the
worker attaches only to the broker-only internal network; the broker is
dual-homed onto a second (egress) network so only the broker reaches upstream.
A host-side policy-bound listener (`createEgressBrokerListener`) evaluates
policy, enforces limits, injects credentials only on allow, and proxies allowed
requests. Real network-layer drops are sourced via a baked `NET_ADMIN` helper
(blackhole `csm0` route + scoped `-o csm0` NFLOG+DROP) yielding per-drop
`{dest_ip,dest_port}` fed to `recordDrop`; capture degradation is observable and
fails closed only when the policy requires it. The provider/broker are wired
into `executeNode` behind a mode-aware effective-isolation gate (enabled by
default; unknown isolation refused), preserving the trusted-in-process
`csm-autoresearch` route. See the recorded decision gate at
`.agents/evidence/dynamic-worker-runtime/decision-gate.json`.

## Observability and Anthropic id mapping

Worker lifecycle is emitted on `csm-orchestrate-telemetry-event/2` and folded on
demand (with sequence rehydration) into a `csm-worker-projection/1` table; it is
observational and never acceptance authority. Non-blocking mapping to Anthropic
Claude Code identifiers:

| CSM            | Anthropic Claude Code                |
| -------------- | ------------------------------------ |
| `runId`        | session / `workflow.run_id` (`wf_…`) |
| `taskId`       | workflow task / phase item           |
| `workerId`     | `agent_id`                           |
| `invocationId` | agent invocation                     |
| `toolId`       | `tool_use_id`                        |

Anthropic caps (concurrent agents, agents per run, items per pipeline) are
version-dependent policy inputs, not constants.

## Spike evidence (T001/T002)

Recorded from the csm-build hard-gate spikes (2026-09-12); see plan
`2026-09-12-dynamic-worker-runtime-csm.json` and build journal.

- **T001 build-shaped sandbox:** the frozen isolation controls instantiate
  exactly (`HostConfig.Mounts=[]`, `ReadonlyRootfs=true`, `NetworkMode=none`,
  `CapDrop=["ALL"]`, `no-new-privileges`), and a repo tree can be staged via
  `docker exec -i … tar -xf -` without adding a mount. `noexec` blocks direct
  execution of workspace files but `node /workspace/*.mjs` runs. A long-lived
  NDJSON worker round-trips over one `docker exec -i`. **However** the frozen
  64 MiB / 32-pid limits OOM on a build and a filled tmpfs wedges the container.
  Empirically verified on this host (4 CPU, ~4.4 GiB available): 1 GiB memory /
  512 pids supports a 768 MB allocation, a 100-child fan-out, and a 400 MB
  workspace without wedging; **recommendation: 2 GiB / 512 pids / `--init`
  reaper**, encoded in `docker-worker-policy`.
- **T002 egress:** a proxy-only internal Docker network with a dual-homed
  default-deny broker blocks direct, DNS, UDP/QUIC, and IPv6 bypasses and
  mediates allowed `CONNECT host:port` traffic; kernel-dropped direct attempts
  are invisible to an app-level broker, so network-layer logging is required for
  complete coverage. A hash chain detects edits but an unkeyed head is forgeable
  by a host writer, so the head must be keyed/signed and anchored outside the
  worker trust domain. `url`/`uri` keys are redacted by telemetry; egress
  targets must use `targetHost`/`targetOrigin`.

## Concurrency policy

Parallel fan-out is **read-only-only by design**: `classifyConcurrency`
(`csm-orchestrate/lib/recovery.mjs`) yields `parallel-independent-read-only`
only for dependency-free, side-effect-free nodes, and `selectParallelBatch`
caps the batch by `maxParallelism` and per-skill bounds. Policy-permitted
writable admission is deliberately **deferred**; writable workers run serially
unless a future plan implements bounded, approved writable concurrency. This
records the T011/T019 decision.

## Spike commands (T001/T002)

```sh
# T001 — frozen boundary inspect (mounts[], read-only rootfs, network none)
docker create --network none --read-only \
  --tmpfs /workspace:rw,noexec,nosuid,nodev,size=67108864 \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --pids-limit 32 --memory 67108864 --cpu-quota 100000 \
  node:22-bookworm-slim sleep 600
docker inspect <id> --format 'Mounts={{json .Mounts}} RO={{.HostConfig.ReadonlyRootfs}} Net={{.HostConfig.NetworkMode}}'
# stage a repo tree without a mount
tar -cf - --owner=0 --group=0 -C <tree> . | docker exec -i <id> sh -c 'tar --no-same-owner -xf - -C /workspace'
# long-lived NDJSON worker over one exec
docker exec -i <id> node /workspace/worker.mjs

# T002 — proxy-only internal network + default-deny broker
docker network create --internal t002-egress
docker run -d --name t002-proxy --network t002-egress <proxy-image>
docker run -d --name t002-worker --network t002-egress <worker-image> sleep 100000
docker exec t002-worker node -e 'require("net").connect(443,"1.1.1.1").on("error",e=>console.log(e.code))'  # ENETUNREACH
```

## T006 concurrency stress

The T006 flake/parity fix is backed by a recorded concurrency stress run:
`.agents/evidence/dynamic-worker-runtime/t006-stress.log`. It captures one
baseline and two 3-way concurrent `make test-orchestrate` batches (7 runs
total) with per-run exit codes and TAP counts — 7/7 green, 0 failures, 8
environment-gated skips each. No assertion is quarantined.

## Findings ledger

The durable mapping of every adversarial-review finding to its remediation
status and task lives in `docs/dynamic-worker-runtime-findings-ledger.md`.
