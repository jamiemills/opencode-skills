import { createSchemaValidator } from "../../../lib/schema-runtime/index.mjs";
import schema from "../schemas/verification.schema.json" with { type: "json" };

export const VERIFICATION_SCHEMA = "csm-make-tests-verification/1";
const validator = createSchemaValidator({ schemas: [schema] });
export const validateVerification = (value) => validator.validate(VERIFICATION_SCHEMA, value);
export function assertVerification(value) {
  const result = validateVerification(value);
  if (!result.valid)
    throw Object.assign(new Error("invalid csm-make-tests verification"), {
      code: "schema-invalid",
      errors: result.errors,
    });
  if (value.status !== value.verificationStatus.status)
    throw Object.assign(new Error("verification status is inconsistent"), {
      code: "status-mismatch",
    });
  if (value.status === "VERIFIED") {
    if (value.unresolved.length || value.verificationStatus.unresolved.length)
      throw Object.assign(new Error("verified receipt has unresolved items"), {
        code: "unresolved",
      });
    if (!value.evidence.length || value.evidence.some((item) => item.status !== "verified"))
      throw Object.assign(new Error("verified receipt lacks verified evidence"), {
        code: "evidence-incomplete",
      });
    if (
      value.evidence.some((item) =>
        item.references.some((reference) => reference.status && reference.status !== "verified"),
      )
    )
      throw Object.assign(new Error("verified receipt references stale or missing evidence"), {
        code: "evidence-incomplete",
      });
  }
  return value;
}
