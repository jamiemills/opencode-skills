"use strict";

// Canonical pre-commit shim normalization shared by scripts/install-hooks.mjs
// and its hermetic unit tests. This module must stay side-effect free: it is
// imported by tests that never run pnpm install or lefthook.
//
// The committed scripts/hooks/pre-commit shim is produced by
// `lefthook install --force` followed by normalizeHookShim: lefthook embeds
// the local pnpm-store absolute path (user home + version-pinned layout), and
// the committed copy must stay portable. On top of that machine-specific
// stripping, the shim resolves .lefthook.yml from the COMMITTING CHECKOUT
// top-level (git rev-parse --show-toplevel) so every worktree honors its own
// config (S7 per-worktree hook config).

export const SHIM_MARKER = "# csm per-checkout lefthook config resolution (S7 worktree support)";

const PER_CHECKOUT_BLOCK = [
  SHIM_MARKER,
  'if [ -z "$LEFTHOOK_CONFIG" ]; then',
  '  shim_root="$(git rev-parse --show-toplevel 2>/dev/null)"',
  '  if test -n "$shim_root" && test -f "$shim_root/.lefthook.yml"; then',
  '    export LEFTHOOK_CONFIG="$shim_root/.lefthook.yml"',
  "  fi",
  "fi",
];

// Removes the lefthook-generated elif arm that pins the local pnpm-store
// binary path (condition line + its `then` + the exec body line) so the
// generated shell stays valid and machine-portable.
function stripMachineSpecificArm(lines) {
  const kept = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes("/.pnpm/lefthook-")) {
      let removed = 1;
      i += 1;
      while (i < lines.length && removed < 3) {
        const t = lines[i].trim();
        if (t === "then" || t.endsWith('lefthook "$@"')) {
          removed += 1;
          i += 1;
        } else break;
      }
      i -= 1;
      continue;
    }
    kept.push(lines[i]);
  }
  return kept;
}

// Injects (once) the per-checkout config-resolution block ahead of the
// call_lefthook definition. Idempotent: a second pass recognizes the marker
// comment and leaves the shim byte-identical.
function injectPerCheckoutResolution(lines) {
  if (lines.some((line) => line.trim() === SHIM_MARKER)) return lines;
  const anchor = lines.findIndex((line) => line.startsWith("call_lefthook()"));
  if (anchor === -1) return lines;
  const next = [...lines];
  next.splice(anchor, 0, ...PER_CHECKOUT_BLOCK, "");
  return next;
}

export function normalizeHookShim(source) {
  const lines = stripMachineSpecificArm(source.split("\n"));
  return injectPerCheckoutResolution(lines).join("\n");
}
