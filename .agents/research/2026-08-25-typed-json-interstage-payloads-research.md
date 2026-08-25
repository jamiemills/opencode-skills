format: csm-deep-research/1

# Typed JSON Inter-Stage Payloads Research Finding

## TL;DR

Use JSON Schema Draft 2020-12 as the default contract language for inter-stage payloads, with explicit discriminators, `$id`-based schema identities, `$defs`/`$ref` reuse, and validation at every stage boundary. Use JTD only where its intentionally limited type model, closed-by-default records, standardized error paths, and native tagged-union form are a better fit. Treat payload evolution, unknown-field policy, and schema-version negotiation as suite-level policies, not as automatic consequences of either language.

## Executive Summary

```text
Typed producer -> serialize JSON -> boundary validation -> typed consumer
       |              |                 |                    |
    schema id     JSON data        reject/quarantine      application logic
```

This investigation used primary web sources retrieved 2026-08-25. JSON Schema 2020-12 is a programming-language-independent vocabulary system: it separates assertions, applicators, and annotations, supports reusable identified resources, and provides composition primitives. JTD (RFC 8927) is an Experimental, intentionally constrained schema language designed for code generation and portable validation errors. JSON Schema has no standard `discriminator` keyword; tagged unions are modeled with `oneOf`/`anyOf` plus required tag constraints or conditionals. JTD has a first-class discriminator form.

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

## Recommendation

Adopt a suite contract profile based on JSON Schema Draft 2020-12. Require `$schema`, absolute `$id`, explicit `type`, `required`, and stable `$defs`/`$ref` structure. Require validation at every inter-stage boundary and structured diagnostics using the JSON Schema detailed output shape or a documented subset. Require explicit string discriminators for unions and test that branches are mutually exclusive.

Permit JTD only as a deliberate alternative for simple, generated, closed-record payloads. Mark JTD contracts as Experimental-dependent in documentation, and do not claim that JTD metadata is portable validation behavior.

Choose unknown-field behavior per risk: open-and-preserve for forward-compatible internal pipelines; closed-and-reject for security boundaries and tightly controlled records. Version schema resources immutably and maintain compatibility tests across producer/consumer combinations. Confidence is high for the language semantics and medium for the evolution recommendations because the specifications do not define a universal compatibility policy. The recommendation changes if the suite's dominant requirement becomes generated code with a narrow record model and no need for conditional/composed constraints.

## Unverified Claims

- No universal JSON Schema or JTD rule defines which schema edits are backward- or forward-compatible. Validate the proposed policy against the suite's concrete serializers, validators, persistence/replay behavior, and generated types.
- No retrieved standard defines a portable runtime schema-negotiation protocol for these inter-stage messages. If stages can be independently deployed, the suite needs an explicit registry or routing policy.
- Validator behavior for duplicate JSON object names depends on the parser and should be tested for the chosen implementation.
- Performance, memory use, and generated-code quality were not benchmarked. Composition depth, `oneOf`, annotation collection, and reference resolution can materially affect them.
- This investigation did not inspect the local skill repository, per the web-only research mode; recommendations are suite-level and not mapped to specific local files.

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

## Process Appendix

Research mode: web-only. Complexity: DEEP, because the result informs a cross-stage contract architecture and includes competing schema languages and evolution trade-offs. Tracks: JSON Schema normative semantics; JTD normative semantics and status; composition/unions/unknown fields; validation/annotations/versioning guidance.

### Control Journal

[2026-08-25T00:00:00Z] INTAKE -> TRIAGE :: cycle 0 :: trigger: external standards research request
[2026-08-25T00:01:00Z] TRIAGE -> RESEARCH :: cycle 0 :: trigger: DEEP web-only tracks selected
[2026-08-25T00:10:00Z] RESEARCH -> SYNTHESIZE :: cycle 0 :: trigger: primary standards and official guidance retrieved
[2026-08-25T00:20:00Z] SYNTHESIZE -> CHALLENGE :: cycle 0 :: trigger: atomic claim draft complete
[2026-08-25T00:25:00Z] CHALLENGE -> JUDGE :: cycle 0 :: trigger: citation and scope challenge completed primary-led
[2026-08-25T00:30:00Z] JUDGE -> REMEDIATE :: cycle 0 :: trigger: primary-led citation and status caveat pass
[2026-08-25T00:35:00Z] REMEDIATE -> VERIFY :: cycle 0 :: trigger: recommendations separated from normative claims
[2026-08-25T00:40:00Z] VERIFY -> SAVED :: cycle 0 :: trigger: structure, citations, redaction, and protected tree checked
[2026-08-25T00:41:00Z] SAVED complete :: cycle 0

State record: INTAKE -> TRIAGE -> RESEARCH -> SYNTHESIZE -> CHALLENGE -> JUDGE -> REMEDIATE -> VERIFY -> SAVED, completed 2026-08-25. Web retrieval was performed with direct standards and JSON Schema project URLs. Evidence was synthesized into atomic claims; recommendations are labeled separately from normative claims. No local repository files were read or changed other than this research finding. No implementation, benchmark, or compatibility test was run.

Independence caveat: the available run was primary-led in this environment; claims were cross-checked against the retrieved primary documents and official project guidance, but no separate external challenger or judge was available. Residual uncertainty is listed above rather than promoted to fact.
