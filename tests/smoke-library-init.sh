# shellcheck shell=bash
# shellcheck disable=SC2168  # H.9.1 — sourced by install.sh run_smoke_tests(); `local` is function-scope at runtime
# tests/smoke-library-init.sh — H.9.21 v2.1.0 library/init smoke tests.
#
# Sourced by install.sh run_smoke_tests(). Mutates parent-scope $passed/$failed.
#
# Tests (1):
#   Test 105 — J1 idempotency: `library migrate` run twice with same run_id →
#              second invocation sees sentinel + exits 0 with no writes.
#
# Isolation: HOME-redirect into ephemeral tmpdir per test. This redirects both
# os.homedir() (legacy paths) and the library root (via library-paths.js
# fallback to os.homedir()/.claude/library). HOME is set per-invocation as a
# command-prefix var so it doesn't leak into parent install.sh shell.
#
# H.9.16 drift-note 78(a) safe-pattern: init T_EXIT=0 + || T_EXIT=$?.

  # Test 105: H.9.21 J1 — library migrate idempotency
  echo -n "  Test 105 (H.9.21 J1 library migrate idempotency; sentinel matched → exit 0): "
  T105_TMPROOT=$(mktemp -d)
  mkdir -p "$T105_TMPROOT/.claude/checkpoints"
  printf "# fixture\n" > "$T105_TMPROOT/.claude/checkpoints/mempalace-fallback.md"
  echo '{}' > "$T105_TMPROOT/.claude/prompt-patterns.json"

  HOME="$T105_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" init >/dev/null 2>&1
  T105_FIRST=0
  HOME="$T105_TMPROOT" node "$SCRIPT_DIR/scripts/library-migrate.js" migrate --run-id test-105 >/dev/null 2>&1 || T105_FIRST=$?
  T105_SECOND=0
  T105_SECOND_OUT=$(HOME="$T105_TMPROOT" node "$SCRIPT_DIR/scripts/library-migrate.js" migrate --run-id test-105 2>&1) || T105_SECOND=$?
  T105_SENTINEL_OK="absent"
  [ -f "$T105_TMPROOT/.claude/library/.migrate-complete" ] && T105_SENTINEL_OK="present"

  if [ "$T105_FIRST" = "0" ] && [ "$T105_SECOND" = "0" ] && \
     [ "$T105_SENTINEL_OK" = "present" ] && echo "$T105_SECOND_OUT" | grep -q "idempotent skip"; then
    echo "PASS (both exit 0; sentinel present; idempotent skip message)"
    passed=$((passed+1))
  else
    echo "FAIL (first=$T105_FIRST second=$T105_SECOND sentinel=$T105_SENTINEL_OK msg='${T105_SECOND_OUT:0:60}')"
    failed=$((failed+1))
  fi
  rm -rf "$T105_TMPROOT"
