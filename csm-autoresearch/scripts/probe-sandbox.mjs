"use strict";

import {
  createDockerGeneratedProvider,
  createDockerSandboxProvider,
} from "../lib/providers/docker.mjs";
import { hash, probeSandbox } from "../lib/providers/generated.mjs";

// This entrypoint is the trusted host injection point. probeSandbox() itself
// remains fail-closed when called without an explicitly supplied provider.
const provider = createDockerSandboxProvider();
const probe = probeSandbox({ provider });
let result =
  provider.unavailable || !probe.verified
    ? {
        status: "sandbox_unavailable",
        verified: false,
        provider: provider.name,
        diagnostics: provider.unavailable ? [provider.unavailable] : probe.diagnostics,
      }
    : {
        status: "sandbox_unavailable",
        verified: false,
        provider: provider.name,
        diagnostics: probe.diagnostics,
      };
if (!provider.unavailable && probe.verified) {
  const generated = createDockerGeneratedProvider({
    limits: { timeoutMs: 1000, maxOutputBytes: 1024, maxWorkspaceBytes: 1024 * 1024 },
  });
  const source = "export default (value) => ({ score: Number(value) + 1 });";
  const execution = await generated.evaluate({
    format: "csm-autoresearch-evaluator-request/1",
    requestId: "docker-probe-request",
    runId: "docker-probe-run",
    candidate: {
      id: "docker-probe",
      parentId: null,
      sourceHash: hash(source),
      patchHash: hash("docker-probe"),
    },
    limits: { timeoutMs: 1000, maxOutputBytes: 1024, network: "disabled" },
    input: { source, value: 1 },
  });
  if (execution.status !== "ok" || execution.provenance.sandboxProvider !== "docker")
    result = {
      ...result,
      status: "sandbox_unavailable",
      verified: false,
      diagnostics: [
        ...result.diagnostics,
        ...(execution.diagnostics ?? ["synthetic candidate was not verified"]),
      ],
      execution: { status: execution.status, attestation: execution.attestation },
    };
  else
    result = {
      ...result,
      status: "available",
      verified: true,
      diagnostics: [],
      execution: { status: execution.status, attestation: execution.attestation },
    };
}
process.stdout.write(`${JSON.stringify(result)}\n`);
if (process.argv.includes("--required") && result.status !== "available") process.exitCode = 1;
