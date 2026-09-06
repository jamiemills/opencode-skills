import assert from "node:assert/strict";
import test from "node:test";

import { SHIM_MARKER, normalizeHookShim } from "../../lib/hook-shim.mjs";

// Fresh lefthook 2.x generated shim shape (lefthook install --force output
// before install-hooks normalization): carries the machine-specific pnpm-store
// elif arm and no per-checkout config resolution.
const GENERATED = `#!/bin/sh

if [ "$LEFTHOOK_VERBOSE" = "1" -o "$LEFTHOOK_VERBOSE" = "true" ]; then
  set -x
fi

if [ "$LEFTHOOK" = "0" ]; then
  exit 0
fi

call_lefthook()
{
  if test -n "$LEFTHOOK_BIN"
  then
    "$LEFTHOOK_BIN" "$@"
  elif lefthook -h >/dev/null 2>&1
  then
    lefthook "$@"
  elif /home/user/repo/node_modules/.pnpm/lefthook-linux-x64@2.1.10/node_modules/lefthook-linux-x64/bin/lefthook -h >/dev/null 2>&1
  then
    /home/user/repo/node_modules/.pnpm/lefthook-linux-x64@2.1.10/node_modules/lefthook-linux-x64/bin/lefthook "$@"
  else
    dir="$(git rev-parse --show-toplevel)"
    osArch=$(uname | tr '[:upper:]' '[:lower:]')
    cpuArch=$(uname -m | sed 's/aarch64/arm64/;s/x86_64/x64/')
    if test -f "$dir/node_modules/lefthook-\${osArch}-\${cpuArch}/bin/lefthook"
    then
      "$dir/node_modules/lefthook-\${osArch}-\${cpuArch}/bin/lefthook" "$@"
    else
      echo "Can't find lefthook in PATH"
      exit 1
    fi
  fi
}

call_lefthook run "pre-commit" "$@"
`;

test("normalization strips the machine-specific pnpm-store arm", () => {
  const out = normalizeHookShim(GENERATED);
  assert.doesNotMatch(out, /\.pnpm\/lefthook-/, "pnpm-store path removed");
  assert.match(out, /elif lefthook -h >\/dev\/null 2>&1/, "generic elif retained");
  assert.match(out, /else\n\s+echo "Can't find lefthook in PATH"/, "else fallback intact");
});

test("normalization injects per-checkout LEFTHOOK_CONFIG resolution from --show-toplevel", () => {
  const out = normalizeHookShim(GENERATED);
  assert.match(out, new RegExp(SHIM_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(
    out,
    /if \[ -z "\$LEFTHOOK_CONFIG" \]; then\n\s+shim_root="\$\(git rev-parse --show-toplevel 2>\/dev\/null\)"/,
  );
  assert.match(out, /test -f "\$shim_root\/\.lefthook\.yml"/);
  assert.match(out, /export LEFTHOOK_CONFIG="\$shim_root\/\.lefthook\.yml"/);
  assert.doesNotMatch(out, /git-common-dir/, "never resolves via git-common-dir");
  // the block must precede the lefthook dispatcher
  assert.ok(out.indexOf(SHIM_MARKER) < out.indexOf("call_lefthook()"));
});

test("normalization is idempotent and byte-stable on already-normalized shims", () => {
  const once = normalizeHookShim(GENERATED);
  const twice = normalizeHookShim(once);
  assert.equal(twice, once);
  // structure preserved: shebang, guard, dispatcher tail
  assert.ok(once.startsWith("#!/bin/sh\n"));
  assert.match(once, /if \[ "\$LEFTHOOK" = "0" \]; then\n  exit 0\nfi/);
  assert.ok(once.trimEnd().endsWith('call_lefthook run "pre-commit" "$@"'));
});

test("normalization leaves stock shims without a call_lefthook anchor untouched", () => {
  const stock = "#!/bin/sh\necho passthrough\n";
  assert.equal(normalizeHookShim(stock), stock);
});
