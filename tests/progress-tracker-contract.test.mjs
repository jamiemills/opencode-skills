import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(join(root, "bootstrap", "skill-manifest.json"), "utf8"));

function outsideFenceLines(content) {
  let fenced = false;
  return content.split(/\r?\n/).map((line) => {
    if (/^\s*```/.test(line)) {
      const wasFenced = fenced;
      fenced = !fenced;
      return { line, fenced: wasFenced };
    }
    return { line, fenced };
  });
}

function progressSection(content) {
  const lines = outsideFenceLines(content);
  const start = lines.findIndex(({ line, fenced }) => !fenced && line === "## Progress Tracker");
  assert.notEqual(start, -1, "Progress Tracker must be a real heading outside fences");
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (!lines[i].fenced && /^##\s/.test(lines[i].line)) {
      end = i;
      break;
    }
  }
  return lines
    .slice(start, end)
    .map(({ line }) => line)
    .join("\n");
}

function assertContract(section, skill) {
  assert.match(section, /Progress tracking is ON by default/);
  assert.match(section, /csm-progress\/1/);
  assert.match(section, /Declare 3[–-]6 milestones/);
  assert.match(section, /weights.*100%/s);
  assert.match(section, /completed_weight \+ active_weight × verified_fraction/);
  assert.match(section, /retries retain one logical item/i);
  assert.match(section, /TASK PROGRESS  not estimated/);
  assert.match(section, /Unknown.*cancelled.*blocked.*failed/s);
  assert.match(section, /scope.*reason.*weights/s);
  assert.match(section, /--quiet-progress.*only/s);
  assert.doesNotMatch(section, /progress tracker is OFF by default/i);
  if (skill === "csm-browse") {
    assert.match(section, /passwords.*cookie.*token/s);
    assert.match(section, /authorization headers/);
    assert.match(section, /--allow-sensitive.*not progress disclosure/s);
  }
  if (skill === "csm-upload") {
    assert.match(section, /credentials.*GitHub tokens/s);
    assert.match(section, /publication secrets/);
    assert.match(section, /cannot authorize or perform publication side effects/);
  }
}

test("manifest skills have default-on tracker contracts with root/payload parity", async () => {
  assert.equal(manifest.skills.length, 14);
  assert.equal(new Set(manifest.skills).size, manifest.skills.length);
  for (const skill of manifest.skills) {
    const rootSection = progressSection(await readFile(join(root, skill, "SKILL.md"), "utf8"));
    const payloadSection = progressSection(
      await readFile(
        join(root, "bootstrap", "package", "payload", "skills", skill, "SKILL.md"),
        "utf8",
      ),
    );
    assert.equal(payloadSection, rootSection, `${skill} root/payload tracker drift`);
    assertContract(rootSection, skill);
    const milestoneRow = rootSection.split("\n").find((line) => line.startsWith("["));
    const weights = [...(milestoneRow ?? "").matchAll(/\b\d+%/g)].map((match) =>
      Number.parseInt(match[0], 10),
    );
    assert.ok(weights.length >= 4, `${skill} has no explicit milestone weights`);
    assert.equal(
      weights.slice(0, 4).reduce((sum, value) => sum + value, 0),
      100,
    );
  }
});
