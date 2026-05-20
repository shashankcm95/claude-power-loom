#!/usr/bin/env bash
# bench/runner.sh — power-loom plugin boot-test runner (v0.1).
#
# v0.1 scope: plugin-ON side only. Runs the boot task headlessly, captures
# stream-json + counter diffs + filesystem deltas, hands off to collect.js for
# metrics extraction. v0.2 will add --bare baseline + diff report.
#
# Usage:
#   bench/runner.sh                 # plugin-ON run; writes bench/runs/<ts>/
#   bench/runner.sh --bare          # plugin-OFF run (v0.2 — not wired yet)
#   bench/runner.sh --task <path>   # override boot task path (default: bench/boot-task.md)
#
# Requirements:
#   - `claude` CLI 2.1.140+ available on PATH
#   - `node` available on PATH
#   - Writable HOME for ~/.claude/ snapshot diffs

set -euo pipefail

BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLKIT_DIR="$(cd "$BENCH_DIR/.." && pwd)"
FIXTURE_DIR="$BENCH_DIR/fixture"
TASK_FILE="$BENCH_DIR/boot-task.md"
MODE="plugin-on"
TIMEOUT_SECS=900   # 15-min wall budget; boot task should be well under this

# --- arg parsing -------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --bare) MODE="plugin-off-bare"; shift ;;
    --task) TASK_FILE="$2"; shift 2 ;;
    --timeout) TIMEOUT_SECS="$2"; shift 2 ;;
    --help|-h)
      sed -n '4,18p' "${BASH_SOURCE[0]}"
      exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# --- preflight ---------------------------------------------------------------
command -v claude >/dev/null 2>&1 || { echo "ERROR: claude CLI not on PATH" >&2; exit 3; }
command -v node   >/dev/null 2>&1 || { echo "ERROR: node not on PATH"   >&2; exit 3; }
[ -f "$TASK_FILE" ] || { echo "ERROR: task file not found: $TASK_FILE" >&2; exit 3; }
[ -d "$FIXTURE_DIR" ] || { echo "ERROR: fixture not found: $FIXTURE_DIR" >&2; exit 3; }

# Extract the task prompt from the markdown task spec.
# Convention: the task is the first blockquote (> ...) under "## The task" heading.
TASK_PROMPT="$(awk '
  /^## The task/ { in_section=1; next }
  in_section && /^> / { sub(/^> /,""); print }
  in_section && !/^>/ && /^[^[:space:]]/ { in_section=0 }
' "$TASK_FILE")"

if [ -z "$TASK_PROMPT" ]; then
  echo "ERROR: could not extract task prompt from $TASK_FILE (expected '## The task' section with '> ...' blockquote)" >&2
  exit 3
fi

# --- run directory + fixture snapshot ----------------------------------------
RUN_TS="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
RUN_DIR="$BENCH_DIR/runs/$RUN_TS-$MODE"
mkdir -p "$RUN_DIR"
echo "Boot test run: $RUN_DIR" >&2
echo "Mode: $MODE" >&2

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
# Boot task references "bench/fixture/" but we redirect Claude to the WORK_DIR
# instead by changing the prompt's path reference.
PROMPT_RESOLVED="$(echo "$TASK_PROMPT" | sed "s|bench/fixture|$WORK_DIR|g")"

echo "Task prompt:" >&2
echo "  $PROMPT_RESOLVED" | head -3 >&2

CLAUDE_FLAGS=(
  -p "$PROMPT_RESOLVED"
  --output-format stream-json
  --verbose                            # required for stream-json
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
  --stream  "$STREAM_FILE" \
  --pre     "$PRE_SNAPSHOT" \
  --post    "$POST_SNAPSHOT" \
  --workdir "$WORK_DIR" \
  --fixture "$FIXTURE_DIR" \
  --wallclock-seconds "$WALL_SECS" \
  --claude-exit "$CLAUDE_EXIT" \
  --mode    "$MODE" \
  --out     "$METRICS_FILE" || {
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
  console.log('  ' + (v.pass ? 'PASS' : 'FAIL') + '  ' + k + (v.detail ? '  (' + v.detail + ')' : ''));
}
const allPass = Object.values(m.deterministic_pass).every(v => v.pass);
console.log('');
console.log('OVERALL: ' + (allPass ? 'PASS' : 'FAIL'));
"

# v0.2 hook: if invoked twice (with + without --bare), diff the runs.
echo "" >&2
echo "Artifacts in: $RUN_DIR" >&2
