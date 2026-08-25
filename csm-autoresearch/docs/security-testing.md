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

## Trusted-Local Posture

`trusted-local` is a trusted-process provider, not an OS sandbox. Its runtime
enforces timeout, aggregate output, and disposable-workspace byte limits. It
does not enforce network, memory, process-count, or descendant containment;
requests for those unsupported capabilities fail before candidate execution.
Process-group termination is cleanup best effort only and is never recorded as
verified descendant containment. Generated mode remains fail-closed without a
host-attested sandbox boundary.
