#!/bin/bash
# Live bare-remote integration test for the git-native pre-push lint gate.
#
# Rule-2a-corollary: a mock can't produce real all-zeros / merge-base shas, prove
# that exit-1 blocks a real push, or that --no-verify bypasses. This exercises the
# REAL module + REAL eslint against a REAL bare remote in a disposable sandbox.
#
# Run manually:  bash tests/integration/lint-gate-prepush.integration.sh
# (Not wired into `install.sh --test` because it downloads eslint@9 via npx; it is
# a durable, reviewable deliverable that gates the real path on demand.)
#
# shellcheck shell=bash
set -uo pipefail

SRC_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"   # tests/integration/ -> repo root
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/loom-prepush-int.XXXXXX")"
trap 'rm -rf "$SANDBOX"' EXIT
pass=0; fail=0
ok() { echo "  PASS $1"; pass=$((pass+1)); }
no() { echo "  FAIL $1"; fail=$((fail+1)); }

git init --bare -q "$SANDBOX/remote.git"
git init -q -b main "$SANDBOX/work"
cd "$SANDBOX/work" || exit 1
git config user.email t@t.co; git config user.name t
git remote add origin "$SANDBOX/remote.git"

# Replicate the substrate the hook shim needs (module + its _log dep + eslint config).
mkdir -p packages/kernel/validators packages/kernel/hooks/_lib .githooks
cp "$SRC_ROOT/packages/kernel/validators/lint-gate-prepush.js" packages/kernel/validators/
cp "$SRC_ROOT/packages/kernel/hooks/_lib/_log.js" packages/kernel/hooks/_lib/
cp "$SRC_ROOT/eslint.config.js" .
cp "$SRC_ROOT/.githooks/pre-push.sh" .githooks/

# Install the hook via the copy model (what `install.sh --git-hooks` does).
cp .githooks/pre-push.sh .git/hooks/pre-push && chmod +x .git/hooks/pre-push
[ -x .git/hooks/pre-push ] && ok "hook installed + executable" || no "hook not installed"

# Seed a clean commit on main and push it.
printf 'const x = 1;\nmodule.exports = { x };\n' > clean.js
git add -A && git commit -q -m "seed: substrate + clean.js"
if git push -q origin main 2>$SANDBOX/push1.err; then ok "seed push to new main succeeded"; else no "seed push failed: $(cat $SANDBOX/push1.err)"; fi

# --- Range push that should BLOCK on a real eslint error --------------------
printf 'const unusedVar = 42;\nmodule.exports = {};\n' > broken.js
git add -A && git commit -q -m "add broken.js (unused var -> eslint error)"
BEFORE=$(git -C "$SANDBOX/remote.git" rev-parse refs/heads/main)
if git push origin main 2>$SANDBOX/push2.err; then no "broken push SUCCEEDED (should block)"; else ok "broken push blocked (non-zero hook exit)"; fi
AFTER=$(git -C "$SANDBOX/remote.git" rev-parse refs/heads/main)
[ "$BEFORE" = "$AFTER" ] && ok "remote main ref UNCHANGED after blocked push" || no "remote advanced despite block"
grep -q "no-unused-vars\|lint-gate\|eslint" $SANDBOX/push2.err && ok "block message surfaced the eslint failure" || no "no lint failure in stderr"
grep -q -- "--no-verify" $SANDBOX/push2.err && ok "block message names the --no-verify escape" || no "escape hatch not named"

# --- Same push with --no-verify should BYPASS -------------------------------
if git push --no-verify -q origin main 2>$SANDBOX/push3.err; then ok "--no-verify bypassed the gate"; else no "--no-verify failed: $(cat $SANDBOX/push3.err)"; fi
AFTER2=$(git -C "$SANDBOX/remote.git" rev-parse refs/heads/main)
[ "$AFTER2" != "$BEFORE" ] && ok "remote advanced after --no-verify (escape works)" || no "remote did not advance on --no-verify"

# --- Pure-delete of a .js file must NOT false-block (Fix B) -----------------
git rm -q broken.js && git commit -q -m "delete broken.js (pure delete)"
if git push -q origin main 2>$SANDBOX/push-del.err; then ok "pure-delete push succeeded (no false-block on a gone file)"; else no "pure-delete push blocked (regression!): $(cat $SANDBOX/push-del.err)"; fi

# --- New-branch push (real all-zeros remote sha -> merge-base path) ---------
git checkout -q -b feature
printf 'const y = 2;\nmodule.exports = { y };\n' > feat-clean.js
git add -A && git commit -q -m "feature: clean addition"
if git push -q origin feature 2>$SANDBOX/push4.err; then ok "new-branch clean push succeeded (merge-base scoped path)"; else no "new-branch push failed: $(cat $SANDBOX/push4.err)"; fi

# --- New-branch push carrying a lint error should BLOCK ---------------------
git checkout -q -b feature-bad
printf 'const nope = 99;\nmodule.exports = {};\n' > feat-bad.js
git add -A && git commit -q -m "feature-bad: unused var"
if git push origin feature-bad 2>$SANDBOX/push5.err; then no "new-branch broken push SUCCEEDED (should block)"; else ok "new-branch broken push blocked"; fi

echo ""
echo "integration: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
