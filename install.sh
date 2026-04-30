#!/bin/bash
set -euo pipefail

# claude-toolkit installer
# Copies selected components into ~/.claude/ for global use.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
DRY_RUN=false
BACKUP=false

usage() {
  echo "Usage: $0 [OPTIONS] [COMPONENTS]"
  echo ""
  echo "Components:"
  echo "  --all        Install everything"
  echo "  --agents     Install agent definitions"
  echo "  --rules      Install coding rules/guardrails"
  echo "  --hooks      Install hook scripts"
  echo "  --commands   Install slash commands"
  echo "  --skills     Install skill workflows"
  echo ""
  echo "Options:"
  echo "  --diff       Preview changes without installing (dry run)"
  echo "  --backup     Back up existing ~/.claude/ before overwriting"
  echo "  --test       Run hook smoke tests after installation"
  echo ""
  echo "Multiple flags can be combined: $0 --backup --all --test"
  echo "With no flags, shows this help."
  exit 0
}

backup_existing() {
  local timestamp
  timestamp=$(date +%Y%m%d-%H%M%S)
  local backup_dir="$CLAUDE_DIR/backups/backup-$timestamp"
  echo "Backing up existing installation..."
  mkdir -p "$backup_dir"
  for dir in agents rules hooks commands skills; do
    if [ -d "$CLAUDE_DIR/$dir" ]; then
      cp -r "$CLAUDE_DIR/$dir" "$backup_dir/$dir"
    fi
  done
  echo "  -> Backup saved to $backup_dir"
}

diff_component() {
  local src="$1"
  local dest="$2"
  local label="$3"

  if [ -f "$src" ]; then
    if [ -f "$dest" ]; then
      local changes
      changes=$(diff -u "$dest" "$src" 2>/dev/null || true)
      if [ -n "$changes" ]; then
        echo "  MODIFIED: $label"
        echo "$changes" | head -20
        [ "$(echo "$changes" | wc -l)" -gt 20 ] && echo "  ... (truncated)"
      fi
    else
      echo "  NEW: $label"
    fi
  fi
}

install_agents() {
  if $DRY_RUN; then
    echo "[DRY RUN] Agents:"
    for f in "$SCRIPT_DIR"/agents/*.md; do
      diff_component "$f" "$CLAUDE_DIR/agents/$(basename "$f")" "agents/$(basename "$f")"
    done
    return
  fi
  echo "Installing agents..."
  mkdir -p "$CLAUDE_DIR/agents"
  cp "$SCRIPT_DIR"/agents/*.md "$CLAUDE_DIR/agents/"
  echo "  -> $(ls "$SCRIPT_DIR"/agents/*.md | wc -l | tr -d ' ') agents installed"
}

install_rules() {
  if $DRY_RUN; then
    echo "[DRY RUN] Rules:"
    find "$SCRIPT_DIR/rules" -name '*.md' | while read -r f; do
      local rel="${f#"$SCRIPT_DIR"/rules/}"
      diff_component "$f" "$CLAUDE_DIR/rules/toolkit/$rel" "rules/$rel"
    done
    return
  fi
  echo "Installing rules..."
  mkdir -p "$CLAUDE_DIR/rules/toolkit"
  cp -r "$SCRIPT_DIR"/rules/* "$CLAUDE_DIR/rules/toolkit/"
  echo "  -> Rules installed to ~/.claude/rules/toolkit/"
}

install_hooks() {
  if $DRY_RUN; then
    echo "[DRY RUN] Hooks:"
    for f in "$SCRIPT_DIR"/hooks/scripts/*.js; do
      diff_component "$f" "$CLAUDE_DIR/hooks/scripts/$(basename "$f")" "hooks/scripts/$(basename "$f")"
    done
    return
  fi
  echo "Installing hooks..."
  mkdir -p "$CLAUDE_DIR/hooks/scripts"
  cp "$SCRIPT_DIR"/hooks/scripts/*.js "$CLAUDE_DIR/hooks/scripts/"
  chmod +x "$CLAUDE_DIR"/hooks/scripts/*.js
  echo "  -> Hook scripts installed"
  echo ""
  echo "  NOTE: Hook configuration must be manually merged."
  echo "  See hooks/settings-reference.json for the configuration template."
  echo "  Replace HOME_DIR with your actual home directory path."
}

install_commands() {
  if $DRY_RUN; then
    echo "[DRY RUN] Commands:"
    for f in "$SCRIPT_DIR"/commands/*.md; do
      diff_component "$f" "$CLAUDE_DIR/commands/$(basename "$f")" "commands/$(basename "$f")"
    done
    return
  fi
  echo "Installing commands..."
  mkdir -p "$CLAUDE_DIR/commands"
  cp "$SCRIPT_DIR"/commands/*.md "$CLAUDE_DIR/commands/"
  echo "  -> $(ls "$SCRIPT_DIR"/commands/*.md | wc -l | tr -d ' ') commands installed"
}

install_skills() {
  if $DRY_RUN; then
    echo "[DRY RUN] Skills:"
    find "$SCRIPT_DIR/skills" -name 'SKILL.md' | while read -r f; do
      local rel="${f#"$SCRIPT_DIR"/}"
      diff_component "$f" "$CLAUDE_DIR/$rel" "$rel"
    done
    return
  fi
  echo "Installing skills..."
  mkdir -p "$CLAUDE_DIR/skills"
  cp -r "$SCRIPT_DIR"/skills/* "$CLAUDE_DIR/skills/"
  echo "  -> Skills installed to ~/.claude/skills/"
}

run_smoke_tests() {
  echo ""
  echo "Running hook smoke tests..."
  local passed=0
  local failed=0

  # Test 1: fact-force-gate blocks unread file
  local result
  result=$(echo '{"tool_name":"Edit","tool_input":{"file_path":"/tmp/test-fact-gate-unread.txt"}}' | node "$CLAUDE_DIR/hooks/scripts/fact-force-gate.js" 2>/dev/null)
  if echo "$result" | grep -q '"decision":"block"'; then
    echo "  ✓ fact-force-gate: blocks unread existing file"
    passed=$((passed + 1))
  else
    echo "  ✗ fact-force-gate: FAILED to block unread file"
    failed=$((failed + 1))
  fi

  # Test 2: fact-force-gate allows new file
  result=$(echo '{"tool_name":"Write","tool_input":{"file_path":"/tmp/nonexistent-test-file-99999.txt"}}' | node "$CLAUDE_DIR/hooks/scripts/fact-force-gate.js" 2>/dev/null)
  if echo "$result" | grep -q '"decision":"approve"'; then
    echo "  ✓ fact-force-gate: allows new file creation"
    passed=$((passed + 1))
  else
    echo "  ✗ fact-force-gate: FAILED to allow new file"
    failed=$((failed + 1))
  fi

  # Test 3: config-guard blocks eslintrc
  result=$(echo '{"tool_name":"Edit","tool_input":{"file_path":"/app/.eslintrc.json"}}' | node "$CLAUDE_DIR/hooks/scripts/config-guard.js" 2>/dev/null)
  if echo "$result" | grep -q '"decision":"block"'; then
    echo "  ✓ config-guard: blocks .eslintrc edits"
    passed=$((passed + 1))
  else
    echo "  ✗ config-guard: FAILED to block .eslintrc"
    failed=$((failed + 1))
  fi

  # Test 4: config-guard allows normal files
  result=$(echo '{"tool_name":"Edit","tool_input":{"file_path":"/app/src/index.ts"}}' | node "$CLAUDE_DIR/hooks/scripts/config-guard.js" 2>/dev/null)
  if echo "$result" | grep -q '"decision":"approve"'; then
    echo "  ✓ config-guard: allows normal file edits"
    passed=$((passed + 1))
  else
    echo "  ✗ config-guard: FAILED to allow normal file"
    failed=$((failed + 1))
  fi

  # Test 5: session-reset creates tracker (use node to resolve tmpdir)
  local tmpdir
  tmpdir=$(node -e "process.stdout.write(require('os').tmpdir())")
  CLAUDE_SESSION_ID="smoke-test" node "$CLAUDE_DIR/hooks/scripts/session-reset.js" 2>/dev/null
  if [ -f "$tmpdir/claude-read-tracker-smoke-test.json" ]; then
    echo "  ✓ session-reset: creates tracker file"
    rm -f "$tmpdir/claude-read-tracker-smoke-test.json"
    passed=$((passed + 1))
  else
    echo "  ✗ session-reset: FAILED to create tracker"
    failed=$((failed + 1))
  fi

  # Test 6: notify-waiting passes input through and writes cooldown
  rm -f "$tmpdir/claude-notify-waiting-cooldown.json"
  local notify_result
  notify_result=$(echo '{"notification_type":"permission_prompt","notification_data":{"tool_name":"TestTool"}}' | CLAUDE_NOTIFY_ALWAYS=1 node "$CLAUDE_DIR/hooks/scripts/notify-waiting.js" 2>/dev/null)
  if [ -n "$notify_result" ] && [ -f "$tmpdir/claude-notify-waiting-cooldown.json" ]; then
    echo "  ✓ notify-waiting: passes input through and records cooldown"
    rm -f "$tmpdir/claude-notify-waiting-cooldown.json"
    passed=$((passed + 1))
  else
    echo "  ✗ notify-waiting: FAILED (no output or no cooldown file)"
    failed=$((failed + 1))
  fi

  # Test 7: prompt-enrich-trigger flags vague prompts
  local vague_result
  vague_result=$(echo '{"prompt":"fix the auth"}' | node "$CLAUDE_DIR/hooks/scripts/prompt-enrich-trigger.js" 2>/dev/null)
  if echo "$vague_result" | grep -q 'PROMPT-ENRICHMENT-GATE'; then
    echo "  ✓ prompt-enrich-trigger: flags vague prompt"
    passed=$((passed + 1))
  else
    echo "  ✗ prompt-enrich-trigger: FAILED to flag vague prompt"
    failed=$((failed + 1))
  fi

  # Test 8: prompt-enrich-trigger skips clear prompts
  local clear_result
  clear_result=$(echo '{"prompt":"git push origin main"}' | node "$CLAUDE_DIR/hooks/scripts/prompt-enrich-trigger.js" 2>/dev/null)
  if [ -z "$clear_result" ]; then
    echo "  ✓ prompt-enrich-trigger: skips clear prompt"
    passed=$((passed + 1))
  else
    echo "  ✗ prompt-enrich-trigger: false-positive on clear prompt"
    failed=$((failed + 1))
  fi

  echo ""
  echo "  Results: $passed passed, $failed failed"
  [ "$failed" -gt 0 ] && echo "  ⚠ Some tests failed — check hook scripts and paths"
}

if [ $# -eq 0 ]; then
  usage
fi

INSTALL_AGENTS=false
INSTALL_RULES=false
INSTALL_HOOKS=false
INSTALL_COMMANDS=false
INSTALL_SKILLS=false
RUN_TESTS=false

for arg in "$@"; do
  case $arg in
    --all)
      INSTALL_AGENTS=true
      INSTALL_RULES=true
      INSTALL_HOOKS=true
      INSTALL_COMMANDS=true
      INSTALL_SKILLS=true
      ;;
    --agents)   INSTALL_AGENTS=true ;;
    --rules)    INSTALL_RULES=true ;;
    --hooks)    INSTALL_HOOKS=true ;;
    --commands) INSTALL_COMMANDS=true ;;
    --skills)   INSTALL_SKILLS=true ;;
    --diff)     DRY_RUN=true ;;
    --backup)   BACKUP=true ;;
    --test)     RUN_TESTS=true ;;
    --help|-h)  usage ;;
    *)
      echo "Unknown option: $arg"
      usage
      ;;
  esac
done

echo "claude-toolkit installer"
echo "========================"
echo ""

if $DRY_RUN; then
  echo "DRY RUN MODE — showing what would change"
  echo ""
fi

if $BACKUP && ! $DRY_RUN; then
  backup_existing
  echo ""
fi

$INSTALL_AGENTS  && install_agents
$INSTALL_RULES   && install_rules
$INSTALL_HOOKS   && install_hooks
$INSTALL_COMMANDS && install_commands
$INSTALL_SKILLS  && install_skills

if $RUN_TESTS && ! $DRY_RUN; then
  if ! $INSTALL_HOOKS; then
    echo "  NOTE: --test without --hooks tests already-installed hooks, not source."
    echo "  Pass --hooks --test to install first, then test."
  fi
  run_smoke_tests
fi

echo ""
if $DRY_RUN; then
  echo "Dry run complete. Run without --diff to install."
else
  echo "Done! Restart Claude Code to pick up the changes."
fi
