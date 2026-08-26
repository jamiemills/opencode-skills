import { digest, parseJson } from "../../lib/schema-runtime/index.mjs";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { validatePlanArtifact } from "../../csm-plan/lib/plan.mjs";
import { validateBddPackage } from "../../csm-bdd-tdd/lib/package.mjs";

const assertContainedPath = (path) => {
  if (
    typeof path !== "string" ||
    isAbsolute(path) ||
    path.split(/[\\/]/).some((part) => part === "..")
  )
    throw Object.assign(new Error("path must be relative and contained"), {
      code: "unsafe-path",
    });
};

export async function resolveBddInput(
  packageInput,
  { root = process.cwd(), sourcePlanInput } = {},
) {
  if (typeof packageInput === "string" && /\.(?:md|html?)$/i.test(packageInput))
    return { status: "rejected", code: "migration-required", path: packageInput };
  const load = async (path) => {
    if (
      typeof path !== "string" ||
      isAbsolute(path) ||
      path.split(/[\\/]/).some((part) => part === "..")
    )
      throw Object.assign(new Error("path must be relative and contained"), {
        code: "unsafe-path",
      });
    const target = resolve(root, path);
    const rootReal = await realpath(root);
    const targetReal = await realpath(target);
    const escape = relative(rootReal, targetReal).split(sep).includes("..");
    if (escape || isAbsolute(relative(rootReal, targetReal)))
      throw Object.assign(new Error("path escapes resolver root"), { code: "unsafe-path" });
    return parseJson(await readFile(targetReal, "utf8"));
  };
  let value;
  try {
    value =
      typeof packageInput === "string"
        ? await load(packageInput)
        : (packageInput?.value ?? packageInput);
  } catch (error) {
    return { status: "rejected", code: "invalid-json", message: error.message };
  }
  if (value?.schema === "csm-projection/1") return { status: "rejected", code: "projection-input" };
  try {
    assertContainedPath(value.sourcePlan?.path);
  } catch {
    return { status: "rejected", code: "unsafe-path" };
  }
  if (
    !value?.digest ||
    value.digest !==
      digest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "digest")))
  )
    return { status: "rejected", code: "digest-mismatch" };
  const validation = validateBddPackage(value);
  if (!validation.valid)
    return { status: "rejected", code: "schema-invalid", errors: validation.errors };
  const source = sourcePlanInput ?? value.sourcePlan.path;
  if (typeof packageInput === "string" && source === packageInput)
    return { status: "rejected", code: "source-plan-collision" };
  let planValue;
  try {
    planValue = typeof source === "string" ? await load(source) : (source.value ?? source);
  } catch (error) {
    return { status: "rejected", code: "source-plan-invalid", message: error.message };
  }
  const planValidation = validatePlanArtifact(planValue);
  if (!planValidation.valid)
    return { status: "rejected", code: "source-plan-invalid", errors: planValidation.errors };
  if (
    planValue.artifactId !== value.sourcePlan.artifactId ||
    planValue.runId !== value.sourcePlan.runId
  )
    return { status: "rejected", code: "source-plan-lineage-mismatch" };
  if (value.sourcePlan.digest !== digest(planValue))
    return { status: "rejected", code: "source-plan-digest-mismatch" };
  return Object.freeze({
    status: "resolved",
    schema: value.schema,
    path: typeof packageInput === "string" ? packageInput : null,
    value,
    sourcePlan: {
      status: "resolved",
      schema: "csm-plan/1",
      path: typeof source === "string" ? source : null,
      value: planValue,
    },
  });
}
