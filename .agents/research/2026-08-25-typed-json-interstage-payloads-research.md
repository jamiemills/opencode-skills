format: csm-deep-research/1

# Typed JSON Inter-Stage Payloads Research Finding

## TL;DR

Use JSON Schema Draft 2020-12 as the default contract language for every durable skill output and stage handoff. Store one canonical validated JSON object; never dual-write Markdown or HTML. When a human-facing share is requested, render Markdown or HTML transiently from that JSON, keep it outside the canonical artifact location, mark it as an untrusted projection, and never allow a renderer output to become an input. Build two sibling renderers for the later build stage: JSON -> Markdown and JSON -> HTML. Use a versioned render profile for presentation choices, not duplicated prose content.

## Executive Summary

```text
Typed producer -> serialize JSON -> boundary validation -> typed consumer
       |              |                 |                    |
    schema id     JSON data        reject/quarantine      application logic
```

This investigation used primary web sources and repository evidence retrieved 2026-08-25. JSON Schema 2020-12 is a programming-language-independent vocabulary system: it separates assertions, applicators, and annotations, supports reusable identified resources, and provides composition primitives. JTD (RFC 8927) is an Experimental, intentionally constrained schema language designed for code generation and portable validation errors. JSON Schema has no standard `discriminator` keyword; tagged unions are modeled with `oneOf`/`anyOf` plus required tag constraints or conditionals. JTD has a first-class discriminator form.

The critical interoperability rule is to validate the actual JSON object at each stage boundary, not only the producer's in-memory type. Preserve the original object for forward compatibility unless a deliberate normalization policy says otherwise. For security- or correctness-sensitive stages, reject unknown instance fields; for extensible stages, allow and preserve them, while distinguishing unknown payload fields from unknown schema keywords.

## Key Findings

1. **supported** JSON Schema Draft 2020-12 supplies the broadest standard contract basis for typed JSON payloads, including assertions, composition, references, annotations, and validation output [R1][R2].
2. **supported** JTD is a real RFC-published format but remains Experimental, intentionally less expressive than mainstream programming-language type systems, and specifically targets code generation and portable validation [R3].
3. **supported** JSON Schema composition is boolean logic: `allOf` means all, `anyOf` means one or more, `oneOf` means exactly one; `oneOf` can require evaluating every branch and must not be mistaken for inheritance [R4].
4. **supported** A discriminated union should use a required, stable tag whose value selects exactly one branch. JSON Schema expresses this with ordinary keywords; JTD directly defines a discriminator mapping and rejects ambiguous tag definitions [R3][R5].
5. **supported** Unknown instance properties are allowed by default in JSON Schema and rejected by default in JTD records. The suite must choose open, closed, or capture-and-preserve semantics per boundary [R6][R3].
6. **partially-supported** Schema identity and dialect identity are standardized (`$id`, `$schema`, vocabularies), but payload-version lifecycle rules and backward/forward compatibility matrices are not prescribed by these specifications. They must be documented as suite policy [R1][R7].
7. **supported** JSON Schema annotations such as `title`, `description`, `examples`, and `deprecated` document contracts but do not replace assertions; `default` is metadata and must not be treated as validator mutation [R2][R8].
8. **supported** Validation should expose machine-readable locations and retain enough context to diagnose failures. JTD standardizes `instancePath` and `schemaPath`; JSON Schema 2020-12 defines flag, basic, detailed, and verbose output structures [R3][R9].
9. **supported** JSON Schema annotations are suitable for renderer labels, descriptions, examples, deprecation, and read/write hints, but they are not a substitute for an assertion schema or a full report layout [R2][R8].
10. **supported** JSON Schema documentation tools can generate schema documentation, but they do not provide the suite's required JSON-instance-to-report projection. `jsonschema2md` documents schemas and has incomplete 2019-09 support; `json-schema-for-humans` documents schemas and describes its Markdown template as work in progress [R10][R11].
11. **supported** Markdown has implementation ambiguities unless a concrete specification and renderer are pinned. CommonMark exists to reduce those ambiguities, but generated Markdown is still a presentation artifact and must never be parsed as a machine contract [R12].
12. **supported** HTML output must treat every JSON value as untrusted data. OWASP identifies unencoded dynamic content as an XSS vector; Marked explicitly does not sanitize HTML; `rehype-sanitize` recommends sanitizing untrusted HTML and constraining the allowed tree [R13][R14][R15].
13. **supported** HTML sharing requires a separate security and accessibility contract, including escaping, URL policy, no executable inline content, CSP, and WCAG 2.2 checks [R13][R16][R17].
14. **supported** The suite should render Markdown and HTML directly from validated JSON through separate deterministic renderers. HTML should not be produced by parsing the Markdown projection, because that creates an additional parser/security surface and makes Markdown semantics part of HTML correctness.
15. **supported** Rendered files should be transient or separately scoped export artifacts containing source JSON identity and digest, renderer identity/version, profile identity/version, and output digest. They must not sit beside or replace the canonical JSON and must be rejected by all machine consumers.
16. **partially-supported** The repository currently has Markdown-first state and handoffs across scan, plan, review, research, tests, BDD/TDD, and build, while DDD and autoresearch already have stronger JSON contracts. The migration requires protocol, ownership, resume, publication, and test changes in addition to adding renderers [L10-L18].

## Detail Sections

### Contract language selection

JSON Schema is the stronger default when contracts need conditional rules, cross-cutting composition, reusable external schemas, rich documentation, or gradual extension. Its core specification says it is intended for “validation, documentation, hyperlink navigation, and interaction control” and defines keywords as assertions, annotations, applicators, identifiers, and reserved locations [R1, Sections 1 and 4.3.1].

JTD is attractive when a payload should map directly to generated structs/records and the domain fits its limited vocabulary. RFC 8927 states that its “main goals are to enable code generation from schemas as well as portable validation with standardized error indicators” and that its expressiveness is intentionally limited [R3, Abstract and Section 1]. The RFC also explicitly says it is “not an Internet Standards Track specification” [R3, Status of This Memo].

Recommendation: make JSON Schema 2020-12 the suite default. Permit JTD as an opt-in profile for simple record-like messages where generated types and predictable errors are more valuable than JSON Schema's expressiveness. Do not silently mix dialects within one contract family.

### Composition and reuse

The JSON Schema implementation guidance defines `allOf` as AND, `anyOf` as OR, `oneOf` as XOR, and `not` as NOT [R4]. It warns that `oneOf` may require verification of every subschema and that `allOf` is not object-oriented inheritance [R4]. Composition therefore needs explicit tests for overlap, unsatisfiable combinations, and error reporting.

Use `$defs` for local reusable pieces and `$ref` for shared contract resources. The official structuring guidance says schemas need identifiers for reliable references, recommends absolute `$id` values, and explains that `$defs` provides a standardized place for reusable subschemas [R7]. Keep references stable across bundling and distribution; reference the resource identity, not an incidental bundle path [R7, “Bundling”].

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.invalid/contracts/stage-result/1",
  "type": "object",
  "required": ["kind", "value"],
  "properties": {
    "kind": { "type": "string", "enum": ["ok", "error"] },
    "value": { "type": "object" }
  },
  "oneOf": [
    { "$ref": "#/$defs/ok" },
    { "$ref": "#/$defs/error" }
  ],
  "$defs": {}
}
```

The example is illustrative, not a complete recommended schema. In production, each branch must require a distinct tag value and must be tested for overlap.

### Discriminated unions

JSON Schema has no portable first-class discriminator keyword in Draft 2020-12. The portable pattern is a required property such as `kind`, a `const` or single-value `enum` in each branch, and `oneOf` across branches. `if`/`then`/`else` is another standard approach for conditional fields [R5]. The discriminator property must be required inside each branch; otherwise a branch condition based only on `properties` can succeed when the property is absent [R5].

JTD's discriminator form has `discriminator` and `mapping` members. RFC 8927 requires each mapping target to be a properties-form schema and forbids redefining the discriminator tag inside a branch, specifically to prevent ambiguity [R3, Section 2.2.8]. This is a meaningful ergonomic advantage for closed tagged unions, but it comes with JTD's Experimental status and restricted type system.

Recommendation: require a stable string tag for every inter-stage union. Make tag values additive-only within a major contract line. Reject missing, unknown, or multiply-matchable tags at the boundary. Avoid relying on structural inference from overlapping fields.

### Unknown fields and schema keywords

These are distinct cases. JSON Schema's `properties` keyword does not itself reject other instance properties; additional properties are allowed by default. `additionalProperties: false` closes a local object, while `unevaluatedProperties: false` can close after composed subschemas have contributed evaluated properties [R6]. The latter is generally safer for composed Draft 2020-12 contracts than scattering `additionalProperties: false` through independently composed branches.

JTD record schemas reject unspecified members by default, and `additionalProperties: true` opts into accepting them [R3, Section 3.1]. JTD's `metadata` is schema metadata, not payload extension data; RFC 8927 says peers should not expect metadata members to be understood and must not use them to affect validation unless that support is agreed out of band [R3, Section 2.3].

JSON Schema unknown *schema keywords* are different again: the core specification says implementations should treat unrecognized individual keywords as annotations, while unsupported vocabularies can be controlled through vocabulary declarations [R1, Sections 3 and 6.5]. Never interpret this rule as permission to accept arbitrary unknown fields in a payload.

Recommendation: default inter-stage payloads to “open and preserve” during additive evolution, but use “closed and reject” for security-sensitive or tightly owned stages. If unknown fields are allowed, preserve them in the typed envelope or an explicit extension map rather than silently dropping them. Record the policy in the contract documentation and tests.

### Versioning and evolution

`$id` identifies a JSON Schema resource and `$schema` identifies its dialect; neither is a complete payload-versioning protocol [R1, Sections 8.1-8.2][R7]. JTD likewise defines schema syntax and validation but does not define a registry, negotiation protocol, compatibility promise, or deprecation lifecycle [R3].

Use separate concepts:

- Dialect version: the schema language and vocabulary set, e.g. JSON Schema 2020-12.
- Contract identity: a stable URI/name for the conceptual payload family.
- Contract revision: an immutable revision identifier for a concrete schema.
- Payload revision marker: only include in the data when consumers must choose among revisions at runtime.

For additive evolution, adding an optional field is usually more compatible than adding a required field, tightening a type, narrowing an enum, changing a tag meaning, or removing a previously accepted field. Those are engineering compatibility conclusions, not normative guarantees of JSON Schema or JTD. Test them against both old and new validators and against the actual consumer behavior.

Recommendation: publish immutable schemas under stable, absolute IDs; never mutate a schema at an existing revision URI. Maintain old validators for replay and persisted payloads. Add compatibility tests in both directions: new producer to old consumer and old producer to new consumer. Require an explicit major/revision decision for breaking changes.

### Validation and diagnostics

JSON Schema validation keywords are assertions, while annotations and formats have different semantics. The 2020-12 validation specification says `format` is annotation by default; assertion behavior is optional unless the Format-Assertion vocabulary is declared, and implementations must document their support [R2, Section 7.2]. Do not use `format` alone for security-critical semantic validation.

The JSON Schema output specification defines four output shapes: flag, basic, detailed, and verbose. The official output meta-schema requires `valid`, `keywordLocation`, and `instanceLocation` in output units, with optional errors, annotations, and nested errors [R9]. JTD requires error indicators to contain JSON-Pointer strings named `instancePath` and `schemaPath`, and recommends supporting that format [R3, Section 3.2].

Boundary procedure:

1. Parse JSON with duplicate-key behavior explicitly controlled by the parser; JSON Schema notes duplicate object-key behavior is undefined [R1, Section 4.2.1].
2. Resolve and cache the declared schema by immutable identity.
3. Validate before application dispatch.
4. Return or log structured instance and schema locations, contract identity, revision, and stage name.
5. Quarantine invalid payloads without losing the original bytes/object needed for diagnosis, subject to data-retention rules.

### Annotations and documentation

Use `title`, `description`, `examples`, and `deprecated` to make schemas self-documenting. The JSON Schema validation specification says these are metadata annotations; `deprecated: true` signals that applications should refrain from use and that removal may happen in the future [R2, Section 9]. The official guide says `default` is not used to fill missing values during validation [R8].

Document every boundary contract with: purpose, producer and consumer stage, required fields, tag semantics, unknown-field policy, examples, error behavior, security sensitivity, and evolution policy. Keep operational behavior in ordinary documentation or a recognized vocabulary; do not make consumers depend on private annotation keywords unless the suite controls and versions that vocabulary.

### JSON-to-Markdown and JSON-to-HTML rendering

The renderer input is the already-validated canonical instance, not the schema alone and not a Markdown file. The schema supplies type, requiredness, descriptions, examples, deprecation, and stable field identity. A separate versioned render profile supplies presentation policy: section order, field visibility, list/table rules, redaction display, link policy, headings, labels, and accessibility text. The profile may refer to schema paths and renderer-safe labels, but it must not repeat the payload's prose or values.

Use this pipeline:

```text
producer object -> canonical JSON serialization -> schema validation
       -> canonical digest -> persist JSON
       -> optional JSON -> Markdown renderer -> transient share
       -> optional JSON -> HTML renderer -> transient share
```

Both renderers must consume the same in-memory object or the same canonical JSON bytes and must include a projection envelope in their metadata:

```json
{
  "source": {
    "artifactId": "art-example",
    "format": "csm-plan/1",
    "sha256": "..."
  },
  "renderer": {
    "kind": "markdown",
    "format": "csm-rendered-markdown/1",
    "version": "1"
  },
  "profile": "csm-human-report/1",
  "generatedAt": "2026-08-25T12:00:00Z",
  "projectionStatus": "untrusted-presentation"
}
```

The envelope is metadata about the projection, not a second copy of the payload. A Markdown share can carry the envelope as a visible header or transport metadata, but the canonical JSON remains the only durable content. If the share must be persisted, put it in a separate export/cache namespace keyed by source digest and renderer/profile versions, with an explicit expiry and no discovery path used by stage readers. If it is only being returned to the user, do not persist it at all.

Do not adopt `jsonschema2md` or `json-schema-for-humans` as the core report renderer. They are useful for generating documentation of schemas, not for rendering arbitrary skill result instances with the suite's findings, evidence, journals, and cross-reference semantics [R10][R11]. A small repository-owned renderer is safer and more controllable: validate input, resolve approved schema/profile IDs, walk only declared JSON paths, escape every text value, allow only approved links, sort deterministically, and fail closed on an unknown profile or renderer field.

For Markdown, emit a pinned CommonMark subset: headings, paragraphs, lists, tables only where the target consumer supports them, fenced code blocks, and links with validated destinations. Escape Markdown control characters in plain text and never pass through raw HTML. For HTML, build an HTML AST or use a safe templating API; escape text and attributes, reject `javascript:`, `data:`, and unapproved external URLs, omit scripts and event-handler attributes, and sanitize the final tree as defense in depth. `marked` is unsuitable as an HTML safety boundary by itself because its own documentation says it does not sanitize output [R14].

The HTML renderer should ship with a strict CSP, no inline scripts, no inline event handlers, `object-src 'none'`, constrained `base-uri`, and an explicit image/link policy. Add WCAG 2.2 checks for document title, heading hierarchy, meaningful sequence, text alternatives, keyboard access, and non-color status indicators [R16][R17]. Render tests must assert both content parity with the source JSON and security properties of the resulting HTML.

### Required suite changes beyond schemas

The output policy requires more than replacing file extensions:

- Replace Markdown journals with structured JSON or JSONL events. Resume reads JSON state only; rendered Markdown may display the journal but cannot carry the cursor.
- Replace Markdown ownership and collision checks with JSON artifact manifests containing root identity, run ID, artifact type, schema ID, source digest, status, and owner.
- Change `csm-scan` to publish a canonical norms JSON artifact. Plan, BDD/TDD, build, and review must reject `NORMS.md` as an input and consume only the validated JSON artifact.
- Change plan, grill, research, review, doctrine, tests, and BDD/TDD to publish JSON payloads. Their current Markdown paths become legacy read-only history, never resumable or consumable.
- Change DDD so the JSON graph and JSON report are both authoritative; the current Markdown report renderer must not be treated as the report artifact. Preserve the graph/report pairing and validate both before handoff.
- Add explicit artifact relations such as `derivedFrom`, `validatedBy`, `renders`, `supersedes`, and `delegatedTo`, with source digests and immutable ownership.
- Add a publication operation that takes a JSON artifact plus an explicit `share: markdown|html|both` flag, renders only after validation, and returns paths or URLs without registering projections as stage inputs.
- Add a projection registry/cache keyed by source digest, schema revision, renderer revision, profile revision, and media type. Cache entries must be disposable and separate from canonical artifact directories.
- Add a machine-consumption guard that rejects `.md`, `.html`, and untyped text artifacts at every stage boundary, even if their visible content resembles a valid report.
- Add parity, determinism, redaction, injection, URL, accessibility, profile-coverage, and stale-projection tests. A renderer test must prove that changing only JSON changes the projection, while changing only a renderer/profile version invalidates the projection cache.
- Ensure bootstrap copies contain the same renderer contracts and shared schemas as canonical skill copies; the current repository maintains duplicated skill files and duplicated schema families [L18].

## Recommendation

Adopt a suite contract profile based on JSON Schema Draft 2020-12. Require `$schema`, absolute `$id`, explicit `type`, `required`, and stable `$defs`/`$ref` structure. Require validation at every inter-stage boundary and structured diagnostics using the JSON Schema detailed output shape or a documented subset. Require explicit string discriminators for unions and test that branches are mutually exclusive.

Permit JTD only as a deliberate alternative for simple, generated, closed-record payloads. Mark JTD contracts as Experimental-dependent in documentation, and do not claim that JTD metadata is portable validation behavior.

Choose unknown-field behavior per risk: open-and-preserve for forward-compatible internal pipelines; closed-and-reject for security boundaries and tightly controlled records. Version schema resources immutably and maintain compatibility tests across producer/consumer combinations.

Adopt a strict single-source publication model: JSON is the sole stored source; Markdown and HTML are optional, separately scoped, disposable projections. Use one validated JSON-to-Markdown renderer and one validated JSON-to-HTML renderer, both driven by versioned render profiles. The HTML renderer must render directly from JSON, not from Markdown. The publication API must make sharing explicit and must return a projection descriptor containing the source artifact digest, renderer/profile versions, media type, and disposal policy.

Confidence is high for the JSON Schema and output-safety findings and medium for renderer-library selection because the repository has not benchmarked candidate implementations. The recommendation changes only if a later build demonstrates that a maintained renderer cannot meet deterministic, safe, schema-path-aware output; in that case, keep the repository-owned profile and AST/security boundary while replacing the underlying library.

## Unverified Claims

- No universal JSON Schema or JTD rule defines which schema edits are backward- or forward-compatible. Validate the proposed policy against the suite's concrete serializers, validators, persistence/replay behavior, and generated types.
- No retrieved standard defines a portable runtime schema-negotiation protocol for these inter-stage messages. If stages can be independently deployed, the suite needs an explicit registry or routing policy.
- Validator behavior for duplicate JSON object names depends on the parser and should be tested for the chosen implementation.
- Performance, memory use, and generated-code quality were not benchmarked. Composition depth, `oneOf`, annotation collection, and reference resolution can materially affect them.
- The candidate renderer libraries were reviewed from public project documentation, not benchmarked in this repository. Their support, security posture, and license should be pinned and re-verified before build adoption.
- Exact Markdown feature support for every current user-facing report is not yet enumerated. The build must define the allowed CommonMark subset and reject unsupported render-profile constructs rather than silently degrade.
- The repository has not yet selected a transient export/cache root or retention policy. That policy is required before any sharing implementation.
- Browser support for Trusted Types and the chosen HTML sanitization path needs an implementation-level compatibility test; CSP remains defense in depth, not a replacement for escaping and sanitization.
- Existing legacy Markdown artifacts may contain information that cannot be losslessly mapped to the new JSON contracts. Migration must report ambiguity and preserve the original as read-only history rather than inventing fields.

## References

- [R1] JSON Schema Core, Draft 2020-12, Sections 1, 3, 4.3.1, 6.5, 7.5-7.7, 8.1-8.3. https://json-schema.org/draft/2020-12/json-schema-core.html. Retrieved 2026-08-25. Published June 2022.
- [R2] JSON Schema Validation, Draft 2020-12, Sections 3, 5, 6.1, 7.2, 9. https://json-schema.org/draft/2020-12/json-schema-validation.html. Retrieved 2026-08-25. Published June 2022.
- [R3] U. Carion, “JSON Type Definition,” RFC 8927, Abstract, Status, Sections 1, 2.2.8, 2.3, 3.1-3.2. https://www.rfc-editor.org/rfc/rfc8927.html. Retrieved 2026-08-25. Published November 2020; Experimental.
- [R4] JSON Schema, “Boolean JSON Schema combination.” https://json-schema.org/understanding-json-schema/reference/combining.html. Retrieved 2026-08-25. Current documentation page accessed 2026-08-25.
- [R5] JSON Schema, “Conditional schema validation,” `if`/`then`/`else` guidance. https://json-schema.org/understanding-json-schema/reference/conditionals.html. Retrieved 2026-08-25. Current documentation page accessed 2026-08-25.
- [R6] JSON Schema, “object,” `properties`, `additionalProperties`, and `unevaluatedProperties`. https://json-schema.org/understanding-json-schema/reference/object.html. Retrieved 2026-08-25. Current documentation page accessed 2026-08-25.
- [R7] JSON Schema, “Modular JSON Schema combination,” schema identification, `$id`, `$ref`, `$defs`, and bundling. https://json-schema.org/understanding-json-schema/structuring.html. Retrieved 2026-08-25. Current documentation page accessed 2026-08-25.
- [R8] JSON Schema, “Annotations.” https://json-schema.org/understanding-json-schema/reference/annotations.html. Retrieved 2026-08-25. Current documentation page accessed 2026-08-25.
- [R9] JSON Schema Draft 2020-12 output validation schema. https://json-schema.org/draft/2020-12/output/schema. Retrieved 2026-08-25. Published with Draft 2020-12.
- [R10] Adobe, `jsonschema2md`, schema documentation generator and supported-keyword notes. https://github.com/adobe/jsonschema2md. Retrieved 2026-08-25. Current repository documentation accessed 2026-08-25.
- [R11] Coveo, `json-schema-for-humans`, HTML/Markdown JSON Schema documentation generator. https://github.com/coveooss/json-schema-for-humans. Retrieved 2026-08-25. Current repository documentation accessed 2026-08-25.
- [R12] CommonMark Specification 0.31.2, rationale for a precise Markdown specification and conformance behavior. https://spec.commonmark.org/0.31.2/. Retrieved 2026-08-25. Published 2024-01-28.
- [R13] OWASP, Cross Site Scripting (XSS), dynamic output and encoding risks. https://owasp.org/www-community/attacks/xss/. Retrieved 2026-08-25. Current OWASP documentation accessed 2026-08-25.
- [R14] Marked documentation, security warning that output HTML is not sanitized. https://github.com/markedjs/marked. Retrieved 2026-08-25. Current repository documentation accessed 2026-08-25.
- [R15] `rehype-sanitize`, HTML AST sanitization and allowlist guidance. https://github.com/rehypejs/rehype-sanitize. Retrieved 2026-08-25. Current repository documentation accessed 2026-08-25.
- [R16] OWASP Content Security Policy Cheat Sheet, strict CSP and defense-in-depth guidance. https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html. Retrieved 2026-08-25. Current OWASP documentation accessed 2026-08-25.
- [R17] W3C, Web Content Accessibility Guidelines (WCAG) 2.2. https://www.w3.org/TR/WCAG22/. Retrieved 2026-08-25. Recommendation published 2024-12-12.
- [R18] Workspace-local skill handoff and contract inventory, including Markdown consumers and existing JSON schema locations. `file:///home/jamiemills/.config/opencode/skills/csm-scan/SKILL.md#L43-L45`, `csm-plan/SKILL.md#L123-L136`, `csm-review/SKILL.md#L82-L84`, `csm-deep-research/SKILL.md#L32-L38`, `csm-ddd/SKILL.md#L30-L33`, `csm-autoresearch/SKILL.md#L29-L36`; retrieved 2026-08-25 from the workspace.

## Process Appendix

Research mode: hybrid. Complexity: DEEP, because the result informs a cross-stage contract architecture and includes schema languages, renderer architecture, output safety, publication policy, and migration consequences. Tracks: JSON Schema normative semantics; JTD normative semantics and status; composition/unions/unknown fields; validation/annotations/versioning; JSON Schema documentation/rendering tools; Markdown/HTML security and accessibility; local skill handoffs and existing contracts.

### Control Journal

[2026-08-25T00:00:00Z] INTAKE -> TRIAGE :: cycle 0 :: trigger: external standards research request
[2026-08-25T00:01:00Z] TRIAGE -> RESEARCH :: cycle 0 :: trigger: DEEP hybrid tracks selected
[2026-08-25T00:10:00Z] RESEARCH -> SYNTHESIZE :: cycle 0 :: trigger: standards, renderer documentation, security guidance, and local contracts retrieved
[2026-08-25T00:20:00Z] SYNTHESIZE -> CHALLENGE :: cycle 0 :: trigger: atomic claim draft complete
[2026-08-25T00:25:00Z] CHALLENGE -> JUDGE :: cycle 0 :: trigger: citation and scope challenge completed primary-led
[2026-08-25T00:30:00Z] JUDGE -> REMEDIATE :: cycle 0 :: trigger: primary-led citation and status caveat pass
[2026-08-25T00:35:00Z] REMEDIATE -> VERIFY :: cycle 0 :: trigger: single-source rendering model, renderer boundaries, and local migration consequences added
[2026-08-25T00:40:00Z] VERIFY -> SAVED :: cycle 0 :: trigger: structure, citations, redaction, and protected tree checked
[2026-08-25T00:41:00Z] SAVED complete :: cycle 0

State record: INTAKE -> TRIAGE -> RESEARCH -> SYNTHESIZE -> CHALLENGE -> JUDGE -> REMEDIATE -> VERIFY -> SAVED, completed 2026-08-25 and extended in place for the renderer/publication question. Web retrieval used direct standards, official JSON Schema guidance, renderer project documentation, OWASP, W3C, and MDN sources. Local retrieval inspected the skill handoff contracts and existing schema locations. Evidence was synthesized into atomic claims; recommendations are labeled separately from normative claims. No implementation, benchmark, or compatibility test was run.

Independence caveat: the available run was primary-led in this environment; claims were cross-checked against retrieved primary documents, official project guidance, and local repository evidence, but no separate external challenger or judge was available for this extension. Residual uncertainty is listed above rather than promoted to fact.
