"use strict";

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRegisteredProvider, hash as hashRegistered } from "../lib/providers/registered.mjs";
import {
  createTrustedLocalProvider,
  hash as hashTrusted,
} from "../lib/providers/trusted-local.mjs";

const digest = (value) => hashRegistered(value);
const approval = { status: "approved", approver: "test-owner", reason: "synthetic fixture" };
const limits = { timeoutMs: 1000, maxOutputBytes: 10000 };
const request = (sourceHash, patchHash = digest("patch")) => ({
  format: "csm-autoresearch-evaluator-request/1",
  requestId: "request",
  runId: "run",
  candidate: { id: "target", parentId: null, sourceHash, patchHash },
  limits: { ...limits, network: "disabled" },
  input: { value: 3 },
});

test("registered provider requires exact identity and source hash", async () => {
  const sourceHash = digest("registered");
  const provider = createRegisteredProvider({
    registry: { target: { sourceHash, callable: (input) => ({ score: input.value }) } },
    evaluatorHash: digest("evaluator"),
    environmentHash: digest("environment"),
    limits,
    approval,
  });
  assert.deepEqual((await provider.evaluate(request(sourceHash))).metrics, { score: 3 });
  assert.equal(
    (await provider.evaluate(request(sourceHash))).provenance.limits.trust,
    "registered-in-process",
  );
  assert.equal((await provider.evaluate(request(digest("wrong")))).status, "policy_violation");
  assert.throws(
    () =>
      createRegisteredProvider({
        registry: {},
        evaluatorHash: digest("e"),
        environmentHash: digest("e"),
        limits,
      }),
    /approval/,
  );
});

test("trusted-local pins source, region, allowlist, and explicit environment", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-provider-"));
  const source = join(root, "trusted-source.mjs");
  const sourceBytes = await readFile(new URL("./fixtures/trusted-source.mjs", import.meta.url));
  await writeFile(source, sourceBytes);
  const sourceHash = hashTrusted(sourceBytes);
  const patchHash = hashTrusted(`src\n${"src"}`);
  const provider = await createTrustedLocalProvider({
    sourcePath: source,
    sourceHash,
    workspace: root,
    evolutionRegion: "src",
    mutationAllowlist: ["src"],
    env: { VISIBLE: "yes", HIDDEN: "no" },
    envAllowlist: ["VISIBLE"],
    evaluatorHash: digest("evaluator"),
    environmentHash: digest("environment"),
    limits,
    approval,
  });
  assert.deepEqual((await provider.evaluate(request(sourceHash, patchHash))).metrics, { score: 6 });
  assert.deepEqual(provider.envAllowlist, ["VISIBLE"]);
});

test("trusted-local rejects traversal, symlinks, protected paths, and unapproved metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-provider-"));
  const source = join(root, "source.mjs");
  await writeFile(source, "export default () => ({score: 1});");
  const common = {
    sourcePath: source,
    sourceHash: hashTrusted(await readFile(source)),
    workspace: root,
    evolutionRegion: "src",
    mutationAllowlist: ["src"],
    envAllowlist: [],
    evaluatorHash: digest("e"),
    environmentHash: digest("env"),
    limits,
  };
  await assert.rejects(
    () => createTrustedLocalProvider({ ...common, approval, evolutionRegion: "../src" }),
    /outside/,
  );
  await assert.rejects(
    () => createTrustedLocalProvider({ ...common, approval: undefined }),
    /approval/,
  );
  const link = join(root, "link.mjs");
  await symlink(source, link);
  await assert.rejects(
    () => createTrustedLocalProvider({ ...common, sourcePath: link, approval }),
    /symlink/,
  );
  await assert.rejects(
    () => createTrustedLocalProvider({ ...common, approval, mutationAllowlist: ["tests/output"] }),
    /outside/,
  );
  await mkdir(join(root, "tests"));
  const protectedSource = join(root, "tests", "source.mjs");
  await writeFile(protectedSource, "export default () => ({score: 1});");
  const protectedHash = hashTrusted(await readFile(protectedSource));
  await assert.rejects(
    () =>
      createTrustedLocalProvider({
        ...common,
        sourcePath: protectedSource,
        sourceHash: protectedHash,
        approval,
      }),
    /outside/,
  );
});

test("trusted-local evaluates a snapshot and never removes the caller workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-provider-snapshot-"));
  const source = join(root, "source.mjs");
  const sourceText =
    "import { writeFileSync } from 'node:fs'; export default () => { writeFileSync('trial-only', 'x'); return { score: 2 }; };";
  await writeFile(source, sourceText);
  const sourceHash = hashTrusted(sourceText);
  const provider = await createTrustedLocalProvider({
    sourcePath: source,
    sourceHash,
    workspace: root,
    evolutionRegion: "src",
    mutationAllowlist: ["src"],
    envAllowlist: [],
    evaluatorHash: digest("e"),
    environmentHash: digest("env"),
    limits: { timeoutMs: 1000, maxOutputBytes: 10000 },
    approval,
  });
  assert.equal(
    (await provider.evaluate(request(sourceHash, hashTrusted("src\nsrc")))).status,
    "ok",
  );
  await assert.rejects(() => readFile(join(root, "trial-only")), /ENOENT/);
  assert.equal(await readFile(source, "utf8"), sourceText);
});

test("trusted-local rejects resource policies it cannot enforce", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-provider-limits-"));
  const source = join(root, "source.mjs");
  await writeFile(source, "export default () => ({score: 1});");
  const common = {
    sourcePath: source,
    sourceHash: hashTrusted(await readFile(source)),
    workspace: root,
    evolutionRegion: "src",
    mutationAllowlist: ["src"],
    envAllowlist: [],
    evaluatorHash: digest("e"),
    environmentHash: digest("env"),
    approval,
  };
  await assert.rejects(
    () =>
      createTrustedLocalProvider({
        ...common,
        limits: { timeoutMs: 1000, maxOutputBytes: 1000, network: "disabled" },
      }),
    /cannot enforce/,
  );
  await assert.rejects(
    () =>
      createTrustedLocalProvider({
        ...common,
        limits: { timeoutMs: 1000, maxOutputBytes: 1000, maxMemoryMb: 32 },
      }),
    /cannot enforce/,
  );
});
