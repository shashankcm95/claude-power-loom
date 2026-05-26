#!/usr/bin/env bash
# bench/run-all.sh — run all scenarios + lifecycle + aggregate to a report card.
#
# Usage:
#   bench/run-all.sh                       # run all scenarios + lifecycle
#   bench/run-all.sh --scenarios 01,02     # subset
#   bench/run-all.sh --skip-lifecycle      # scenarios only
#   bench/run-all.sh --skip-scenarios      # lifecycle only
#
# Output: aggregate report at bench/runs/<ts>-aggregate/report.md
#
# Cost estimate: full run is 5 scenarios × ~1-5 min each + lifecycle ~30s.
# Expect 10-25 min wallclock; ~50K-150K output tokens total. Run when you
# want a comprehensive plugin verification (e.g. before plugin submission).

set -euo pipefail

BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_TS="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
AGGREGATE_DIR="$BENCH_DIR/runs/$RUN_TS-aggregate"
mkdir -p "$AGGREGATE_DIR"

SCENARIOS_FILTER=""
SKIP_LIFECYCLE=false
SKIP_SCENARIOS=false

while [ $# -gt 0 ]; do
  case "$1" in
    --scenarios) SCENARIOS_FILTER="$2"; shift 2 ;;
    --skip-lifecycle) SKIP_LIFECYCLE=true; shift ;;
    --skip-scenarios) SKIP_SCENARIOS=true; shift ;;
    --help|-h) sed -n '4,18p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

echo "Aggregate run: $AGGREGATE_DIR"
echo ""

# Collect scenarios to run
SCENARIO_LIST=()
if ! $SKIP_SCENARIOS; then
  for d in "$BENCH_DIR"/scenarios/*/; do
    [ -d "$d" ] || continue
    name=$(basename "$d")
    if [ -z "$SCENARIOS_FILTER" ]; then
      SCENARIO_LIST+=("$name")
    elif echo ",$SCENARIOS_FILTER," | grep -q ",$name,\|,${name%%-*}," ; then
      SCENARIO_LIST+=("$name")
    fi
  done
fi

echo "Scenarios to run (${#SCENARIO_LIST[@]}): ${SCENARIO_LIST[*]:-none}"
$SKIP_LIFECYCLE && echo "Lifecycle: SKIPPED" || echo "Lifecycle: will run"
echo ""

# Run each scenario
TOTAL_DETERMINISTIC_PASS=0
TOTAL_DETERMINISTIC_FAIL=0
TOTAL_DETERMINISTIC_SKIPPED=0
SCENARIO_RESULTS=()

for scenario in "${SCENARIO_LIST[@]}"; do
  echo "================================================================"
  echo ">>> Running scenario: $scenario"
  echo "================================================================"
  SCENARIO_OUT="$AGGREGATE_DIR/$scenario.log"
  # Use tee so users see live progress on terminal AND full output is captured
  # to the per-scenario log. Without tee, the terminal looks frozen for 1-10 min
  # per scenario while claude -p churns in silence (bench-v0.1 UX bug).
  if bash "$BENCH_DIR/runner.sh" --scenario "$scenario" 2>&1 | tee "$SCENARIO_OUT"; then
    SCENARIO_RESULTS+=("$scenario:RAN")
  else
    SCENARIO_RESULTS+=("$scenario:RUNNER_ERROR")
  fi
  # Pull the latest run dir for this scenario
  LATEST_RUN=$(ls -dt "$BENCH_DIR"/runs/*-"$scenario"-* 2>/dev/null | head -1)
  if [ -n "$LATEST_RUN" ] && [ -f "$LATEST_RUN/metrics.json" ]; then
    # Tabulate per-scenario PASS/FAIL/SKIPPED counts.
    # Skipped checks (universal opt-outs) count separately from real PASSes.
    PASSES=$(python3 -c "
import json, sys
m = json.load(open('$LATEST_RUN/metrics.json'))
checks = m.get('deterministic_pass', {})
ps = sum(1 for v in checks.values() if v.get('pass') and not v.get('skipped'))
fs = sum(1 for v in checks.values() if not v.get('pass'))
sk = sum(1 for v in checks.values() if v.get('skipped'))
print(f'{ps} {fs} {sk}')
" 2>/dev/null || echo "0 0 0")
    P=$(echo "$PASSES" | awk '{print $1}')
    F=$(echo "$PASSES" | awk '{print $2}')
    S=$(echo "$PASSES" | awk '{print $3}')
    TOTAL_DETERMINISTIC_PASS=$((TOTAL_DETERMINISTIC_PASS + P))
    TOTAL_DETERMINISTIC_FAIL=$((TOTAL_DETERMINISTIC_FAIL + F))
    TOTAL_DETERMINISTIC_SKIPPED=$((TOTAL_DETERMINISTIC_SKIPPED + S))
    if [ "$S" -gt 0 ]; then
      echo "  → $scenario: $P pass / $F fail / $S skipped (metrics: $LATEST_RUN/metrics.json)"
    else
      echo "  → $scenario: $P pass / $F fail (metrics: $LATEST_RUN/metrics.json)"
    fi
  fi
done

# Run lifecycle
LIFECYCLE_OUT="$AGGREGATE_DIR/lifecycle.log"
LIFECYCLE_EXIT=0
if ! $SKIP_LIFECYCLE; then
  echo ""
  echo "================================================================"
  echo ">>> Running lifecycle test"
  echo "================================================================"
  bash "$BENCH_DIR/lifecycle-test.sh" 2>&1 | tee "$LIFECYCLE_OUT" || LIFECYCLE_EXIT=$?
  # Use grep | wc -l to avoid the "0\n0" rendering bug from `grep -c || echo 0`
  # (grep -c outputs "0" on no-match AND exits 1, so the fallback "0" appended
  # to grep's already-emitted "0" producing "0\n0" in the report).
  LIFE_PASS=$(grep -c "^  PASS" "$LIFECYCLE_OUT" 2>/dev/null | tr -d '\n ')
  LIFE_PASS=${LIFE_PASS:-0}
  LIFE_FAIL=$(grep -c "^  FAIL" "$LIFECYCLE_OUT" 2>/dev/null | tr -d '\n ')
  LIFE_FAIL=${LIFE_FAIL:-0}
  echo "  → lifecycle: $LIFE_PASS pass / $LIFE_FAIL fail"
fi

# Aggregate report
REPORT="$AGGREGATE_DIR/report.md"
{
  echo "# Bench Aggregate Report — $RUN_TS"
  echo ""
  echo "## Summary"
  echo ""
  echo "| Layer | Pass | Fail | Skipped |"
  echo "|---|---|---|---|"
  echo "| Deterministic checks (across scenarios) | $TOTAL_DETERMINISTIC_PASS | $TOTAL_DETERMINISTIC_FAIL | $TOTAL_DETERMINISTIC_SKIPPED |"
  if ! $SKIP_LIFECYCLE; then
    echo "| Lifecycle | ${LIFE_PASS:-?} | ${LIFE_FAIL:-?} | 0 |"
  fi
  echo ""
  echo "## Per-scenario results"
  echo ""
  for scenario in "${SCENARIO_LIST[@]}"; do
    echo "### $scenario"
    LATEST_RUN=$(ls -dt "$BENCH_DIR"/runs/*-"$scenario"-* 2>/dev/null | head -1)
    if [ -n "$LATEST_RUN" ] && [ -f "$LATEST_RUN/metrics.json" ]; then
      python3 - <<EOF
import json
m = json.load(open('$LATEST_RUN/metrics.json'))
print(f"- Wallclock: {m.get('latency',{}).get('wallclock_seconds','?')}s")
print(f"- Turns: {m.get('turns','?')}")
tokens = m.get('tokens', {})
print(f"- Tokens: in={tokens.get('input','?')} out={tokens.get('output','?')} cache_read={tokens.get('cache_read','?')}")
print(f"- Sub-agent spawns: {m.get('subagent_spawns','?')} ({', '.join(m.get('subagent_types',[]))})")
print("")
print("**Deterministic checks:**")
print("")
for k, v in m.get('deterministic_pass', {}).items():
    mark = "PASS" if v.get('pass') else "FAIL"
    detail = v.get('detail', '')
    print(f"- {mark} {k} ({detail[:80]})")
print("")
print("**Soft signals:**")
print("")
for k, v in m.get('soft_signals', {}).items():
    mark = "YES" if v.get('observed') else "no"
    detail = v.get('detail', '')
    print(f"- {mark} {k} ({detail[:80]})")
print("")
EOF
    else
      echo ""
      echo "(no metrics.json found — scenario may have failed)"
      echo ""
    fi
  done
  echo ""
  echo "## Lifecycle test"
  echo ""
  if ! $SKIP_LIFECYCLE; then
    echo '```'
    cat "$LIFECYCLE_OUT"
    echo '```'
  else
    echo "Skipped."
  fi
} > "$REPORT"

echo ""
echo "================================================================"
echo "Aggregate complete. Report: $REPORT"
echo "================================================================"
cat "$REPORT" | grep -A20 "^## Summary"
