# Cache Maximization And Token Efficiency — 2026-08-20

Reference for the cache/token-efficiency layer of this repository: how
DeepSeek's automatic prefix caching is exploited here, what was measured on
this machine, the (docs-only) recommended opencode.jsonc block, the monitor,
and the per-repo/per-directory toggle semantics.

- Date: 2026-08-20
- Plan: `.agents/plans/2026-08-20-cache-token-efficiency-csm.md`
- Scope: guidance layer (T004) — lint gate (T001), monitor (T002), and
  csm-build prefix-sharing rule (T003) are covered by their own tasks.
- Companion: `AGENTS.md` at the repo root (concise rules); this doc is the full
  reference.

## DeepSeek caching mechanics

DeepSeek's context caching is **automatic and on by default** (no
`cache_control`-style knob exists — api-docs.deepseek.com/guides/kv_cache,
retrieved 2026-08-20):

- A hit requires **full match of a persisted prefix unit** — the request prefix
  must match a unit DeepSeek persisted. Persistence is request-boundary,
  common-prefix, and fixed-token-interval based.
- Cache lifetime is **hours to days**; repeated sessions with stable prefixes
  keep hitting.
- The API exposes `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`.
- Pricing (api-docs.deepseek.com/quick_start/pricing): deepseek-v4-flash input
  cache HIT $0.007/M off-peak vs MISS $0.22/M — a **~97% discount** on hits;
  output $0.66/M (3x input).

**Pricing-basis caveat.** DeepSeek docs quote $0.007/$0.22/$0.66; models.dev
quotes $0.0028/$0.14/$0.28 — up to a 2x divergence. `opencode stats` computes
cost from the models.dev-based table; the monitor (`scripts/cache-health.mjs`)
uses the **DB cost column** (per-message, authoritative — decision A5), never a
recomputed pricing table.

## Measured hit ratios on this machine

Live DB (via `opencode db`, 2026-08-20; R3 research + monitor runs):

- 984 sessions total, 340 deepseek-v4-flash; 364 sessions in the 30-day window.
- General-agent sessions: 75.4–99.9% cache read (samples: lucky-eagle 99.12%,
  sunny-cactus 92.84%, quick-tiger 91.48%, lucky-falcon 90.30%, quiet-eagle
  89.20%, swift-planet 88.41%).
- Build-agent session misty-otter: 82.46%.
- Per-day aggregates in the 30-day window: 97.3–99.3%.
- Cache write is 0 for deepseek in 100% of records; hit ratio formula =
  `cache.read / (cache.read + input + cache.write)` with zero-denominator rows
  skipped.

## Recommended opencode.jsonc block — DOCS ONLY (not applied)

Per user decision (A4), the live config is NOT edited; this is a documented
recommendation only. Keys per the opencode config schema and docs
(https://opencode.ai/config.json, /docs/config, /docs/models, 2026-08-20):

```jsonc
{
  "compaction": { "auto": true, "prune": true, "reserved": 10000 },
  "small_model": "deepseek-v4-flash",
  "provider": {
    "deepseek": {
      "models": {
        "deepseek-v4-flash": {
          "limit": { "output": 8192 }
        }
      }
    }
  },
  "agent": {
    "build": { "steps": 40 },
    "plan": { "steps": 20 }
  }
}
```

Rationale:

- **`compaction {auto, prune, reserved}`** — auto compaction keeps contexts
  bounded; `prune` drops stale/summarized turns instead of replaying them;
  `reserved: 10000` keeps a working tail. Bounded, recall-first contexts beat
  bloated ones (A7); never compact away durable rules that live in files.
- **`small_model`** — session title generation currently uses the main model
  (`small=true` in session logs); `small_model` is the documented lever to
  offload it to a cheaper model for that overhead.
- **`provider.deepseek.models["deepseek-v4-flash"].limit.output`** — caps output
  tokens per request; output is 3x input price, so bounding it limits the most
  expensive segment.
- **`agent.<name>.steps`** — caps per-agent step loops, bounding runaway
  multi-step spirals and their token cost.

**Deferred: DeepSeek thinking/effort knob.** A DeepSeek thinking/effort control
is NOT documented in opencode's schema. Passthrough of provider options is
plausible (opencode passes `options` through per-provider) but **unverified** —
enable only after a live experiment confirms the knob is honored; until then it
is recorded as deferred, not applied.

## Monitor usage

```bash
node scripts/cache-health.mjs [--days N]
```

- Zero-dependency, read-only: queries the live opencode DB via the bundled
  `opencode db` CLI (no DB copies, no writes, no `node:sqlite`).
- Reports per-session and per-day cache hit ratio and cost for
  deepseek-v4-flash; `--days N` filters on `time_created`.
- Honours the toggle: when disabled for the working directory it prints the
  notice and exits 0 without touching the DB.

## Per-repo / per-directory toggle

`.agents/token-efficiency.json` switches the repo-local efficiency layer per
repo or per directory (decision A9).

- **File format.** A single JSON object, e.g. `{"enabled": false}` disables;
  `{"enabled": true}` enables.
- **OFF by default (fail-open).** Absent file, `{"enabled": false}`, or a
  malformed/non-boolean file all resolve to DISABLED — the efficiency layer
  never silently engages. Only an explicit `{"enabled": true}` enables. A
  malformed file surfaces a visible warning. This repo commits
  `{"enabled": false}` so the choice is explicit and discoverable.
- **Nearest-wins walk-up.** Resolution walks up from the working directory to
  the nearest git root (a `.git` ancestor; falls back to the filesystem root
  outside any repo), checking `<dir>/.agents/token-efficiency.json` at each
  level. A nested subdirectory toggle overrides its parent repo's; a subdir
  without a toggle inherits the parent's resolution.
- **Gated vs global.** Gated (repo-local, switch with the toggle): the
  check-suite volatile/budget lint (T001), the cache-health monitor (T002), and
  the AGENTS.md rules (T004). NOT gated (global): csm-build's prefix-sharing
  rule (skill-level provider economics — applies in every repo) and the
  docs-only opencode.jsonc recommendation (global config guidance).
- **Disabled example** (drop into a subdir to switch that subtree off):

  ```json
  {"enabled": false}
  ```
