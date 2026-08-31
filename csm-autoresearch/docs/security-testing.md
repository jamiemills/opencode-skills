# Security Testing

Run the cross-component security and integration gate from this directory:

```sh
node --test --test-concurrency=1 test/integration.test.mjs
```

The suite uses synthetic candidates and temporary workspaces only. It does
not use credentials, network access, live providers, or a real sandbox.

The required generated-source probe is an assertion, not an optional test:
when no verified sandbox provider is configured, `probe-sandbox.mjs --required`
must exit non-zero with `sandbox_unavailable`. A skipped or unavailable
containment test is therefore a failed security gate.
Providers are explicitly injected by a trusted host and must attest network,
mount, credential, resource, process, descendant, source-hash, and cleanup
controls. The default probe performs no provider discovery and never treats
Docker or a Node process as a sandbox.

## Docker Contract

The Docker launch policy is defined by `schemas/docker-sandbox-policy.schema.json`;
the host observation contract is defined by
`schemas/docker-sandbox-attestation.schema.json`. A provider must use an image
digest, `network=none`, no mounts or environment credentials, a read-only root
filesystem, bounded `/workspace` tmpfs, `cap-drop=ALL`, no-new-privileges, CPU,
memory, PID, output, timeout, and workspace limits, and explicit descendant
cleanup verification. The attestation binds the policy digest, image digest,
container ID, source hash, and pre/post inspect observations.

`status: unknown` is fail-closed and requires reconciliation. Docker daemon or
image availability is only a prerequisite probe, never proof of containment.

The policy digest is computed from the canonical JSON policy descriptor, including
the image digest, network, mounts, root filesystem, tmpfs, security settings,
all execution limits, process cleanup settings, source hash, and empty
environment allowlist. The host owns this digest; candidate output cannot
provide or replace it.

### Control-to-Observation Matrix

| Control                    | Required host observation                                                          | Attestation owner           | Failure result                                |
| -------------------------- | ---------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------- |
| Pinned image digest        | Pre/post inspect image digest equals policy digest target                          | Host Docker provider        | `sandbox_unavailable`                         |
| Network and mounts         | Network mode `none`; mounts exactly empty; Docker socket absent                    | Host Docker provider        | `sandbox_unavailable`                         |
| Credentials                | Inspect environment names exactly empty; host allowlist is empty                   | Host Docker provider        | `sandbox_unavailable`                         |
| Read-only rootfs and tmpfs | Read-only rootfs plus bounded `/workspace` tmpfs                                   | Host Docker provider        | `sandbox_unavailable`                         |
| Capabilities and privilege | `cap-drop=ALL`, no-new-privileges, non-privileged, private PID/IPC                 | Host Docker provider        | `sandbox_unavailable`                         |
| CPU, memory, PID, output   | Inspect limits match policy; host counts bounded output                            | Host Docker provider        | `resource_exhausted` or `sandbox_unavailable` |
| Process and descendants    | Private PID namespace, bounded PID count, and post-run descendant count zero       | Host Docker provider        | `unknown` until reconciled                    |
| Source hash binding        | Staged source hash equals request and attestation source hash                      | Host provider and evaluator | `policy_violation`                            |
| Cleanup                    | Container absent, descendants absent, and staged workspace removed after kill/wait | Host Docker provider        | `unknown` until reconciled                    |

Docker inspect observations establish the configured container boundary, not
the absence of daemon or kernel vulnerabilities. A provider must preserve that
bounded limitation and must not turn daemon availability into `verified`.

## Trusted-Local Posture

`trusted-local` is a trusted-process provider, not an OS sandbox. Its runtime
enforces timeout, aggregate output, and disposable-workspace byte limits. It
does not enforce network, memory, process-count, or descendant containment;
requests for those unsupported capabilities fail before candidate execution.
Process-group termination is cleanup best effort only and is never recorded as
verified descendant containment. Generated mode remains fail-closed without a
host-attested sandbox boundary.
