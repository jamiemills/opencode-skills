// F-030 — framework presence is no longer treated as verified auth/validation
// evidence.
//
// Before this fix merely depending on Django or FastAPI produced
// "Authentication: Django (contrib.auth)" and "Input validation" findings and
// lifted the security signal to high. After the fix those framework-level
// entries carry a distinct `Capability` type: they surface in the inventory but
// never count toward `detected` and never lift the signal; only specific
// auth/validation subsystems do.

import assert from "node:assert/strict";
import { test } from "node:test";

import { withFixture } from "./harness.mjs";
import { scan } from "../lib/scan/deep/security.mjs";

function fixture(deps) {
  return {
    "pyproject.toml": [
      "[project]",
      'name = "demo"',
      'version = "0.1.0"',
      `dependencies = [${deps.map((d) => JSON.stringify(d)).join(", ")}]`,
      "",
    ].join("\n"),
  };
}

test("F-030: a django-only repo reports the capability but no verified auth/validation and no high signal", async () => {
  await withFixture("f030-django", fixture(["django"]), async (dir) => {
    const res = await scan(dir, {});
    assert.equal(res.findings.auth.detected, false, "django must not count as verified auth");
    assert.equal(
      res.findings.inputValidation.detected,
      false,
      "django must not count as verified validation",
    );
    // The capability entry still surfaces in the inventory for transparency.
    assert.ok(
      res.findings.auth.frameworks.some((f) => f.type === "Capability"),
      "django surfaces as a capability",
    );
    // No lockfile / audit evidence / secrets => the signal must not be high.
    assert.equal(res.signal, "low");
  });
});

test("F-030: specific auth/validation subsystems still lift the signal", async () => {
  await withFixture("f030-flask", fixture(["flask-login", "pydantic"]), async (dir) => {
    const res = await scan(dir, {});
    assert.equal(res.findings.auth.detected, true, "flask-login is verified auth");
    assert.equal(res.findings.inputValidation.detected, true, "pydantic is verified validation");
    assert.equal(res.signal, "high");
  });
});
