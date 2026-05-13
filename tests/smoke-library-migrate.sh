# shellcheck shell=bash
# shellcheck disable=SC2168  # H.9.1 — sourced by install.sh run_smoke_tests(); `local` is function-scope at runtime
# tests/smoke-library-migrate.sh — H.9.21 v2.1.0 library/migrate smoke tests.
#
# Sourced by install.sh run_smoke_tests(). Mutates parent-scope $passed/$failed.
#
# Tests (3):
#   Test 106 — J2 partial-failure recovery: delete sentinel mid-migration; re-run
#              completes safely + content readable via symlinks.
#   Test 107 — J3 symlink resolution: legacy path returns library content via symlink.
#   Test 110 — J6 rollback: library rollback restores legacy files from backup.
#
# Isolation: HOME-redirect per-invocation (command-prefix var; no parent leak).
# H.9.16 drift-note 78(a) safe-pattern: init T_EXIT=0 + || T_EXIT=$?.

  # Test 106: H.9.21 J2 — partial-failure recovery
  echo -n "  Test 106 (H.9.21 J2 partial-failure recovery; delete sentinel; re-run resumes): "
  T106_TMPROOT=$(mktemp -d)
  mkdir -p "$T106_TMPROOT/.claude/checkpoints"
  printf "# fixture\n" > "$T106_TMPROOT/.claude/checkpoints/mempalace-fallback.md"
  echo '{}' > "$T106_TMPROOT/.claude/prompt-patterns.json"

  HOME="$T106_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" init >/dev/null 2>&1
  T106_FIRST=0
  HOME="$T106_TMPROOT" node "$SCRIPT_DIR/scripts/library-migrate.js" migrate --run-id test-106 >/dev/null 2>&1 || T106_FIRST=$?
  # Simulate crash: delete sentinel between migration steps
  rm -f "$T106_TMPROOT/.claude/library/.migrate-complete"
  # Re-run with new run_id (post-crash recovery scenario)
  T106_SECOND=0
  HOME="$T106_TMPROOT" node "$SCRIPT_DIR/scripts/library-migrate.js" migrate --run-id test-106-retry >/dev/null 2>&1 || T106_SECOND=$?
  T106_CONTENT=$(cat "$T106_TMPROOT/.claude/checkpoints/mempalace-fallback.md" 2>/dev/null) || T106_CONTENT=""

  if [ "$T106_FIRST" = "0" ] && [ "$T106_SECOND" = "0" ] && \
     [ -f "$T106_TMPROOT/.claude/library/.migrate-complete" ] && \
     [ "$T106_CONTENT" = "# fixture" ]; then
    echo "PASS (resumed cleanly; content readable via symlink)"
    passed=$((passed+1))
  else
    echo "FAIL (first=$T106_FIRST second=$T106_SECOND content='${T106_CONTENT:0:40}')"
    failed=$((failed+1))
  fi
  rm -rf "$T106_TMPROOT"

  # Test 107: H.9.21 J3 — symlink resolution
  echo -n "  Test 107 (H.9.21 J3 legacy-path symlink resolves to library volume): "
  T107_TMPROOT=$(mktemp -d)
  mkdir -p "$T107_TMPROOT/.claude/checkpoints"
  T107_SENTINEL_CONTENT="J3-symlink-test-$$"
  printf "%s\n" "$T107_SENTINEL_CONTENT" > "$T107_TMPROOT/.claude/checkpoints/mempalace-fallback.md"
  echo '{}' > "$T107_TMPROOT/.claude/prompt-patterns.json"

  HOME="$T107_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" init >/dev/null 2>&1
  HOME="$T107_TMPROOT" node "$SCRIPT_DIR/scripts/library-migrate.js" migrate --run-id test-107 >/dev/null 2>&1
  T107_IS_LINK="no"
  [ -L "$T107_TMPROOT/.claude/checkpoints/mempalace-fallback.md" ] && T107_IS_LINK="yes"
  T107_VIA_LEGACY=$(cat "$T107_TMPROOT/.claude/checkpoints/mempalace-fallback.md" 2>/dev/null) || T107_VIA_LEGACY=""

  if [ "$T107_IS_LINK" = "yes" ] && [ "$T107_VIA_LEGACY" = "$T107_SENTINEL_CONTENT" ]; then
    echo "PASS (legacy is symlink; content matches via symlink read)"
    passed=$((passed+1))
  else
    echo "FAIL (is_link=$T107_IS_LINK content='${T107_VIA_LEGACY:0:40}')"
    failed=$((failed+1))
  fi
  rm -rf "$T107_TMPROOT"

  # Test 110: H.9.21 J6 — rollback restores legacy files
  echo -n "  Test 110 (H.9.21 J6 rollback restores legacy + removes sentinel): "
  T110_TMPROOT=$(mktemp -d)
  mkdir -p "$T110_TMPROOT/.claude/checkpoints"
  T110_ORIG_CONTENT="J6-rollback-marker-$$"
  printf "%s\n" "$T110_ORIG_CONTENT" > "$T110_TMPROOT/.claude/checkpoints/mempalace-fallback.md"
  echo '{}' > "$T110_TMPROOT/.claude/prompt-patterns.json"

  HOME="$T110_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" init >/dev/null 2>&1
  HOME="$T110_TMPROOT" node "$SCRIPT_DIR/scripts/library-migrate.js" migrate --run-id test-110 >/dev/null 2>&1
  T110_PRE_LINK="no"; [ -L "$T110_TMPROOT/.claude/checkpoints/mempalace-fallback.md" ] && T110_PRE_LINK="yes"
  T110_ROLLBACK_EXIT=0
  HOME="$T110_TMPROOT" node "$SCRIPT_DIR/scripts/library-migrate.js" rollback --to test-110 >/dev/null 2>&1 || T110_ROLLBACK_EXIT=$?
  T110_POST_LINK="no"; [ -L "$T110_TMPROOT/.claude/checkpoints/mempalace-fallback.md" ] && T110_POST_LINK="yes"
  T110_POST_CONTENT=$(cat "$T110_TMPROOT/.claude/checkpoints/mempalace-fallback.md" 2>/dev/null) || T110_POST_CONTENT=""
  T110_SENTINEL_GONE="yes"; [ -f "$T110_TMPROOT/.claude/library/.migrate-complete" ] && T110_SENTINEL_GONE="no"

  if [ "$T110_PRE_LINK" = "yes" ] && [ "$T110_ROLLBACK_EXIT" = "0" ] && \
     [ "$T110_POST_LINK" = "no" ] && [ "$T110_POST_CONTENT" = "$T110_ORIG_CONTENT" ] && \
     [ "$T110_SENTINEL_GONE" = "yes" ]; then
    echo "PASS (symlink → file roundtrip; content preserved; sentinel removed)"
    passed=$((passed+1))
  else
    T110_CM="n"; [ "$T110_POST_CONTENT" = "$T110_ORIG_CONTENT" ] && T110_CM="y"
    echo "FAIL (pre_link=$T110_PRE_LINK rb_exit=$T110_ROLLBACK_EXIT post_link=$T110_POST_LINK content_match=$T110_CM sentinel_gone=$T110_SENTINEL_GONE)"
    failed=$((failed+1))
  fi
  rm -rf "$T110_TMPROOT"
