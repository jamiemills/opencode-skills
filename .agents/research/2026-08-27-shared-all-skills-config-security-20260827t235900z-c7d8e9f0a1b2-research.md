format: csm-deep-research/1

# Shared All-Skills Config Security Research Finding

## TL;DR

Treat every per-run config path, override, URI, output target, and resource limit as untrusted policy input. Resolve configuration only from an authenticated, immutable, schema-closed source; merge defaults monotonically; and have the host enforce a signed, per-run capability grant after canonicalization. Default to no credentials, no network/browser, no writes/publish/execute, workspace-contained paths, bounded resources, and fail-closed on ambiguity.

## Executive Summary

```text
caller/config sources -> authenticated canonical config -> bounded merge
       -> effective policy -> host capability check -> isolated skill run
       -> redacted/audited output
```

The local orchestrator already has strong foundations: closed JSON Schema objects, immutable-looking digests, per-edge approvals, child identity checks, durable cursor requirements, retry/idempotency metadata, and an explicit permission vocabulary (`csm-orchestrate/SKILL.md:23-37`; `schemas/capabilities.schema.json:110-156`; `lib/invocation.mjs:88-110`; `lib/recovery.mjs:86-117`). These controls authenticate some artifacts and execution edges, but a shared all-skills config would introduce a second policy plane. Unless its source, precedence, paths, secrets, limits, and effects are separately authenticated and host-enforced, a lower-trust config can widen a higher-trust grant or make the coordinator a confused deputy.

The authoritative sources converge on allowlists, canonicalization before validation, least privilege, explicit audience/identity binding, short-lived scoped credentials, network segmentation, bounded resource allocation, redacted auditing, and independent authorization at the execution boundary. JSON Schema is necessary for structure but does not itself assign security meaning to annotations or unknown extensions [R6].

## Key Findings

K1. **CONFIRMED supported**: Arbitrary config paths are a high-risk external resource reference and must not be accepted as authority without canonicalization, trusted-root containment, symlink/race defenses, and host filesystem permissions [R2,R3,R5].

K2. **CONFIRMED supported**: Defaults and overrides must be schema-closed, typed, precedence-defined, and monotonic. An override may narrow an already-approved capability, never add permissions, credentials, destinations, or resource ceilings [R4,R6,R7].

K3. **CONFIRMED supported**: Credentials must be references to a secret manager or host-injected short-lived handles, never values in shared config, logs, artifacts, URLs, prompts, or generic environment forwarding [R1,R8].

K4. **CONFIRMED supported**: Network and browser access require separate per-run capabilities with explicit destination/origin allowlists, redirect restrictions, cookie/profile isolation, and network-layer enforcement; `network` or `browser` alone must not imply credential access [R1,R4].

K5. **CONFIRMED supported**: Every run needs independent limits for wall time, CPU, memory, output bytes, file bytes, process/tool calls, recursion, retries, browser pages, and network response size. Missing, invalid, or exceeded limits must stop the run, not silently fall back to unlimited behavior [R4,R5,R9].

K6. **CONFIRMED supported**: Output destinations are capabilities, not strings. Bind each destination to run, owner, artifact identity, normalized target, operation, and expiry; reject path traversal, unapproved publication, overwrite, and cross-run artifact references [R2,R3,R4].

K7. **CONFIRMED supported**: Config injection and confused deputy attacks require provenance-preserving identity, strict separation of data from instructions, independent policy authorization, and approval bound to exact normalized action parameters [R4,R7].

K8. **PARTIALLY-SUPPORTED**: The repository’s current contracts cover skill-level permissions and edge approvals, but do not visibly cover arbitrary config provenance, precedence, per-field sensitivity, destination allowlists, resource ceilings, browser origin policy, or secret references. These are requirements for the shared-config layer, not claims that the runtime is already vulnerable.

## Detail Sections

### Trust boundaries and assets

Assets are credentials and bearer tokens; source and private repository data; host filesystem and configuration; browser cookies, profiles, downloads, and authenticated sessions; network destinations and internal services; output/artifact stores; approval and audit records; compute, memory, bandwidth, and provider spend; and cross-run identity/lineage.

Trust zones should be explicit:

```text
untrusted request/content/config
          | parse + authenticate + canonicalize
          v
host policy compiler / capability broker
          | per-run, least-privilege grant
          v
isolated skill process + constrained tools
          | typed, redacted results only
          v
artifact/output sinks
```

Threat actors include a caller with permission to submit a run, a compromised or malicious skill, malicious repository/web/document content, a compromised config source, another tenant/run, a malicious output destination, and an attacker who steals a credential or approval. Assume the model, retrieved content, child output, environment variables, and config files can all be attacker-influenced. OWASP’s agent guidance specifically identifies tool abuse, data exfiltration, excessive autonomy, approval manipulation, multi-agent cascading, malicious configuration, and denial-of-wallet as risks [R4].

### Config sources, defaults, and overrides

Required controls:

- Accept only a small typed root object with `additionalProperties: false`; reject duplicate JSON member names, unsupported schema dialects, unknown extensions, excessive nesting, oversized strings/arrays, and ambiguous numeric values. JSON Schema’s validation result is not an authorization decision, and unknown keywords may be treated as annotations [R6].
- Identify every source as `builtin`, `operator`, `repository`, `run-request`, `skill`, or `external-content`; assign a trust level and permitted fields. Repository and external content may supply data, never policy or authority.
- Authenticate operator/shared policy sources with ownership, version, content digest, and (where crossing a trust boundary) a signature. Never select a config by an attacker-controlled path alone.
- Use a deterministic precedence table. A safe order is host hard ceiling -> signed deployment policy -> operator policy -> run request -> skill data. Lower-trust layers may only intersect sets, reduce limits, or select an already-authorized option.
- Compute and retain a canonical effective-config digest. Bind approval, invocation, child run, destination, and audit record to that digest. Recompute after every merge and before every privileged action.
- Reject duplicate keys and conflicting representations rather than “last key wins”; canonicalize strings, Unicode, numbers, paths, and URIs before comparison. OWASP and CWE require validation after sources are combined and canonicalization before validation [R2,R5].
- Do not support executable expressions, shell fragments, template evaluation, dynamic imports, arbitrary plugin paths, or environment-variable expansion in config. If interpolation is unavoidable, use an explicit allowlisted variable namespace and resolve it before authorization.

### Filesystem paths and output destinations

Safe default: no caller-selected absolute paths; read only from a host-selected workspace snapshot; write only to a per-run temporary/output directory; no symlink following; no device files, sockets, FIFOs, mounts, or executable outputs; no overwrite unless an explicit capability permits it.

For any permitted path, decode once, normalize using the platform path API, resolve against a fixed trusted root, verify the canonical result remains beneath that root, and open with directory/file-descriptor APIs that prevent TOCTOU and symlink replacement. Validate the final resolved target, not a string prefix. Use opaque artifact IDs mapped by the host when possible. CWE-22 recommends known-good validation, canonicalization, low privileges, sandboxing, and rejecting absolute/relative traversal; CWE-73 explicitly includes config-controlled paths and warns that excessive privileges amplify impact [R2,R3].

Destination policy must distinguish `read`, `create`, `replace`, `append`, `delete`, `publish`, and `execute`; bind each to the run and artifact owner. Prevent output redirection to logs, URLs, shell arguments, HTML/Markdown, browser downloads, or another run’s artifact namespace. Treat archive extraction as a separate path-validation surface.

### Secrets and credentials

Config may contain only a typed secret reference such as `{provider, name, purpose, audience, scope, expiresAt}`. The host resolves it only after checking the run’s capability and policy; the skill receives the minimum short-lived credential through an isolated handle or memory-only channel. Reject raw secret material, bearer tokens, private keys, cookies, browser profiles, `.env` paths, and “inherit all environment” options.

Use per-skill/per-destination scopes, short lifetimes, rotation and revocation, and separate identities for read, write, publish, and administration. Do not pass tokens in query strings or page URLs; RFC 6750 identifies URL logging and token disclosure as risks and requires TLS for bearer-token use [R8]. Validate issuer, audience, type, expiry, and scope for signed tokens; RFC 8725 also warns against trusting received claims for URL/key lookup and recommends allowlisting URL locations [R7].

Redact secrets from errors, traces, receipts, prompts, model context, child messages, filenames, URLs, and test fixtures. Audit who requested/used a secret, purpose, approval, time, expiry, and outcome, without recording the value. OWASP recommends centralized fine-grained access, dynamic or frequently rotated secrets, TLS, secure auditing, and least privilege [R1].

### Network and browser permissions

Separate capabilities for DNS, TCP/UDP, HTTP(S), browser navigation, browser JavaScript, uploads/downloads, cookies, and authenticated profiles. Default deny all network and browser access. A `browser` grant must not imply arbitrary network access, and a `network` grant must not imply browser credentials.

For fixed integrations, allowlist exact schemes, hosts, ports, paths, and methods; resolve DNS and validate all A/AAAA results against the policy; re-check after redirects and disable redirects unless each target is re-authorized. For open-web research, use a dedicated egress proxy/sandbox that blocks loopback, link-local, private, multicast, metadata, Unix/file-like schemes, and internal DNS; do not rely on a denylist alone. OWASP says complete user URLs are difficult to validate, recommends allowlists for identified targets, redirect disabling, DNS/IP checks, and network-layer segmentation [R4].

Browser runs require a disposable isolated profile, no ambient cookies or extensions, download quarantine, origin allowlists, permission prompts, no access to host filesystem or local services, and explicit approval for login, upload, publication, payment, or external communication. Treat page text, HTML, attachments, tool results, and browser observations as data, not instructions. Structured instruction/data separation and independent action validation are recommended for agent systems [R4,R9].

### Resource limits and output handling

The host must set hard ceilings before execution and enforce them outside the skill: wall-clock deadline, CPU time, memory, subprocess count, command count, recursion depth, retry budget, token/model spend, network connections, DNS queries, request/response bytes, browser tabs/pages, file reads/writes, archive expansion, and output/artifact size. Child-configured limits can only reduce host ceilings. CWE-20 identifies unbounded length, frequency, quantity, and resource allocation as validation concerns; OWASP agent guidance calls for token, cost, retry, and tool-chain limits [R4,R5].

Output must be typed and validated before persistence, publication, display, or use as a subsequent instruction. Store only declared schemas and destinations; cap size and nesting; reject executable or active content unless separately authorized; scan/redact sensitive data; retain provenance and digest. Publication is an external side effect and requires a distinct capability, exact destination, approval, and idempotency/replay protection.

Validation and test conditions:

- Schema/property tests reject unknown fields, duplicate keys, invalid types, oversized/deep inputs, raw credentials, executable interpolation, and malformed/expired signatures or references.
- Merge tests prove precedence is deterministic and that every low-trust override can only narrow permissions, destinations, credential scopes, and limits; attempts to widen any set fail closed.
- Filesystem property tests cover absolute paths, `..`, encoded/double-encoded separators, alternate separators, NULs, Unicode normalization, symlinks, races, devices, sockets, archive entries, and cross-run artifact IDs. Assert no access outside the trusted root.
- Network tests cover unsupported schemes, loopback/private/link-local/metadata addresses, IPv4/IPv6 forms, DNS rebinding, redirects to disallowed hosts, non-default ports, proxy bypass, oversized responses, and credential forwarding. Assert no request leaves the approved egress boundary.
- Browser tests start from a clean profile and assert no ambient cookies/extensions/local-file access; navigate through cross-origin redirects, downloads, uploads, login prompts, and malicious page instructions. Assert high-impact actions remain pending or denied.
- Secret tests assert raw values never occur in config snapshots, logs, receipts, prompts, child payloads, URLs, errors, crash dumps, or artifacts; verify scope, audience, expiry, revocation, and rotation behavior.
- Resource tests use adversarial recursion, retries, large outputs, slow streams, decompression expansion, subprocess storms, and memory pressure. Assert hard ceilings terminate the run and emit a redacted audit event.
- Confused-deputy tests submit a valid low-privilege caller request that attempts to use a host credential, another tenant's artifact, an unapproved destination, or a widened override. Assert the final sink rejects it even when coordinator and child accept the shape.
- Approval replay/tamper tests alter normalized parameters, effective-config digest, destination, credential reference, expiry, run/edge identity, or nonce after approval. Assert execution is refused and the original initiator remains in audit provenance.

### Injection, confused deputy, and approval binding

The central confused-deputy failure is: an untrusted config or child convinces a privileged host to use the host’s credentials, filesystem, browser, network, or publisher authority on a target the original principal did not authorize. CWE-441 requires preserving the initiator identity through intermediaries and preventing forwarding of unintended hostnames, ports, resources, or directives [R10].

Controls:

- Preserve caller, tenant, parent run, child run, skill, config source, and original intent as immutable provenance through every handoff.
- Use capability tokens or equivalent grants containing subject, issuer, audience, capability, normalized parameters, resource, run, expiry, nonce, policy/config digest, and approval ID. Verify them at the final sink, not only at orchestration time.
- Make approvals exact-action approvals. The repository already binds approval to digest, run IDs, phase, edge, and permission set (`lib/invocation.mjs:96-110`); extend the same binding to effective config digest, destination, normalized arguments, credential reference, and resource limits.
- Do not let model output, repository text, tool output, or child receipts change policy, approval, identity, or capability. Decision-making and execution must be separate, with independent deterministic authorization [R4].
- Use fail-closed behavior for missing policy, stale approval, signature/digest mismatch, unknown field, invalid limit, unavailable audit sink, ambiguous path, or partial config load.

## Recommendation

Adopt a host-owned `effectiveConfig` security boundary before supporting shared all-skills configuration. The minimum acceptable contract is: authenticated source provenance; closed schema; deterministic monotonic merge; canonical effective digest; per-field sensitivity; opaque workspace/artifact references; separate capability namespaces for filesystem, network, browser, credentials, execute, write, and publish; hard host-enforced ceilings; exact parameter-bound approvals; isolated execution; redacted immutable audit records; and fail-closed errors. Do not permit arbitrary config paths or raw credential values in the first version. If arbitrary external paths or ambient credentials are a hard requirement, defer deployment until OS sandboxing, egress controls, secret broker integration, and adversarial testing demonstrate containment.

## Unverified Claims

- U1. The local runtime’s host adapter and artifact resolver behavior outside the inspected files was not audited; verify that they canonicalize paths, enforce roots, and reject redirects/schemes.
- U2. The current schema-runtime parser’s duplicate-key, number, depth, and reference-loading behavior was not executed; verify these properties with parser-specific tests.
- U3. Whether approvals are cryptographically authenticated by the production host is not established by the local schemas; a digest field alone is not proof of signer authenticity.
- U4. Browser isolation, cookie/profile handling, network egress, DNS pinning resistance, and OS sandbox enforcement are host-dependent and not established by this repository.
- U5. Exact numeric ceilings are deployment-specific. They must be selected from workload/resource threat modeling, then enforced and monitored; the sources support boundedness, not universal values.

## References

- [R1] OWASP, “Secrets Management Cheat Sheet,” retrieved 2026-08-27, https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
- [R2] MITRE CWE-22, “Improper Limitation of a Pathname to a Restricted Directory,” CWE 4.20, page updated 2026-04-30, retrieved 2026-08-27, https://cwe.mitre.org/data/definitions/22.html
- [R3] MITRE CWE-73, “External Control of File Name or Path,” CWE 4.20, page updated 2026-04-30, retrieved 2026-08-27, https://cwe.mitre.org/data/definitions/73.html
- [R4] OWASP, “AI Agent Security Cheat Sheet,” retrieved 2026-08-27, https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html
- [R5] OWASP, “Input Validation Cheat Sheet,” retrieved 2026-08-27, https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
- [R6] IETF, “JSON Schema: A Media Type for Describing JSON Documents,” draft-bhutton-json-schema-01, 2022-06-16, retrieved 2026-08-27, https://json-schema.org/draft/2020-12/json-schema-core
- [R7] IETF, RFC 8725, “JSON Web Token Best Current Practices,” BCP 225, 2020-02, retrieved 2026-08-27, https://www.rfc-editor.org/rfc/rfc8725
- [R8] IETF, RFC 6750, “The OAuth 2.0 Authorization Framework: Bearer Token Usage,” updated by RFC 8996 and RFC 9700, 2012-10, retrieved 2026-08-27, https://www.rfc-editor.org/rfc/rfc6750
- [R9] OWASP, “LLM Prompt Injection Prevention Cheat Sheet,” retrieved 2026-08-27, https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html
- [R10] MITRE CWE-441, “Unintended Proxy or Intermediary (‘Confused Deputy’),” CWE 4.20, page updated 2026-04-30, retrieved 2026-08-27, https://cwe.mitre.org/data/definitions/441.html
- [R11] NIST, “SP 800-53 Rev. 5, Security and Privacy Controls,” with 5.2.0 planning note dated 2025-08-27, retrieved 2026-08-27, https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final
- [R12] NIST, “SP 800-63-4, Digital Identity Guidelines,” published 2025-07-31, retrieved 2026-08-27, https://csrc.nist.gov/pubs/sp/800/63/4/final
- [R13] Workspace-local, `csm-orchestrate/SKILL.md:23-46`, retrieved 2026-08-27, `file:///home/jamiemills/.config/opencode/skills/csm-orchestrate/SKILL.md`
- [R14] Workspace-local, `csm-orchestrate/schemas/capabilities.schema.json:110-156`, retrieved 2026-08-27, `file:///home/jamiemills/.config/opencode/skills/csm-orchestrate/schemas/capabilities.schema.json`
- [R15] Workspace-local, `csm-orchestrate/lib/invocation.mjs:88-110`, retrieved 2026-08-27, `file:///home/jamiemills/.config/opencode/skills/csm-orchestrate/lib/invocation.mjs`
- [R16] Workspace-local, `csm-orchestrate/lib/recovery.mjs:86-117`, retrieved 2026-08-27, `file:///home/jamiemills/.config/opencode/skills/csm-orchestrate/lib/recovery.mjs`

## Process Appendix

Research mode: DEEP, hybrid (local repository plus web). Track C: shared all-skills configuration security and trust boundaries. Retrieval date: 2026-08-27. The local protected-state baseline was read with `git status --short`; three pre-existing untracked research JSON files were observed and not modified. No implementation files were edited. Sources were retrieved from OWASP, MITRE CWE, JSON Schema/IETF, and NIST. The JSON Schema URL above is the current 2020-12 core location, but the fetched rendered document identifies itself as an expired 2022 Internet-Draft; do not treat it as a current standards-track publication without confirming the final 2020-12 core/validation texts for implementation conformance. This finding is research evidence, not an implementation authorization.

[2026-08-27T23:59:00Z] INTAKE -> SAVED :: cycle 0 :: trigger: delegated security track completed :: rungs: R0
