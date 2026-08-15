# CSM Suite Performance Baseline

Date: 2026-08-15

## Environment

- Node: v20.20.2
- ripgrep: 14.1.0
- git: 2.43.0
- OS: linux (zsh shell)

All measurements taken inside an isolated sandbox at `/tmp/opencode/baseline-3584127/`
with `HOME`, `TMPDIR`, `XDG_CACHE_HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`,
`XDG_STATE_HOME` redirected into sandbox subdirs and no network.

## Method

### 1. Full-suite baseline (csm-scan authoritative gate)

```
git clone --depth 1 file:///home/jamiemills/.config/opencode/skills <sandbox>/repo
cd <sandbox>/repo/csm-scan
env -i PATH="$PATH" HOME=<sandbox>/home TMPDIR=<sandbox>/tmp \
  XDG_CACHE_HOME=<sandbox>/cache XDG_CONFIG_HOME=<sandbox>/config \
  XDG_DATA_HOME=<sandbox>/data XDG_STATE_HOME=<sandbox>/state \
  node --test --test-concurrency=1
```

### 2. CLI latency (csm-scan scan.mjs)

First attempt scanned the skills-repo clone itself; the privacy gate aborted
(`PipelineError: Pipeline failed: scanner findings contain prohibited sensitive data`).
Per task policy, the fallback repo `/home/jamiemills/code/projects/perplexity-cli`
was scanned read-only (no working-tree writes; output written to the sandbox):

```
cd <sandbox>/repo/csm-scan
env -i PATH="$PATH" HOME=<sandbox>/home TMPDIR=<sandbox>/tmp \
  XDG_CACHE_HOME=<sandbox>/cache XDG_CONFIG_HOME=<sandbox>/config \
  XDG_DATA_HOME=<sandbox>/data XDG_STATE_HOME=<sandbox>/state \
  node scripts/scan.mjs --repos /home/jamiemills/code/projects/perplexity-cli \
  --out <sandbox>/out/NORMS.md
```

### 3. E2E duration (csm-browse/tests/e2e.mjs)

Not run today — requires Docker (chromium-vnc container) and writes outside the repo.
Source change only (see Recording below). Last known result: 59/59 pass in quick
mode (2026-08-02); duration today recorded as unverified.

## Results

### Full-suite gate

- `# tests 1209`
- `# pass 1209`
- `# fail 0`
- wall time: 2:11.85 (131.8s; suite-reported `duration_ms 131755.729`)

### CLI latency

- repo scanned: perplexity-cli (fallback; skills repo itself fails the privacy gate)
- wall time: 0:07.05 (7.05s)
- output size: 105146 bytes, 1916 lines (`<sandbox>/out/NORMS.md`)

### E2E status

- Last known: 59/59 pass, quick mode, 2026-08-02
- Duration today: unverified (suite not run; requires Docker + out-of-repo writes)

## Recording discipline

Pass count + wall time are to be recorded at every gate run (see the
`Testing` section of `csm-scan/SKILL.md`).

Baseline reference: the authoritative gate is expected to hold at `>=1209 pass`,
~100-170s wall. Any deviation should be investigated before proceeding.
