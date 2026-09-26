import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateEgress } from "../csm-orchestrate/lib/egress-broker.mjs";

const policy = {
  defaultAction: "deny",
  failMode: "blocked",
  entries: [{ host: "api.example.com", port: 443, scheme: "https", pathPrefix: "/allowed" }],
  credentialInjections: [],
};

const decide = (path) =>
  evaluateEgress(policy, {
    host: "api.example.com",
    port: 443,
    scheme: "https",
    path,
  }).decision;

test("clean paths inside the allowed prefix are allowed", () => {
  assert.equal(decide("/allowed/ok"), "allowed");
  assert.equal(decide("/allowed/sub/deep"), "allowed");
  assert.equal(decide("/allowed"), "allowed");
  assert.equal(decide("/allowed/100%25"), "allowed");
});

test("dot-segment traversal is denied in every encoding", () => {
  assert.equal(decide("/allowed/%2e%2e/admin"), "denied");
  assert.equal(decide("/allowed/%252e%252e/admin"), "denied");
  assert.equal(decide("/allowed/%25252e%25252e/admin"), "denied");
  assert.equal(decide("/allowed/../admin"), "denied");
});

test("encoded and raw separator traversal is denied", () => {
  assert.equal(decide("/allowed/..%5cadmin"), "denied");
  assert.equal(decide("/allowed/..\\admin"), "denied");
  assert.equal(decide("/allowed/%2e%2e%5cadmin"), "denied");
  assert.equal(decide("/allowed/..;/admin"), "denied");
});

test("NUL, trailing-dot, and fullwidth-dot traversal is denied", () => {
  assert.equal(decide("/allowed/..%00/admin"), "denied");
  assert.equal(decide("/allowed/.../admin"), "denied");
  assert.equal(decide("/allowed/．．/admin"), "denied");
  assert.equal(decide("/allowed/%ef%bc%8e%ef%bc%8e/admin"), "denied");
});

test("a path outside the prefix is denied even when clean", () => {
  assert.equal(decide("/forbidden/ok"), "denied");
});

test("an unresolvable or control-character path is denied", () => {
  assert.equal(decide("/allowed/%E0%A4%A"), "denied");
  assert.equal(decide("/allowed/%00/admin"), "denied");
});
