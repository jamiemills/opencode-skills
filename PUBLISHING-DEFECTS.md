# skills.sh publishing — defects to fix before the build

- Date: 2026-09-13
- Repo: `jamiemills/opencode-skills` (this working tree)
- Purpose: the source-repo defects that must be corrected before the generated
  skills.sh publish repo is built. These were found by the csm-deep-research
  runs on skills.sh publishing.
- Evidence: `.agents/research/2026-09-13-skills-sh-publishing-20260913t204500z-skills-sh-publish-research.json`
  and `.agents/research/2026-09-13-skills-sh-publish-adversarial-20260913t224500z-skills-sh-adversarial-research.json`

---

## D1 — `csm-plan` has invalid YAML frontmatter (skill is silently dropped)

**Symptom.** The skills CLI skips the skill entirely:

```
Skipped .../csm-plan/SKILL.md — YAML parse error:
Nested mappings are not allowed in compact mappings at line 2, column 14
```

**Cause.** The unquoted `description` scalar contains a colon followed by a space:

```yaml
---
name: csm-plan
description: CSM planning only: research, critique, verify a plan; never implement. Biases towards retrieval from current documentation over pre-trained knowledge.
---
```

YAML reads `CSM planning only: research, ...` as a nested mapping, so the whole
file fails to parse.

**Location.**

- Source: `csm-plan/SKILL.md` (the `description:` line)
- Generated twin: `bootstrap/package/payload/skills/csm-plan/SKILL.md` (same defect)

**Impact.**

- Only 13 of 14 skills are discoverable/installable via `npx skills add`.
- The same parse failure affects the live OpenCode install of `csm-plan`.

**Fix.** Quote the scalar (or remove the `: `):

```yaml
description: "CSM planning only: research, critique, verify a plan; never implement. Biases towards retrieval from current documentation over pre-trained knowledge."
```

**Verification.**

- Parse every `SKILL.md` frontmatter with a YAML parser; only `csm-plan` should have failed.
- `npx skills add ./. --list` should report **14** skills.

---

## D2 — Hardcoded absolute skill paths

**Symptom.** Several skills hardcode the OpenCode global install path
`$HOME/.config/opencode/skills/...`, which does not exist for other agents
(`.agents/skills/`, `~/.claude/skills/`, project scope, etc.).

**Locations (source).**

- `csm-browse/SKILL.md` — e.g. lines 58, 73, 81, 87, 95, 127–136, 156
  (`node $HOME/.config/opencode/skills/csm-browse/scripts/browse.mjs …`)
- `csm-upload/SKILL.md` — lines 72, 75, 85, 91, 101, 104
- `csm-deep-research/SKILL.md` — line 439 (`SKILL=$HOME/.config/opencode/skills/csm-browse`)
- Generated twins under `bootstrap/package/payload/skills/...` carry the same strings.

**Fix.** Replace with skill-root-relative paths (the Agent Skills spec recommends
relative references from the skill root). Decide the canonical form per skill and
apply it consistently in source; the payload copies are regenerated.

**Verification.** `grep -rn '\$HOME/\.config/opencode/skills' csm-*/SKILL.md` returns nothing.

---

## D3 — Runtime dependencies are not declared/available at install time

**Symptom.** Installed skills import packages that the skills CLI does not
install.

**Findings.**

- `lib/schema-runtime/index.mjs` imports `ajv/dist/2020.js` and `ajv-formats`,
  but both are declared only under root `devDependencies` in `package.json`.
- `csm-browse/package.json` declares `chrome-remote-interface` (dependency) and
  `ws` (devDependency only); `csm-browse` also expects `pnpm install`.
- The skills CLI does not run any package install; it copies files only.

**Fix options (choose for the publish build).**

- Make the publish build inline/bundle these dependencies (planned: esbuild),
  **and/or** declare runtime deps correctly in source.
- Note: the publish build must vendor `ajv`, `ajv-formats`, and
  `chrome-remote-interface`. Do **not** vendor `jimp` (not a dependency) or `ws`
  (test-only).

**Verification.** Install one skill into a temp project and run it; no
`ERR_MODULE_NOT_FOUND` and no missing-package error.

---

## D4 — Regeneration gate after any `SKILL.md` / mapping change

Any edit to a `SKILL.md` or to the pack mapping requires regenerating the
distribution artifacts or the repo gate fails:

- Payload + index: `node scripts/pack-bootstrap.mjs`
- Capabilities digest: `node scripts/gen-capabilities.mjs`
- Then: `make check`

Gate checks that fail on drift:

- `checkPayloadDrift` (`scripts/check-suite.mjs`, forward/reverse payload comparison)
- `checkCommittedPayloadIndex` (`bootstrap/payload-index.json` digests)
- `checkCapabilityManifestFreshness` (`csm-orchestrate/capabilities.json`, `csm-plan` entry)

There is no Make target for regeneration; run the two scripts directly, and
`make install` first so `oxfmt` / `npm pack` are available.

---

## D5 — Context: why a per-skill install of the current layout breaks (informational)

The skills CLI copies **only the selected skill directory**. The suite's skills
depend upward on:

- a shared repo-root `lib/` (10 modules: `artifact-resolver`, `consumer-adapters`,
  `digest-taxonomy`, `durable-json`, `progress-tracker`, `publication`,
  `render-html`, `render-markdown`, `render-model`, `schema-runtime`), and
- cross-skill `../../csm-*/` imports.

This is why the publish plan produces **self-contained, esbuild-bundled skills**
in a dedicated repo rather than listing the current tree as-is. This file covers
the source-repo defects only; the bundling/self-containment work is the publish
pipeline's job.

---

## Fix checklist

- [ ] D1 `csm-plan` description quoted (source); payload regenerated.
- [ ] D2 `$HOME/.config/opencode/skills` references replaced with relative paths (csm-browse, csm-upload, csm-deep-research).
- [ ] D3 runtime deps declared in source (bundle handled by the publish build).
- [ ] D4 `node scripts/pack-bootstrap.mjs` + `node scripts/gen-capabilities.mjs` + `make check` green.
- [ ] `npx skills add ./. --list` shows 14 skills (local-path check; it does not seed skills.sh listing).
