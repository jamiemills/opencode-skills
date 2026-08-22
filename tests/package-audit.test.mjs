import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { packBootstrap } from "../scripts/pack-bootstrap.mjs";

const execFileAsync = promisify(execFile);
const skillNames = [
  "csm-bdd-tdd",
  "csm-browse",
  "csm-build",
  "csm-deep-research",
  "csm-grill",
  "csm-make-tests",
  "csm-plan",
  "csm-review-python",
  "csm-review",
  "csm-scan",
  "csm-upload",
];
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const parseFrontmatter = (text) => {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const fields = {};
  if (!match) return fields;
  for (const line of match[1].split("\n")) {
    const pair = /^([a-z-]+):\s*(.*)$/.exec(line);
    if (pair) fields[pair[1]] = pair[2];
  }
  return fields;
};

const filesOf = (result) =>
  result.entries
    .filter((entry) => entry.type === "0" || entry.type === "\0")
    .map((entry) => entry.name)
    .toSorted();

// F-068 integration tier: this suite spawns real tar/npm/npx against a packed
// artifact and is environment-sensitive by design (npm-cache behavior, npx
// resolution). It runs only on the pinned node >=22 toolchain — see the floor
// test below; a machine with an older default node must invoke it via
// scripts/with-node22.mjs.
test("integration tier: pinned toolchain floor — node >= 22", () => {
  const major = Number(process.versions.node.split(".")[0]);
  assert.ok(
    major >= 22,
    `this integration suite requires node >= 22 (got ${process.versions.node})`,
  );
});

test("two isolated packs are deterministic and the packed artifact passes the audit", async () => {
  const dirs = [];
  try {
    const first = await packBootstrap();
    const second = await packBootstrap();
    dirs.push(first.dir, second.dir);
    const firstBytes = await readFile(first.tarball);
    const secondBytes = await readFile(second.tarball);
    assert.equal(sha256(firstBytes), sha256(secondBytes));
    assert.equal(Buffer.compare(firstBytes, secondBytes), 0);

    assert.deepEqual(filesOf(first), filesOf(second));
    const names = filesOf(first);
    assert.ok(names.length >= 100);
    for (const name of names) {
      assert.ok(!/(^|\/)\.git(\/|$)/.test(name), name);
      assert.ok(!/(^|\/)\.agents(\/|$)/.test(name), name);
      assert.ok(!/(^|\/)node_modules(\/|$)/.test(name), name);
      assert.ok(!/(^|\/)tests?(\/|$)/.test(name), name);
      assert.ok(!/(^|\/)fixtures(\/|$)/.test(name), name);
    }
    for (const entry of first.entries) {
      assert.ok(
        entry.type === "0" || entry.type === "\0" || entry.type === "5",
        `unexpected tar type for ${entry.name}: ${entry.type}`,
      );
    }

    const auditDir = await mkdtemp("/tmp/csm-audit-");
    dirs.push(auditDir);
    await execFileAsync("tar", ["-xf", first.tarball, "-C", auditDir]);
    const pkg = JSON.parse(await readFile(join(auditDir, "package", "package.json"), "utf8"));
    assert.equal(pkg.name, "@jamiemills/csm-skills-bootstrap");
    assert.equal(pkg.version, "0.1.0");
    assert.deepEqual(pkg.bin, { "csm-skills-bootstrap": "bin/csm-skills-bootstrap.js" });
    assert.equal(Object.keys(pkg.bin).length, 1);
    assert.equal(pkg.private, undefined);
    assert.equal(pkg.scripts, undefined);
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.devDependencies, undefined);
    assert.equal(pkg.peerDependencies, undefined);
    assert.equal(pkg.optionalDependencies, undefined);
    assert.equal(pkg.license, "MIT");
    assert.deepEqual(pkg.files, ["bin", "payload", "payload-index.json", "LICENSE"]);

    const binEntry = first.entries.find(
      (entry) => entry.name === "package/bin/csm-skills-bootstrap.js",
    );
    assert.ok(binEntry, "bin missing from tarball");
    assert.equal(binEntry.mode & 0o777, 0o755);

    const index = JSON.parse(
      await readFile(join(auditDir, "package", "payload-index.json"), "utf8"),
    );
    assert.equal(index.schema, "csm-payload-index/1");
    assert.equal(index.package.name, "@jamiemills/csm-skills-bootstrap");
    assert.equal(index.package.version, "0.1.0");
    assert.equal(index.package.bin, "csm-skills-bootstrap");
    assert.deepEqual(index.classes.helperBins, []);
    const indexed = [
      ...index.classes.skills,
      ...index.classes.supportingFiles,
      ...index.classes.metadata,
      index.fixedBin,
    ];
    const tarFiles = new Set(names.map((name) => name.replace(/^package\//, "")));
    for (const entry of indexed) {
      assert.ok(tarFiles.has(entry.path), `indexed file missing from tarball: ${entry.path}`);
      const data = await readFile(join(auditDir, "package", entry.path));
      assert.equal(data.length, entry.bytes, entry.path);
      assert.equal(sha256(data), entry.sha256, entry.path);
    }
    for (const name of tarFiles) {
      if (name !== "package.json" && name !== "payload-index.json")
        assert.ok(
          indexed.some((entry) => entry.path === name),
          `tarball file not indexed: ${name}`,
        );
    }

    const skillEntries = index.classes.skills.filter((entry) => entry.path.endsWith("/SKILL.md"));
    assert.equal(skillEntries.length, 11);
    for (const skill of skillNames) {
      const entry = skillEntries.find(
        (candidate) => candidate.path === `payload/skills/${skill}/SKILL.md`,
      );
      assert.ok(entry, `missing SKILL.md for ${skill}`);
      const fields = parseFrontmatter(
        await readFile(join(auditDir, "package", entry.path), "utf8"),
      );
      assert.equal(fields.name, skill);
      assert.match(fields.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
      assert.ok(fields.name.length <= 64);
      assert.ok(
        fields.description && fields.description.length >= 1 && fields.description.length <= 1024,
      );
    }

    const cache = await mkdtemp("/tmp/csm-npx-cache-");
    dirs.push(cache);
    const version = await execFileAsync(
      "npx",
      [
        "--yes",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        `--package=file:${first.tarball}`,
        "csm-skills-bootstrap",
        "--version",
      ],
      { encoding: "utf8", env: { ...process.env, NPM_CONFIG_CACHE: cache } },
    );
    assert.equal(version.stdout.trim(), "0.1.0");
    const verify = await execFileAsync(
      "npx",
      [
        "--yes",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        `--package=file:${first.tarball}`,
        "csm-skills-bootstrap",
        "payload-index",
      ],
      { encoding: "utf8", env: { ...process.env, NPM_CONFIG_CACHE: cache } },
    );
    const verified = JSON.parse(verify.stdout);
    assert.equal(verified.verification.ok, true);
    assert.equal(verified.verification.failures.length, 0);
    assert.ok(verified.verification.verified >= 119);

    const tamperedDir = await mkdtemp("/tmp/csm-tamper-");
    dirs.push(tamperedDir);
    await execFileAsync("tar", ["-xf", first.tarball, "-C", tamperedDir]);
    const tamperedIndex = JSON.parse(
      await readFile(join(tamperedDir, "package", "payload-index.json"), "utf8"),
    );
    tamperedIndex.classes.skills[0].sha256 = "0".repeat(64);
    await writeFile(
      join(tamperedDir, "package", "payload-index.json"),
      `${JSON.stringify(tamperedIndex, null, 2)}\n`,
    );
    await execFileAsync("tar", [
      "-czf",
      join(tamperedDir, "tampered.tgz"),
      "-C",
      tamperedDir,
      "package",
    ]);
    const tamper = await execFileAsync(
      "npx",
      [
        "--yes",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        `--package=file:${join(tamperedDir, "tampered.tgz")}`,
        "csm-skills-bootstrap",
        "payload-index",
      ],
      { encoding: "utf8", env: { ...process.env, NPM_CONFIG_CACHE: cache } },
    )
      .then((out) => ({ stdout: out.stdout, code: 0 }))
      .catch((err) => ({ stdout: err.stdout || "", code: err.code }));
    assert.notEqual(tamper.code, 0, "tampered payload-index must exit non-zero");
    const tamperResult = JSON.parse(tamper.stdout);
    assert.equal(
      tamperResult.verification.ok,
      false,
      "tampered payload must report verification.ok === false",
    );
    assert.ok(
      tamperResult.verification.failures.some((f) => f.error === "HASH_MISMATCH"),
      JSON.stringify(tamperResult.verification.failures),
    );
  } finally {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  }
});
