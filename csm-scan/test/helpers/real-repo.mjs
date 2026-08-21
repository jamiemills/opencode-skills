// T010 (F-007) — portable real-repository resolution for the csm-scan suite.
//
// Contract:
//   - `CSM_SCAN_REAL_REPO` set to an existing path  -> run real-repo tests
//     against that repository. Scale-specific expectations apply ONLY when
//     the repo is identified as pxcli (`isPerplexityCli`); for any other
//     repository they are scaled to the fallback fixture's size — never
//     silently weakened, always branched visibly on that check.
//   - `CSM_SCAN_REAL_REPO` set to a missing path    -> `repo: null` plus the
//     missing path. Named AC20 gate callers (golden, voice-gate) fall back to
//     the checked-in fixture with a warning instead of skipping — the
//     behavioral no-skip gate bans runtime skips in those files. Other callers
//     may still skip visibly with this reason; never a vacuous pass.
//   - `CSM_SCAN_REAL_REPO` unset or empty           -> run the same tests
//     against the checked-in fallback fixture below, with expectations scaled
//     to that fixture where the assertion is intrinsically about the real
//     repository's scale (see `isPerplexityCli`).
//
// The fallback fixture is a miniature of the pxcli repository layout, sized so
// every scanner assertion still exercises a real behavioral path.

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FALLBACK_REAL_REPO = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures-real",
  "pxcli-mini",
);

export function resolveRealRepo() {
  const configured = process.env.CSM_SCAN_REAL_REPO;
  if (configured !== undefined && configured !== "") {
    if (!existsSync(configured)) {
      return { repo: null, missing: configured };
    }
    return { repo: configured, missing: null, usingFallback: false };
  }
  return { repo: FALLBACK_REAL_REPO, missing: null, usingFallback: true };
}

// The real repository is identified by its directory name (or by declaring
// itself as the pxcli project); the fallback fixture intentionally shares the
// pxcli layout under a different directory name so scale-specific expectations
// can branch visibly instead of silently weakening.
export function isPerplexityCli(repoPath) {
  if (basename(repoPath) === "perplexity-cli") return true;
  if (resolve(repoPath) === resolve(FALLBACK_REAL_REPO)) return false;
  try {
    const pyproject = readFileSync(join(repoPath, "pyproject.toml"), "utf8");
    return /^name = "pxcli"\s*$/m.test(pyproject);
  } catch {
    return false;
  }
}

// Number of test files the fallback fixture presents under the disclosed b14
// counting rule (tests/test_*.py + tests/**/test_*.py + conftest.py): three
// test modules plus conftest.py.
export const FALLBACK_TEST_FILE_COUNT = 4;
