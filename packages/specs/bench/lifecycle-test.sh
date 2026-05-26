#!/usr/bin/env bash
# bench/lifecycle-test.sh — verifies hooks that fire on session lifecycle events.
#
# Most bench scenarios cover single-session in-flight behavior. This script
# covers the lifecycle hooks that ONLY fire on:
#   - session start (already verified by single-shot scenarios; we re-check)
#   - session end / Stop (always fires; re-verified)
#   - PreCompact (only fires on /compact; NOT exercised by single-shot)
#
# Strategy: run a brief `claude -p` session, then a second session that
# resumes the first via --resume / --continue, simulating a "long-running"
# project. Snapshot file-system markers (log-file mtimes, library writes)
# before/after to confirm each lifecycle hook fired.
#
# Note on PreCompact: `claude -p` does NOT auto-trigger compaction (single
# turn, no buildup). PreCompact-firing requires either an extended session
# OR manual `/compact` invocation — neither is fully scriptable headlessly.
# The most we can verify here is that pre-compact-save.js is INSTALLED at
# the right path with the right matcher, and that the SAVE_PROMPT it emits
# is intact. Real PreCompact firing is documented in the interactive
# checklist instead.

set -euo pipefail

BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLKIT_DIR="$(cd "$BENCH_DIR/.." && pwd)"
RUN_TS="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
RUN_DIR="$BENCH_DIR/runs/$RUN_TS-lifecycle"
mkdir -p "$RUN_DIR"
echo "Lifecycle test run: $RUN_DIR"

PASS=0
FAIL=0
FAILURES=()

check() {
  local label="$1"; shift
  if "$@"; then
    echo "  PASS  $label"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $label"
    FAILURES+=("$label")
    FAIL=$((FAIL + 1))
  fi
}

# --- Test 1: session-reset hook fires on session start ----------------------
echo ""
echo "=== Test 1: SessionStart — session-reset.js fires ==="
PRE_MTIME=$(stat -f %m ~/.claude/logs/session-reset.log 2>/dev/null || stat -c %Y ~/.claude/logs/session-reset.log 2>/dev/null || echo 0)
echo "  Pre-session session-reset.log mtime: $PRE_MTIME"
# Trigger a fresh session
claude -p "say hi in 2 words" --output-format json --permission-mode bypassPermissions > "$RUN_DIR/lifecycle-1.json" 2>&1 || true
POST_MTIME=$(stat -f %m ~/.claude/logs/session-reset.log 2>/dev/null || stat -c %Y ~/.claude/logs/session-reset.log 2>/dev/null || echo 0)
echo "  Post-session session-reset.log mtime: $POST_MTIME"
check "session-reset.log mtime advanced" [ "$POST_MTIME" -gt "$PRE_MTIME" ]

# --- Test 2: Stop hook fires (auto-store-enrichment turnCounter bump) ------
echo ""
echo "=== Test 2: Stop — auto-store-enrichment.js turnCounter bump ==="
COUNTER_BEFORE=$(python3 -c "import json; print(json.load(open('$HOME/.claude/self-improve-counters.json')).get('turnCounter', 0))" 2>/dev/null || echo 0)
echo "  turnCounter before: $COUNTER_BEFORE"
claude -p "echo test" --output-format json --permission-mode bypassPermissions > "$RUN_DIR/lifecycle-2.json" 2>&1 || true
COUNTER_AFTER=$(python3 -c "import json; print(json.load(open('$HOME/.claude/self-improve-counters.json')).get('turnCounter', 0))" 2>/dev/null || echo 0)
echo "  turnCounter after: $COUNTER_AFTER"
check "turnCounter advanced (Stop hook fired)" [ "$COUNTER_AFTER" -gt "$COUNTER_BEFORE" ]

# --- Test 3: pre-compact-save.js installed correctly ------------------------
echo ""
echo "=== Test 3: PreCompact hook installed (static verification) ==="
INSTALL_PATH=$(python3 -c "import json; d = json.load(open('$HOME/.claude/plugins/installed_plugins.json'))['plugins']['power-loom@power-loom-marketplace'][0]['installPath']; print(d)" 2>/dev/null || echo "$HOME/.claude/plugins/cache/power-loom-marketplace/power-loom/1.15.1")
PRE_COMPACT_SCRIPT="$INSTALL_PATH/hooks/scripts/pre-compact-save.js"
PRE_COMPACT_HOOKS_JSON="$INSTALL_PATH/hooks/hooks.json"
check "pre-compact-save.js exists at install path" test -f "$PRE_COMPACT_SCRIPT"
check "hooks.json registers PreCompact matcher" grep -q "PreCompact" "$PRE_COMPACT_HOOKS_JSON"
check "hooks.json references pre-compact-save.js" grep -q "pre-compact-save.js" "$PRE_COMPACT_HOOKS_JSON"
check "pre-compact-save.js emits SAVE_PROMPT" grep -q "SAVE_PROMPT\|save.*prompt\|library write" "$PRE_COMPACT_SCRIPT"

# --- Test 4: session-self-improve-prompt hook installed ---------------------
echo ""
echo "=== Test 4: UserPromptSubmit session-self-improve-prompt.js installed ==="
SS_IMPROVE="$INSTALL_PATH/hooks/scripts/session-self-improve-prompt.js"
check "session-self-improve-prompt.js exists" test -f "$SS_IMPROVE"
check "hooks.json references it" grep -q "session-self-improve-prompt" "$PRE_COMPACT_HOOKS_JSON"

# --- Summary ----------------------------------------------------------------
echo ""
echo "========================================"
echo "Lifecycle test results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "Failures:"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
fi
echo "Artifacts: $RUN_DIR"
echo "========================================"

# Note: PreCompact actually FIRING requires a real /compact invocation,
# which isn't scriptable in `claude -p`. Document in interactive checklist.

exit "$FAIL"
