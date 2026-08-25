# Evaluation And Trace Contracts

The evaluation contract is offline and deterministic. `schemas/csm-skill-manifest.schema.json` and `schemas/csm-trace.schema.json` are owned by the CSM evaluation boundary; their `$id` and `schema` values are the compatibility authority. Version `1` is strict: unknown versions are rejected, and fields are not silently coerced.

Manifest `csm-skill-manifest/1` describes discovery, compatibility, deterministic fixture mode, and redacted trace mode. It is metadata, not a runtime permission boundary. Trace `csm-trace/1` records bounded event transitions, refusal and recovery outcomes, artifact digests, and the producing event ID.

## Compatibility

Readers must accept current version `1`. The only legacy reader currently defined is an explicit opt-in for `csm-skill-manifest/0`; it returns a legacy-compatibility result and does not upgrade the record. Legacy traces and unknown versions are rejected. A future version requires a new schema, reader branch, fixtures, and compatibility decision.

## Redaction

Raw prompts, secrets, tokens, and complete tool results are not representable in the version `1` trace contract and are rejected by the deterministic runner. Use digests, bounded error codes, tool names, and artifact hashes instead. The default redaction record must name all three omitted classes.

## Evidence

`tests/evals/runner.mjs` is a dependency-free deterministic evaluator. The fixtures cover activation, trajectory, refusal, recovery, artifact correctness, reproducibility, legacy compatibility, invalid versions, raw-prompt rejection, and trace-to-artifact correlation. Live model execution, telemetry, dashboards, provider calls, and A2A are intentionally outside this gate.
