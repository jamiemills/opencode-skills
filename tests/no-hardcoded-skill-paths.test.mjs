import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function skillDocs(base) {
  return readdirSync(resolve(ROOT, base), { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("csm-"))
    .map((d) => `${base}/${d.name}/SKILL.md`)
    .filter((rel) => {
      try {
        readFileSync(resolve(ROOT, rel));
        return true;
      } catch {
        return false;
      }
    });
}

test("no SKILL.md hardcodes the OpenCode install prefix", () => {
  const files = [...skillDocs("."), ...skillDocs("bootstrap/package/payload/skills")];
  assert.ok(files.length >= 14, `expected the skill corpus, saw ${files.length}`);
  for (const rel of files) {
    const text = readFileSync(resolve(ROOT, rel), "utf8");
    assert.ok(
      !text.includes("$HOME/.config/opencode/skills"),
      `${rel} hardcodes the install prefix`,
    );
  }
});

test("every doc that uses CSM_SKILLS_DIR also documents it", () => {
  const files = [...skillDocs("."), ...skillDocs("bootstrap/package/payload/skills")];
  let using = 0;
  for (const rel of files) {
    const text = readFileSync(resolve(ROOT, rel), "utf8");
    if (!text.includes("${CSM_SKILLS_DIR}")) continue;
    using += 1;
    assert.match(text, /\*\*Paths:\*\*/, `${rel} uses CSM_SKILLS_DIR without documenting it`);
  }
  assert.ok(using >= 3, `expected at least 3 docs using CSM_SKILLS_DIR, saw ${using}`);
});
