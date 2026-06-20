#!/usr/bin/env bash
# tests/smoke-ghost-heartbeat-schedule.sh
#
# Ghost Heartbeat W2-PR3b -- the scheduler-OFFER smoke. Exercises the SOURCE module via
# $SCRIPT_DIR (so a fresh CI checkout with no populated ~/.claude still runs it -- the
# H.7.15 clean-env discipline; the install.sh dispatch targets the installed $CLAUDE_DIR
# copy, which is a different path). All three assertions stay on the GENERATE-ONLY path:
#   T125: `install --dry-run` emits a well-formed artifact; on Darwin it is plutil-lint
#         clean (validated WITHOUT loading); elsewhere it is a marked cron block.
#   T126: the artifact bakes an ABSOLUTE node path (the launchd/cron minimal-PATH silent-
#         failure guard -- VERIFY arch #1) AND GHOST_HEARTBEAT_EMIT (the opt-in env).
#   T127: `install --dry-run` mutates NOTHING -- the schedule status is identical before
#         and after (VERIFY hacker #4: a --diff preview must plant no real task).
#
# Sourced by install.sh run_smoke_tests() -- mutates the parent-scope passed/failed
# counters via bash lexical scope (the HT.1.4 sourced-file convention). Uses the
# errexit-safe TNN_EXIT=0 + || TNN_EXIT=$? pattern (install.sh runs under set -euo
# pipefail; a bare $(failing_cmd) would abort before the if/else could report FAIL).

GHB_SCHED_MOD="$SCRIPT_DIR/packages/kernel/spawn-state/ghost-heartbeat-schedule.js"

# Test 125: dry-run install emits a well-formed, platform-correct artifact.
echo -n "  Test 125 (ghost-heartbeat schedule: dry-run emits a well-formed task artifact): "
T125_EXIT=0
T125_OUT=$(node "$GHB_SCHED_MOD" install --dry-run 2>&1) || T125_EXIT=$?
T125_OK=false
if [ "$T125_EXIT" -eq 0 ] && [ -n "$T125_OUT" ]; then
  if [ "$(uname -s)" = "Darwin" ]; then
    T125_DIR=$(mktemp -d)
    printf '%s' "$T125_OUT" > "$T125_DIR/x.plist"
    if plutil -lint "$T125_DIR/x.plist" >/dev/null 2>&1; then T125_OK=true; fi
    rm -rf "$T125_DIR"
  else
    case "$T125_OUT" in *"power-loom-ghost-heartbeat"*) T125_OK=true ;; esac
  fi
fi
if $T125_OK; then
  echo "OK (valid artifact for $(uname -s))"
  passed=$((passed + 1))
else
  echo "FAIL: dry-run artifact missing/invalid (exit $T125_EXIT)"
  failed=$((failed + 1))
fi

# Test 126: the artifact bakes the ABSOLUTE node path + the opt-in env var.
echo -n "  Test 126 (ghost-heartbeat schedule: artifact bakes an absolute node + EMIT=1): "
T126_EXIT=0
T126_OUT=$(node "$GHB_SCHED_MOD" install --dry-run 2>&1) || T126_EXIT=$?
T126_NODE=$(node -e 'process.stdout.write(process.execPath)')
if [ "$T126_EXIT" -eq 0 ] \
   && printf '%s' "$T126_OUT" | grep -qF "$T126_NODE" \
   && printf '%s' "$T126_OUT" | grep -qF "GHOST_HEARTBEAT_EMIT"; then
  echo "OK (absolute node + opt-in baked in)"
  passed=$((passed + 1))
else
  echo "FAIL: artifact missing the absolute node path or EMIT (exit $T126_EXIT)"
  failed=$((failed + 1))
fi

# Test 127: dry-run is inert -- schedule status is identical before and after.
echo -n "  Test 127 (ghost-heartbeat schedule: --dry-run mutates nothing): "
T127_EXIT=0
T127_BEFORE=$(node "$GHB_SCHED_MOD" status 2>&1) || T127_EXIT=$?
node "$GHB_SCHED_MOD" install --dry-run >/dev/null 2>&1 || true
T127_AFTER=$(node "$GHB_SCHED_MOD" status 2>&1) || T127_EXIT=$?
if [ "$T127_EXIT" -eq 0 ] && [ "$T127_BEFORE" = "$T127_AFTER" ]; then
  echo "OK (status unchanged by dry-run)"
  passed=$((passed + 1))
else
  echo "FAIL: dry-run changed schedule status ($T127_BEFORE -> $T127_AFTER)"
  failed=$((failed + 1))
fi
