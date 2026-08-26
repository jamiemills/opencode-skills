import { readFile, realpath } from "node:fs/promises";
import { resolve, isAbsolute, relative, sep } from "node:path";
import { createSchemaValidator, digest, parseJson } from "../../lib/schema-runtime/index.mjs";
import schema from "../../csm-make-tests/schemas/test-package.schema.json" with { type: "json" };
import { validatePlanArtifact } from "../../csm-plan/lib/plan.mjs";
import { assertVerification } from "../../csm-make-tests/lib/verification.mjs";

export const TEST_PACKAGE_SCHEMA = "csm-test-package/1";
const validator = createSchemaValidator({ schemas: [schema] });
const reject = (code, message) => Object.freeze({ status: "rejected", code, message });

export function validateTestPackage(value) {
  return validator.validate(TEST_PACKAGE_SCHEMA, value);
}

export async function resolveTestPackage(
  input,
  { root = process.cwd(), expectedPlanDigest, replay = false } = {},
) {
  const load = async (path) => {
    if (
      typeof path !== "string" ||
      isAbsolute(path) ||
      path.split(/[\\/]/).some((part) => part === "..")
    )
      throw new Error("path must be relative and contained");
    const base = await realpath(root);
    const target = await realpath(resolve(root, path));
    const rel = relative(base, target);
    if (isAbsolute(rel) || rel.split(sep).includes("..")) throw new Error("path escapes root");
    return parseJson(await readFile(target, "utf8"));
  };
  if (typeof input === "string") {
    if (isAbsolute(input) || /\.md$|\.html?$/i.test(input))
      return reject("json-only-input", "test package input must be canonical JSON");
    try {
      input = await load(input);
    } catch {
      return reject("invalid-json", "test package input is not valid JSON");
    }
  }
  const result = validateTestPackage(input);
  if (!result.valid)
    return { ...reject("schema-invalid", "test package does not validate"), errors: result.errors };
  if (expectedPlanDigest && input.sourcePlan.planDigest !== expectedPlanDigest)
    return reject("lineage-mismatch", "test package source plan digest does not match");
  if (!expectedPlanDigest)
    return reject("lineage-required", "expected source plan digest is required");
  let sourcePlan;
  try {
    sourcePlan = await load(input.sourcePlan.planPath);
  } catch (error) {
    return reject("source-plan-invalid", error.message);
  }
  const planValidation = validatePlanArtifact(sourcePlan);
  if (!planValidation.valid)
    return {
      ...reject("source-plan-invalid", "source plan is invalid"),
      errors: planValidation.errors,
    };
  if (digest(sourcePlan) !== input.sourcePlan.planDigest)
    return reject("source-plan-digest-mismatch", "source plan digest does not match");
  if (input.verification.status !== "VERIFIED")
    return reject("verification-incomplete", "test package verification is not VERIFIED");
  if (replay && !input.replay.length)
    return reject("replay-missing", "test package has no replay fixtures");
  if (input.mutation && input.mutation.status !== "verified")
    return reject("mutation-evidence", "mutation evidence is stale or missing");
  if (input.performance && input.performance.status !== "verified")
    return reject("performance-evidence", "performance evidence is stale or missing");
  let verification;
  try {
    verification = await load(input.verification.path);
    assertVerification(verification);
  } catch (error) {
    return reject("verification-invalid", error.message);
  }
  if (verification.status !== input.verification.status)
    return reject("verification-status-mismatch", "verification receipt status does not match");
  if (digest(verification) !== input.verification.digest)
    return reject("verification-digest-mismatch", "verification receipt digest does not match");
  return Object.freeze({
    status: "resolved",
    value: input,
    digest: digest(input),
    replay: input.replay,
  });
}
