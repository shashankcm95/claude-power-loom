# shellcheck shell=bash
# shellcheck disable=SC2168  # H.9.1 — sourced by install.sh run_smoke_tests(); `local` is function-scope at runtime
# tests/smoke-library-bulkhead.sh — H.9.21.1 v2.1.1 Component H FULL bulkhead smoke tests.
#
# Sourced by install.sh run_smoke_tests(). Mutates parent-scope $passed/$failed.
#
# Tests (2):
#   Test 111 — Per-persona bulkhead: 16 parallel writes to 16 different personas
#              via pattern-recorder.js complete cleanly + each persona's file
#              holds exactly 1 entry (no lost writes, no cross-persona contamination).
#              Validates Component H FULL — disjoint per-persona locks under
#              HETS parallelism.
#   Test 112 — Partition round-trip: write 5 patterns to consolidated.json (mimics
#              v2.1.0 production state), run `library-migrate partition-personas`,
#              verify aggregate count via per-persona file scan matches pre-partition.
#              Idempotency check: re-run with same run_id exits 0 with no writes.
#
# Isolation: ephemeral CLAUDE_LIBRARY_ROOT per test (Component O bulkhead pattern).
# H.9.16 drift-note 78(a) safe-pattern: init T_EXIT=0 + || T_EXIT=$?.

  # Test 111: H.9.21.1 — per-persona bulkhead under 16-way parallelism
  echo -n "  Test 111 (H.9.21.1 v2.1.1 Component H FULL — 16 parallel writers to 16 personas no contention): "
  T111_TMPROOT=$(mktemp -d)
  CLAUDE_LIBRARY_ROOT="$T111_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" init >/dev/null 2>&1
  # Activate bulkhead by running partition-personas — even with empty consolidated.json
  # the sentinel lands, which flips registry.js + pattern-recorder.js to per-persona mode.
  CLAUDE_LIBRARY_ROOT="$T111_TMPROOT" node "$SCRIPT_DIR/scripts/library-migrate.js" \
    partition-personas --run-id test-111-activate >/dev/null 2>&1
  # Personas — full 16-persona roster from DEFAULT_ROSTERS (registry.js)
  T111_PERSONAS=(01-hacker 02-confused-user 03-code-reviewer 04-architect 05-honesty-auditor 06-ios-developer 07-java-backend 08-ml-engineer 09-react-frontend 10-devops-sre 11-data-engineer 12-security-engineer 13-node-backend 14-codebase-locator 15-codebase-analyzer 16-codebase-pattern-finder)
  T111_PIDS=()
  for p in "${T111_PERSONAS[@]}"; do
    ( CLAUDE_LIBRARY_ROOT="$T111_TMPROOT" \
        node "$SCRIPT_DIR/scripts/agent-team/pattern-recorder.js" \
        record --task-signature "bulkhead-test" --persona "$p" --verdict pass >/dev/null 2>&1 ) &
    T111_PIDS+=($!)
  done
  T111_FAIL=0
  for pid in "${T111_PIDS[@]}"; do wait "$pid" || T111_FAIL=$((T111_FAIL+1)); done
  # Verify each persona's volume file exists with exactly 1 pattern entry
  T111_OK=1
  T111_VOLDIR="$T111_TMPROOT/sections/agents/stacks/verdicts/volumes"
  T111_FILE_COUNT=$(find "$T111_VOLDIR" -maxdepth 1 -name '*.json' ! -name 'consolidated.json' ! -name '_*' 2>/dev/null | wc -l | tr -d ' ')
  for p in "${T111_PERSONAS[@]}"; do
    F="$T111_VOLDIR/$p.json"
    if [ ! -f "$F" ]; then T111_OK=0; break; fi
    CNT=$(python3 -c "import json; print(len(json.load(open('$F'))['patterns']))" 2>/dev/null)
    if [ "$CNT" != "1" ]; then T111_OK=0; break; fi
  done
  if [ "$T111_FAIL" = "0" ] && [ "$T111_OK" = "1" ] && [ "$T111_FILE_COUNT" = "16" ]; then
    echo "PASS (16/16 personas; 1 entry each; 0 deadlocks)"
    passed=$((passed+1))
  else
    echo "FAIL (fail=$T111_FAIL files=$T111_FILE_COUNT all_ok=$T111_OK)"
    failed=$((failed+1))
  fi
  rm -rf "$T111_TMPROOT"

  # Test 112: H.9.21.1 — partition-personas round-trip + idempotency
  echo -n "  Test 112 (H.9.21.1 v2.1.1 partition-personas round-trip count + idempotency sentinel): "
  T112_TMPROOT=$(mktemp -d)
  CLAUDE_LIBRARY_ROOT="$T112_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" init >/dev/null 2>&1
  # Seed consolidated.json mimicking v2.1.0 production state
  T112_VERDICTS_VOL="$T112_TMPROOT/sections/agents/stacks/verdicts/volumes"
  T112_IDENTITIES_VOL="$T112_TMPROOT/sections/agents/stacks/identities/volumes"
  mkdir -p "$T112_VERDICTS_VOL" "$T112_IDENTITIES_VOL"
  cat > "$T112_IDENTITIES_VOL/consolidated.json" <<EOF
{
  "version": 1,
  "rosters": {"01-hacker": ["zoe","ren"], "04-architect": ["mira"]},
  "nextIndex": {"01-hacker": 1, "04-architect": 1},
  "identities": {
    "01-hacker.zoe":      {"persona":"01-hacker","name":"zoe","verdicts":{"pass":5,"partial":0,"fail":1}},
    "01-hacker.ren":      {"persona":"01-hacker","name":"ren","verdicts":{"pass":3,"partial":1,"fail":0}},
    "04-architect.mira":  {"persona":"04-architect","name":"mira","verdicts":{"pass":10,"partial":2,"fail":0}}
  }
}
EOF
  cat > "$T112_VERDICTS_VOL/consolidated.json" <<EOF
{
  "version": 1,
  "patterns": [
    {"persona":"01-hacker","verdict":"pass","ran_at":"2026-05-13T10:00:00Z"},
    {"persona":"01-hacker","verdict":"fail","ran_at":"2026-05-13T10:01:00Z"},
    {"persona":"04-architect","verdict":"pass","ran_at":"2026-05-13T10:02:00Z"},
    {"persona":"04-architect","verdict":"pass","ran_at":"2026-05-13T10:03:00Z"},
    {"persona":"04-architect","verdict":"pass","ran_at":"2026-05-13T10:04:00Z"}
  ]
}
EOF
  # Run partition
  T112_FIRST=0
  CLAUDE_LIBRARY_ROOT="$T112_TMPROOT" node "$SCRIPT_DIR/scripts/library-migrate.js" \
    partition-personas --run-id test-112 >/dev/null 2>&1 || T112_FIRST=$?
  # Re-run for idempotency
  T112_SECOND=0
  T112_SECOND_OUT=$(CLAUDE_LIBRARY_ROOT="$T112_TMPROOT" node "$SCRIPT_DIR/scripts/library-migrate.js" \
    partition-personas --run-id test-112 2>&1) || T112_SECOND=$?
  # Verify aggregate counts match
  T112_PAT_TOTAL=$(python3 -c "
import json, os, glob
total = 0
for f in glob.glob('$T112_VERDICTS_VOL/*.json'):
  bn = os.path.basename(f)
  if bn == 'consolidated.json' or bn.startswith('_') or bn.startswith('.'): continue
  total += len(json.load(open(f))['patterns'])
print(total)" 2>/dev/null)
  T112_ID_TOTAL=$(python3 -c "
import json, os, glob
total = 0
for f in glob.glob('$T112_IDENTITIES_VOL/*.json'):
  bn = os.path.basename(f)
  if bn == 'consolidated.json' or bn.startswith('_') or bn.startswith('.'): continue
  total += len(json.load(open(f))['identities'])
print(total)" 2>/dev/null)
  T112_SENTINEL="absent"
  [ -f "$T112_TMPROOT/.partition-complete" ] && T112_SENTINEL="present"
  if [ "$T112_FIRST" = "0" ] && [ "$T112_SECOND" = "0" ] && \
     [ "$T112_PAT_TOTAL" = "5" ] && [ "$T112_ID_TOTAL" = "3" ] && \
     [ "$T112_SENTINEL" = "present" ] && \
     echo "$T112_SECOND_OUT" | grep -q "idempotent skip"; then
    echo "PASS (patterns=5/5 identities=3/3 sentinel present; idempotent skip on re-run)"
    passed=$((passed+1))
  else
    echo "FAIL (first=$T112_FIRST second=$T112_SECOND pat=$T112_PAT_TOTAL/5 id=$T112_ID_TOTAL/3 sentinel=$T112_SENTINEL)"
    failed=$((failed+1))
  fi
  rm -rf "$T112_TMPROOT"

  # Test 113: H.9.21.1 — pre-bulkhead safety; v2.1.0 → v2.1.1 upgrade without
  # partition keeps reading/writing consolidated.json correctly (no data loss).
  echo -n "  Test 113 (H.9.21.1 v2.1.1 pre-bulkhead upgrade compat — consolidated.json reads/writes preserved without partition sentinel): "
  T113_TMPROOT=$(mktemp -d)
  CLAUDE_LIBRARY_ROOT="$T113_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" init >/dev/null 2>&1
  # Seed v2.1.0-shape consolidated.json files
  T113_VERDICTS_VOL="$T113_TMPROOT/sections/agents/stacks/verdicts/volumes"
  mkdir -p "$T113_VERDICTS_VOL"
  cat > "$T113_VERDICTS_VOL/consolidated.json" <<'EOF'
{"version":1,"patterns":[{"persona":"01-hacker","verdict":"pass","ran_at":"2026-05-13T10:00:00Z"},{"persona":"04-architect","verdict":"pass","ran_at":"2026-05-13T10:01:00Z"}]}
EOF
  # Confirm partition sentinel NOT present
  T113_SENT_PRE="absent"; [ -f "$T113_TMPROOT/.partition-complete" ] && T113_SENT_PRE="present"
  # Append a verdict via pattern-recorder (should land in consolidated.json, not per-persona)
  CLAUDE_LIBRARY_ROOT="$T113_TMPROOT" node "$SCRIPT_DIR/scripts/agent-team/pattern-recorder.js" \
    record --task-signature t-upgrade --persona 01-hacker --verdict fail >/dev/null 2>&1
  # Verify: consolidated.json now has 3 entries; NO per-persona files created
  T113_CONS_COUNT=$(python3 -c "import json; print(len(json.load(open('$T113_VERDICTS_VOL/consolidated.json'))['patterns']))" 2>/dev/null)
  T113_PERSONA_FILES=$(find "$T113_VERDICTS_VOL" -maxdepth 1 -name '*.json' ! -name 'consolidated.json' ! -name '_*' 2>/dev/null | wc -l | tr -d ' ')
  T113_SENT_POST="absent"; [ -f "$T113_TMPROOT/.partition-complete" ] && T113_SENT_POST="present"
  if [ "$T113_SENT_PRE" = "absent" ] && [ "$T113_SENT_POST" = "absent" ] && \
     [ "$T113_CONS_COUNT" = "3" ] && [ "$T113_PERSONA_FILES" = "0" ]; then
    echo "PASS (consolidated grew 2→3; 0 per-persona files; sentinel absent)"
    passed=$((passed+1))
  else
    echo "FAIL (sent_pre=$T113_SENT_PRE sent_post=$T113_SENT_POST cons_count=$T113_CONS_COUNT/3 persona_files=$T113_PERSONA_FILES/0)"
    failed=$((failed+1))
  fi
  rm -rf "$T113_TMPROOT"
