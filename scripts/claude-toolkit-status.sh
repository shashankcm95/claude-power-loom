#!/bin/bash
# claude-toolkit-status — diagnose what's actually working
# Run this anytime to see ground truth on hooks, library substrate, and recent activity.

set -uo pipefail

CLAUDE_DIR="$HOME/.claude"
LOG_DIR="$CLAUDE_DIR/logs"

YELLOW='\033[1;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

ok()    { printf "  ${GREEN}✓${RESET} %s\n" "$1"; }
fail()  { printf "  ${RED}✗${RESET} %s\n" "$1"; }
warn()  { printf "  ${YELLOW}⚠${RESET} %s\n" "$1"; }
info()  { printf "  ${DIM}·${RESET} %s\n" "$1"; }
section() { printf "\n${BOLD}%s${RESET}\n" "$1"; }

printf "${BOLD}Claude Toolkit Status${RESET}\n"
printf "${DIM}%s${RESET}\n" "$(date)"

# === Files ===
section "Component installation"
[ -d "$CLAUDE_DIR/agents" ] && ok "agents/ ($(ls "$CLAUDE_DIR/agents" 2>/dev/null | wc -l | tr -d ' ') files)" || fail "agents/ missing"
[ -d "$CLAUDE_DIR/rules/toolkit" ] && ok "rules/toolkit/ ($(find "$CLAUDE_DIR/rules/toolkit" -name '*.md' 2>/dev/null | wc -l | tr -d ' ') files)" || fail "rules/toolkit/ missing"
[ -d "$CLAUDE_DIR/hooks/scripts" ] && ok "hooks/scripts/ ($(ls "$CLAUDE_DIR/hooks/scripts"/*.js 2>/dev/null | wc -l | tr -d ' ') scripts)" || fail "hooks/scripts/ missing"
[ -d "$CLAUDE_DIR/commands" ] && ok "commands/ ($(ls "$CLAUDE_DIR/commands" 2>/dev/null | wc -l | tr -d ' ') files)" || fail "commands/ missing"
[ -d "$CLAUDE_DIR/skills" ] && ok "skills/ ($(ls "$CLAUDE_DIR/skills" 2>/dev/null | wc -l | tr -d ' ') skills)" || fail "skills/ missing"

# === settings.json hooks ===
section "Configured hooks (settings.json)"
if [ -f "$CLAUDE_DIR/settings.json" ]; then
  local_hooks=$(node -e "
    try {
      const s = require('$CLAUDE_DIR/settings.json');
      if (!s.hooks) { console.log('NONE'); process.exit(0); }
      Object.entries(s.hooks).forEach(([event, entries]) => {
        entries.forEach(e => {
          const cmd = e.hooks[0] && e.hooks[0].command || '';
          const script = cmd.match(/[a-z-]+\.js/);
          console.log(event + ':' + (e.id || '?') + ':' + (script ? script[0] : '?'));
        });
      });
    } catch(e) { console.log('ERROR:' + e.message); }
  " 2>/dev/null)

  if [ -z "$local_hooks" ] || [ "$local_hooks" = "NONE" ]; then
    fail "settings.json has no hooks configured"
  else
    while IFS= read -r line; do
      info "$line"
    done <<< "$local_hooks"
  fi
else
  fail "settings.json missing"
fi

# === Library memory organizer (v2.1.0+) ===
section "Library memory organizer"
LIBRARY_ROOT="$CLAUDE_DIR/library"
LIBRARY_MANIFEST="$LIBRARY_ROOT/library.json"
MIGRATE_SENTINEL="$LIBRARY_ROOT/.migrate-complete"
if [ -f "$LIBRARY_MANIFEST" ]; then
  ok "library initialized at $LIBRARY_ROOT"
  if [ -f "$MIGRATE_SENTINEL" ]; then
    ok "migration sentinel present (.migrate-complete) — legacy paths symlinked to library volumes"
  else
    warn "no .migrate-complete sentinel — run 'node scripts/library-migrate.js migrate' to symlink legacy paths"
  fi
  PARTITION_SENTINEL="$LIBRARY_ROOT/.partition-complete"
  if [ -f "$PARTITION_SENTINEL" ]; then
    ok "bulkhead mode active (.partition-complete) — per-persona file partition enabled"
  else
    warn "pre-bulkhead mode — agents stack uses v2.1.0 consolidated.json; optional: 'node scripts/library-migrate.js partition-personas'"
  fi
else
  fail "library not initialized — run 'node scripts/library.js init' (required by pre-compact-save.js v2.1.0+)"
fi

# === Hook activity logs ===
section "Recent hook activity (last 24h)"
if [ -d "$LOG_DIR" ]; then
  shopt -s nullglob
  log_files=("$LOG_DIR"/*.log)
  shopt -u nullglob
  if [ ${#log_files[@]} -eq 0 ]; then
    warn "No log files in ~/.claude/logs/ — hooks may not be firing"
  else
    # Phase-E6: extract date detection so failures are visible (not
    # silently swallowed inside a $(...) substitution that inflates
    # last_24h to total).
    cutoff=""
    if date -u -v-24H +%Y-%m-%dT%H:%M:%S >/dev/null 2>&1; then
      cutoff=$(date -u -v-24H +%Y-%m-%dT%H:%M:%S)
    elif date -u --date='24 hours ago' +%Y-%m-%dT%H:%M:%S >/dev/null 2>&1; then
      cutoff=$(date -u --date='24 hours ago' +%Y-%m-%dT%H:%M:%S)
    else
      warn "Unable to determine 24h cutoff (BSD/GNU date both failed) — showing total only"
    fi

    for log_file in "${log_files[@]}"; do
      log_name=$(basename "$log_file" .log)
      total=$(wc -l < "$log_file" | tr -d ' ')
      if [ -n "$cutoff" ]; then
        last_24h=$(awk -v cutoff="$cutoff" '$0 >= "[" cutoff' "$log_file" | wc -l | tr -d ' ')
        info "$log_name: $total total, $last_24h in last 24h"
      else
        info "$log_name: $total total"
      fi
      last_entry=$(tail -1 "$log_file" 2>/dev/null | cut -c1-120)
      [ -n "$last_entry" ] && info "  last: $last_entry"
    done
  fi
else
  warn "$LOG_DIR doesn't exist — no hook has logged anything"
fi

# === Local fallback files ===
section "Local fallbacks"
[ -f "$CLAUDE_DIR/prompt-patterns.json" ] && ok "prompt-patterns.json exists ($(wc -c < "$CLAUDE_DIR/prompt-patterns.json" | tr -d ' ') bytes)" || warn "prompt-patterns.json missing (no patterns learned yet)"
[ -d "$CLAUDE_DIR/checkpoints" ] && ok "checkpoints/ exists ($(ls "$CLAUDE_DIR/checkpoints" 2>/dev/null | wc -l | tr -d ' ') files)" || warn "checkpoints/ missing"

# === Quick smoke check ===
section "Live hook smoke checks"
if command -v node &>/dev/null; then
  # fact-force-gate
  result=$(echo '{"tool_name":"Edit","tool_input":{"file_path":"/tmp/never-read-test.txt"}}' | node "$CLAUDE_DIR/hooks/scripts/fact-force-gate.js" 2>/dev/null || true)
  if echo "$result" | grep -q '"decision":"block"'; then
    ok "fact-force-gate blocks unread file edits"
  else
    fail "fact-force-gate not working: $result"
  fi

  # prompt-enrich-trigger
  result=$(echo '{"prompt":"fix the auth"}' | node "$CLAUDE_DIR/hooks/scripts/prompt-enrich-trigger.js" 2>/dev/null || true)
  if echo "$result" | grep -q "PROMPT-ENRICHMENT-GATE"; then
    ok "prompt-enrich-trigger flags vague prompts"
  else
    fail "prompt-enrich-trigger not working"
  fi
else
  warn "node not on PATH — can't run smoke checks"
fi

section "Summary"
printf "  ${DIM}Detailed logs at: ${RESET}%s\n" "$LOG_DIR"
printf "  ${DIM}Hook configs at: ${RESET}%s\n" "$CLAUDE_DIR/settings.json"
printf "\n"
