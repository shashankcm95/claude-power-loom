# shellcheck shell=bash
# shellcheck disable=SC2168  # H.9.1 — sourced by install.sh run_smoke_tests(); `local` is function-scope at runtime
# tests/smoke-library-daybook.sh — H.9.22 v2.2.0 library daybook smoke tests.
#
# Sourced by install.sh run_smoke_tests(). Mutates parent-scope $passed/$failed.
#
# Tests (4):
#   Test 116 — Markdown render: against fixture library with all 5 sources present,
#              the markdown output contains all 5 expected section headers (L0 +
#              4×L1). Validates render-all-sections invariant.
#   Test 117 — JSON output schema: --json produces parseable JSON with the 7
#              top-level keys (timestamp, library_root, reader_profile,
#              snapshots, pending_candidates, memory_md, git).
#   Test 118 — Brief mode size cap: --brief output is < 1500 bytes. Verifies the
#              brief-mode budget contract documented in CHANGELOG.
#   Test 119 — Empty library robustness: fresh library with no profile, no
#              snapshots, no MEMORY, no git → daybook still emits cleanly
#              (exit 0; placeholders in lieu of content; no crashes).
#
# Isolation: ephemeral CLAUDE_LIBRARY_ROOT per test (Component O bulkhead pattern).
# H.9.16 drift-note 78(a) safe-pattern: init T_EXIT=0 + || T_EXIT=$?.

  # Test 116: H.9.22 v2.2.0 — markdown render produces all 5 expected sections.
  echo -n "  Test 116 (H.9.22 v2.2.0 daybook markdown all-sections present): "
  T116_TMPROOT=$(mktemp -d)
  CLAUDE_LIBRARY_ROOT="$T116_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" init >/dev/null 2>&1
  # Seed one session-snapshot
  echo '---
topic: [test, fixture]
entities: [v2.2.0]
---
# Test snapshot

Body line 1.
' | CLAUDE_LIBRARY_ROOT="$T116_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" \
      write toolkit/session-snapshots/test-snap-1 --form narrative >/dev/null 2>&1
  # Run daybook
  T116_OUT=$(CLAUDE_LIBRARY_ROOT="$T116_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" daybook 2>&1)
  T116_OK=1
  for HEADER in "# Daybook" "## L0 — Reader Profile" "## L1.1 — Recent Session Snapshots" "## L1.2 — Pending Self-Improve Candidates" "## L1.3 — Project Memory" "## L1.4 — Git Working Tree"; do
    if ! echo "$T116_OUT" | grep -qF "$HEADER"; then
      T116_OK=0
      T116_MISSING="$HEADER"
      break
    fi
  done
  # Also check snapshot is mentioned
  if [ "$T116_OK" = "1" ] && ! echo "$T116_OUT" | grep -qF "test-snap-1"; then
    T116_OK=0
    T116_MISSING="(snapshot test-snap-1 absent from output)"
  fi
  if [ "$T116_OK" = "1" ]; then
    echo "PASS (all 6 expected sections + snapshot rendered)"
    passed=$((passed+1))
  else
    echo "FAIL (missing: $T116_MISSING)"
    echo "       output head: $(echo "$T116_OUT" | head -3 | tr '\n' ' ')"
    failed=$((failed+1))
  fi
  rm -rf "$T116_TMPROOT"

  # Test 117: H.9.22 v2.2.0 — --json produces parseable JSON with expected keys.
  echo -n "  Test 117 (H.9.22 v2.2.0 daybook --json valid + top-level keys): "
  T117_TMPROOT=$(mktemp -d)
  CLAUDE_LIBRARY_ROOT="$T117_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" init >/dev/null 2>&1
  T117_JSON=$(CLAUDE_LIBRARY_ROOT="$T117_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" daybook --json 2>&1)
  T117_KEYS=$(python3 -c "
import json, sys
try:
  d = json.loads(sys.argv[1])
  print(' '.join(sorted(d.keys())))
except Exception as e:
  print('PARSE_ERROR:', e)
" "$T117_JSON" 2>&1)
  EXPECTED_KEYS="git library_root memory_md pending_candidates reader_profile snapshots timestamp"
  if [ "$T117_KEYS" = "$EXPECTED_KEYS" ]; then
    echo "PASS (7 expected top-level keys present + JSON parses)"
    passed=$((passed+1))
  else
    echo "FAIL (got keys: '$T117_KEYS'; expected: '$EXPECTED_KEYS')"
    failed=$((failed+1))
  fi
  rm -rf "$T117_TMPROOT"

  # Test 118: H.9.22 v2.2.0 — --brief output is under 1500 bytes.
  echo -n "  Test 118 (H.9.22 v2.2.0 daybook --brief size budget < 1500B): "
  T118_TMPROOT=$(mktemp -d)
  CLAUDE_LIBRARY_ROOT="$T118_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" init >/dev/null 2>&1
  # Seed snapshot with a long topic list to stress the budget
  echo '---
topic: [a, b, c, d, e, f, g, h, i, j]
entities: [x, y, z, w, v]
---
# Test
' | CLAUDE_LIBRARY_ROOT="$T118_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" \
      write toolkit/session-snapshots/wide-snap --form narrative >/dev/null 2>&1
  T118_BRIEF=$(CLAUDE_LIBRARY_ROOT="$T118_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" daybook --brief 2>&1)
  T118_BYTES=$(printf '%s' "$T118_BRIEF" | wc -c | tr -d ' ')
  if [ "$T118_BYTES" -lt 1500 ]; then
    echo "PASS (brief=${T118_BYTES}B < 1500B budget)"
    passed=$((passed+1))
  else
    echo "FAIL (brief=${T118_BYTES}B exceeds 1500B budget)"
    failed=$((failed+1))
  fi
  rm -rf "$T118_TMPROOT"

  # Test 119: H.9.22 v2.2.0 — empty library robustness; no crashes, exit 0,
  # placeholders rendered for missing sources.
  echo -n "  Test 119 (H.9.22 v2.2.0 daybook empty-library robustness): "
  T119_TMPROOT=$(mktemp -d)
  CLAUDE_LIBRARY_ROOT="$T119_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" init >/dev/null 2>&1
  # Delete reader-profile to simulate user not authoring one yet
  rm -f "$T119_TMPROOT/reader-profile.md"
  T119_EXIT=0
  T119_OUT=$(CLAUDE_LIBRARY_ROOT="$T119_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" daybook --no-git 2>&1) || T119_EXIT=$?
  # Must exit 0 + must contain placeholder text for missing profile + missing snapshots
  T119_HAS_PROFILE_PLACEHOLDER=0
  T119_HAS_EMPTY_SNAPSHOTS=0
  echo "$T119_OUT" | grep -q "No reader-profile.md authored" && T119_HAS_PROFILE_PLACEHOLDER=1
  echo "$T119_OUT" | grep -q "No session snapshots" && T119_HAS_EMPTY_SNAPSHOTS=1
  if [ "$T119_EXIT" = "0" ] && [ "$T119_HAS_PROFILE_PLACEHOLDER" = "1" ] && [ "$T119_HAS_EMPTY_SNAPSHOTS" = "1" ]; then
    echo "PASS (exit=0; profile + snapshots placeholders rendered)"
    passed=$((passed+1))
  else
    echo "FAIL (exit=$T119_EXIT profile_placeholder=$T119_HAS_PROFILE_PLACEHOLDER snap_placeholder=$T119_HAS_EMPTY_SNAPSHOTS)"
    echo "       output head: $(echo "$T119_OUT" | head -3 | tr '\n' ' ')"
    failed=$((failed+1))
  fi
  rm -rf "$T119_TMPROOT"
