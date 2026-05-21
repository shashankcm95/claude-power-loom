#!/usr/bin/env bash
# bench/runner.sh — power-loom plugin verification runner (v2.4.0).
#
# Scenario-aware harness. Each scenario lives in bench/scenarios/<id>/ with:
#   task.md         — the task spec (extracted prompt)
#   fixture/        — working files claude operates on
#   expected.json   — deterministic_pass criteria + expected soft signals
#
# Usage:
#   bench/runner.sh                              # default: scenario 01-multi-feature-export
#   bench/runner.sh --scenario 02-security-audit # specific scenario
#   bench/runner.sh --bare                       # plugin-OFF run (v0.2+ — not wired yet)
#   bench/runner.sh --task <path>                # advanced: override task file path
#   bench/runner.sh --list                       # list available scenarios
#
# Requirements:
#   - `claude` CLI 2.1.140+ available on PATH
#   - `node` available on PATH
#   - Writable HOME for ~/.claude/ snapshot diffs

set -euo pipefail

BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLKIT_DIR="$(cd "$BENCH_DIR/.." && pwd)"
SCENARIO_ID="01-multi-feature-export"   # default scenario
MODE="plugin-on"
TIMEOUT_SECS=900   # 15-min wall budget per scenario

# --- arg parsing -------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --scenario) SCENARIO_ID="$2"; shift 2 ;;
    --bare) MODE="plugin-off-bare"; shift ;;
    --task) TASK_FILE_OVERRIDE="$2"; shift 2 ;;
    --timeout) TIMEOUT_SECS="$2"; shift 2 ;;
    --list)
      echo "Available scenarios:"
      for d in "$BENCH_DIR"/scenarios/*/; do
        [ -d "$d" ] || continue
        name=$(basename "$d")
        desc=$(python3 -c "import json; print(json.load(open('$d/expected.json')).get('description','?')[:100])" 2>/dev/null || echo "(no expected.json)")
        printf "  %-30s %s\n" "$name" "$desc"
      done
      exit 0 ;;
    --help|-h)
      sed -n '4,18p' "${BASH_SOURCE[0]}"
      exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# --- resolve scenario paths --------------------------------------------------
SCENARIO_DIR="$BENCH_DIR/scenarios/$SCENARIO_ID"
[ -d "$SCENARIO_DIR" ] || { echo "ERROR: scenario not found: $SCENARIO_DIR" >&2; echo "Use: bench/runner.sh --list" >&2; exit 3; }

TASK_FILE="${TASK_FILE_OVERRIDE:-$SCENARIO_DIR/task.md}"
FIXTURE_DIR="$SCENARIO_DIR/fixture"
EXPECTED_FILE="$SCENARIO_DIR/expected.json"

# --- preflight ---------------------------------------------------------------
command -v claude >/dev/null 2>&1 || { echo "ERROR: claude CLI not on PATH" >&2; exit 3; }
command -v node   >/dev/null 2>&1 || { echo "ERROR: node not on PATH"   >&2; exit 3; }
[ -f "$TASK_FILE" ] || { echo "ERROR: task file not found: $TASK_FILE" >&2; exit 3; }
[ -d "$FIXTURE_DIR" ] || { echo "ERROR: fixture not found: $FIXTURE_DIR" >&2; exit 3; }

# Extract the task prompt from the markdown task spec.
# Convention: the task is the blockquote (> ...) under "## The task" heading,
# terminating at the next "## " heading.
#
# NB: avoid `sub(/^> /, "")` BEFORE the in-section check — it mutates $0 and
# the subsequent !/^>/ rule fires a false reset. Use awk's substr() instead
# and check section termination FIRST.
TASK_PROMPT="$(awk '
  /^## The task/                  { in_section=1; next }
  /^## / && in_section            { in_section=0; next }
  in_section && /^>$/             { print ""; next }
  in_section && /^> /             { print substr($0, 3); next }
' "$TASK_FILE")"

if [ -z "$TASK_PROMPT" ]; then
  echo "ERROR: could not extract task prompt from $TASK_FILE (expected '## The task' section with '> ...' blockquote)" >&2
  exit 3
fi

# --- run directory + fixture snapshot ----------------------------------------
RUN_TS="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
RUN_DIR="$BENCH_DIR/runs/$RUN_TS-$SCENARIO_ID-$MODE"
mkdir -p "$RUN_DIR"
echo "Scenario: $SCENARIO_ID" >&2
echo "Run dir:  $RUN_DIR" >&2
echo "Mode:     $MODE" >&2

# Copy fixture to a working dir so claude operates on a clean copy without
# corrupting the canonical fixture. Each run gets fresh source.
WORK_DIR="$RUN_DIR/work"
cp -r "$FIXTURE_DIR" "$WORK_DIR"

# Snapshot ~/.claude/ counters + library state BEFORE the run.
PRE_SNAPSHOT="$RUN_DIR/pre-snapshot.json"
node "$BENCH_DIR/_snapshot.js" --out "$PRE_SNAPSHOT" || {
  echo "WARN: pre-snapshot failed (continuing)" >&2
}

# --- compose the claude -p invocation ----------------------------------------
# Task text references "fixture/" or "bench/scenarios/<id>/fixture/" — we
# rewrite both forms to point at the per-run WORK_DIR. This lets task.md
# stay readable while ensuring each run operates on a clean copy.
PROMPT_RESOLVED="$(echo "$TASK_PROMPT" | sed -e "s|bench/scenarios/$SCENARIO_ID/fixture|$WORK_DIR|g" -e "s|bench/fixture|$WORK_DIR|g")"

echo "Task prompt:" >&2
echo "  $PROMPT_RESOLVED" | head -3 >&2

CLAUDE_FLAGS=(
  -p "$PROMPT_RESOLVED"
  --output-format stream-json
  --verbose                                # required for stream-json
  --permission-mode bypassPermissions      # boot test runs unattended; no user to answer AskUserQuestion
)
if [ "$MODE" = "plugin-off-bare" ]; then
  CLAUDE_FLAGS+=( --bare )
fi

# --- execute -----------------------------------------------------------------
STREAM_FILE="$RUN_DIR/stream.jsonl"
STDERR_FILE="$RUN_DIR/stderr.log"

WALL_START=$(date +%s)
set +e
# `claude -p` doesn't have a built-in timeout; use shell timeout(1) where available.
if command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_CMD=(gtimeout "$TIMEOUT_SECS")
elif command -v timeout >/dev/null 2>&1; then
  TIMEOUT_CMD=(timeout "$TIMEOUT_SECS")
else
  TIMEOUT_CMD=()
fi
(cd "$WORK_DIR" && ${TIMEOUT_CMD[@]+"${TIMEOUT_CMD[@]}"} claude "${CLAUDE_FLAGS[@]}" > "$STREAM_FILE" 2> "$STDERR_FILE")
CLAUDE_EXIT=$?
set -e
WALL_END=$(date +%s)
WALL_SECS=$((WALL_END - WALL_START))

echo "claude exited: $CLAUDE_EXIT (wallclock: ${WALL_SECS}s)" >&2

# --- post-run snapshot -------------------------------------------------------
POST_SNAPSHOT="$RUN_DIR/post-snapshot.json"
node "$BENCH_DIR/_snapshot.js" --out "$POST_SNAPSHOT" || {
  echo "WARN: post-snapshot failed (continuing)" >&2
}

# --- collect metrics ---------------------------------------------------------
METRICS_FILE="$RUN_DIR/metrics.json"
node "$BENCH_DIR/collect.js" \
  --stream      "$STREAM_FILE" \
  --pre         "$PRE_SNAPSHOT" \
  --post        "$POST_SNAPSHOT" \
  --workdir     "$WORK_DIR" \
  --fixture     "$FIXTURE_DIR" \
  --wallclock-seconds "$WALL_SECS" \
  --claude-exit "$CLAUDE_EXIT" \
  --mode        "$MODE" \
  --scenario    "$SCENARIO_ID" \
  --expected    "$EXPECTED_FILE" \
  --out         "$METRICS_FILE" || {
  echo "ERROR: collect.js failed; partial outputs in $RUN_DIR" >&2
  exit 4
}

# --- report ------------------------------------------------------------------
echo "" >&2
echo "=== Boot Test Result ($MODE) ===" >&2
node -e "
const m = require('$METRICS_FILE');
console.log('Mode:           ' + m.mode);
console.log('Wallclock:      ' + m.latency.wallclock_seconds + 's');
console.log('API duration:   ' + (m.latency.duration_api_ms / 1000).toFixed(1) + 's');
console.log('Turns:          ' + m.turns);
console.log('Tokens (in):    ' + m.tokens.input);
console.log('Tokens (out):   ' + m.tokens.output);
console.log('Cache reads:    ' + m.tokens.cache_read);
console.log('Cache creation: ' + m.tokens.cache_creation);
console.log('Tool uses:      ' + JSON.stringify(m.tool_uses));
console.log('Sub-agent spawns: ' + m.subagent_spawns);
console.log('Hook bumps:     ' + JSON.stringify(m.hook_bumps));
console.log('Files modified: ' + m.fixture_diff.modified_files.length);
console.log('Files created:  ' + m.fixture_diff.created_files.length);
console.log('');
console.log('=== Deterministic PASS criteria ===');
for (const [k, v] of Object.entries(m.deterministic_pass)) {
  const label = v.skipped ? 'SKIP' : (v.pass ? 'PASS' : 'FAIL');
  console.log('  ' + label + '  ' + k + (v.detail ? '  (' + v.detail + ')' : ''));
}
// All-pass = every non-skipped check passes
const allPass = Object.values(m.deterministic_pass).every(v => v.skipped || v.pass);
console.log('');
console.log('=== Soft signals (informational; not gating) ===');
for (const [k, v] of Object.entries(m.soft_signals || {})) {
  console.log('  ' + (v.observed ? 'YES ' : 'no  ') + k + (v.detail ? '  (' + v.detail + ')' : ''));
}
console.log('');
console.log('OVERALL: ' + (allPass ? 'PASS' : 'FAIL'));
"

# v0.2 hook: if invoked twice (with + without --bare), diff the runs.
echo "" >&2
echo "Artifacts in: $RUN_DIR" >&2
