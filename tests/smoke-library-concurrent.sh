# shellcheck shell=bash
# shellcheck disable=SC2168  # H.9.1 — sourced by install.sh run_smoke_tests(); `local` is function-scope at runtime
# tests/smoke-library-concurrent.sh — H.9.21 v2.1.0 library/concurrency smoke tests.
#
# Sourced by install.sh run_smoke_tests(). Mutates parent-scope $passed/$failed.
#
# Tests (2 — fully implemented; do NOT depend on Sub-phase 4 migration):
#   Test 108 — J4 concurrent write: 2 simultaneous `library write` against same
#              stack → _lib/lock.js serializes; both volumes preserved in catalog.
#              Component N (architect addition — catalog write-locking).
#   Test 109 — J5 schema_version mismatch: inject schema_version: 99 → `library read`
#              fails-closed with clear message. Component M + library-catalog.js
#              schema-guard (code-reviewer MEDIUM 9 absorption).
#
# Isolation: ephemeral CLAUDE_LIBRARY_ROOT per test (Component O bulkhead pattern).
# H.9.16 drift-note 78(a) safe-pattern: init T_EXIT=0 + || T_EXIT=$?; downstream || true.

  # Test 108: H.9.21 J4 — concurrent write under _lib/lock.js serialization.
  # H.9.21.2.1 v2.1.3 follow-up: capture per-writer exit codes + stderr (kept in
  # tmpdir; surfaced only on FAIL) so future CI flakes are diagnosable instead
  # of opaque. Prior pure-redirect-to-/dev/null pattern silently swallowed
  # "Could not acquire lock" stderr from withLock's exit(2) path, making the
  # 4/5 → 3/5 CI regression undebuggable without re-running with verbose
  # patches.
  echo -n "  Test 108 (H.9.21 J4 concurrent library write _lib/lock.js serializes): "
  T108_TMPROOT=$(mktemp -d)
  T108_STDERR_DIR="$T108_TMPROOT/.stderr"
  mkdir -p "$T108_STDERR_DIR"
  CLAUDE_LIBRARY_ROOT="$T108_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" init >/dev/null 2>&1
  # Fire 5 concurrent writes to the SAME stack (different volume_ids). With
  # Component N locking, all 5 should land in catalog with no lost entries.
  # Without locking, last-writer-wins on _catalog.json → entries lost.
  T108_PIDS=()
  for i in 1 2 3 4 5; do
    ( echo "{\"persona\": \"test-$i\", \"iter\": $i}" | \
        CLAUDE_LIBRARY_ROOT="$T108_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" \
        write "agents/verdicts/concurrent-$i" --form schematic \
        >/dev/null 2>"$T108_STDERR_DIR/w$i.err" ) &
    T108_PIDS+=($!)
  done
  T108_EXIT_CODES=()
  for pid in "${T108_PIDS[@]}"; do
    wait "$pid"; T108_EXIT_CODES+=("$?")
  done
  # Verify all 5 entries in catalog
  T108_CATALOG="$T108_TMPROOT/sections/agents/stacks/verdicts/_catalog.json"
  T108_COUNT=$(python3 -c "import json; print(len(json.load(open('$T108_CATALOG'))['entries']))" 2>/dev/null) || T108_COUNT=0
  if [ "$T108_COUNT" = "5" ]; then
    echo "PASS (5/5 entries; lock serialized; exit_codes=${T108_EXIT_CODES[*]})"
    passed=$((passed+1))
  else
    echo "FAIL (got $T108_COUNT/5 entries — lock not serializing)"
    echo "       exit_codes=${T108_EXIT_CODES[*]}"
    # Surface per-writer stderr so the failure is diagnosable
    for i in 1 2 3 4 5; do
      ERR_BYTES=$(wc -c < "$T108_STDERR_DIR/w$i.err" 2>/dev/null | tr -d ' ' || echo 0)
      if [ "$ERR_BYTES" != "0" ]; then
        echo "       [w$i stderr ${ERR_BYTES}B]: $(head -c 200 "$T108_STDERR_DIR/w$i.err" | tr '\n' ' ')"
      fi
    done
    failed=$((failed+1))
  fi
  rm -rf "$T108_TMPROOT"

  # Test 109: H.9.21 J5 — schema_version mismatch fails closed
  echo -n "  Test 109 (H.9.21 J5 schema_version > supported fails-closed): "
  T109_TMPROOT=$(mktemp -d)
  CLAUDE_LIBRARY_ROOT="$T109_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" init >/dev/null 2>&1
  # Write one valid volume
  echo '{"foo": "bar"}' | CLAUDE_LIBRARY_ROOT="$T109_TMPROOT" \
    node "$SCRIPT_DIR/scripts/library.js" write toolkit/self-improve/test-vol --form schematic >/dev/null 2>&1
  # Inject schema_version: 99 into the catalog (simulating future-version file)
  T109_CATALOG="$T109_TMPROOT/sections/toolkit/stacks/self-improve/_catalog.json"
  python3 -c "
import json
with open('$T109_CATALOG') as f: data = json.load(f)
data['schema_version'] = 99
with open('$T109_CATALOG', 'w') as f: json.dump(data, f)
" 2>/dev/null || true
  # Attempt read → should fail-closed
  T109_EXIT=0
  T109_OUT=$(CLAUDE_LIBRARY_ROOT="$T109_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" \
    read toolkit/self-improve/test-vol 2>&1) || T109_EXIT=$?
  if [ "$T109_EXIT" != "0" ] && echo "$T109_OUT" | grep -qi "schema_version\|exceeds supported\|fail"; then
    echo "PASS (exit=$T109_EXIT; fail-closed message present)"
    passed=$((passed+1))
  else
    echo "FAIL (exit=$T109_EXIT; output=${T109_OUT:0:80})"
    failed=$((failed+1))
  fi
  rm -rf "$T109_TMPROOT"
