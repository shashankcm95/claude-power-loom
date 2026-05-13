#!/bin/bash
set -euo pipefail

# claude-toolkit installer
# Copies selected components into ~/.claude/ for global use.
#
# *** LEGACY INSTALL PATH (H.7.22) ***
# This installer is kept as a FALLBACK for environments without Claude Code's
# plugin system (e.g., shell-only setup, CI provisioning). The CANONICAL install
# path is now via the Claude Code plugin marketplace:
#
#   /plugin install power-loom@power-loom-marketplace
#
# Plugin installs auto-resolve hook paths via ${CLAUDE_PLUGIN_ROOT}, get
# automatic /plugin update support, and don't require manual settings.json
# wiring. install.sh is retained for legacy use cases and CI smoke testing.
# See README.md "Install" section for the plugin-vs-legacy decision tree.

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
  # Phase-G10: nullglob prevents silent abort under set -e if dir is empty
  shopt -s nullglob
  hook_files=("$SCRIPT_DIR"/hooks/scripts/*.js)
  shopt -u nullglob
  if [ ${#hook_files[@]} -eq 0 ]; then
    echo "  WARNING: no hook scripts found in $SCRIPT_DIR/hooks/scripts/"
    return
  fi
  cp "${hook_files[@]}" "$CLAUDE_DIR/hooks/scripts/"
  chmod +x "$CLAUDE_DIR"/hooks/scripts/*.js
  # H.7.12: also copy validators/ subdirectory (and _lib/ if present).
  # Previously only top-level *.js were copied — the validator family at
  # validators/ was unreachable via legacy installer + smoke tests.
  if [ -d "$SCRIPT_DIR/hooks/scripts/validators" ]; then
    mkdir -p "$CLAUDE_DIR/hooks/scripts/validators"
    shopt -s nullglob
    validator_files=("$SCRIPT_DIR"/hooks/scripts/validators/*.js)
    shopt -u nullglob
    if [ ${#validator_files[@]} -gt 0 ]; then
      cp "${validator_files[@]}" "$CLAUDE_DIR/hooks/scripts/validators/"
      chmod +x "$CLAUDE_DIR"/hooks/scripts/validators/*.js
    fi
  fi
  if [ -d "$SCRIPT_DIR/hooks/scripts/_lib" ]; then
    mkdir -p "$CLAUDE_DIR/hooks/scripts/_lib"
    shopt -s nullglob
    lib_files=("$SCRIPT_DIR"/hooks/scripts/_lib/*.js)
    shopt -u nullglob
    if [ ${#lib_files[@]} -gt 0 ]; then
      cp "${lib_files[@]}" "$CLAUDE_DIR/hooks/scripts/_lib/"
    fi
  fi
  # Phase D: also copy config-guard-patterns.json (data file used by config-guard.js)
  if [ -f "$SCRIPT_DIR/hooks/config-guard-patterns.json" ]; then
    cp "$SCRIPT_DIR/hooks/config-guard-patterns.json" "$CLAUDE_DIR/hooks/"
    echo "  -> config-guard-patterns.json installed"
  fi
  # Phase F3: install scripts/ (CLI utilities, not hooks)
  if [ -d "$SCRIPT_DIR/scripts" ]; then
    mkdir -p "$CLAUDE_DIR/scripts"
    for f in "$SCRIPT_DIR"/scripts/*.js; do
      [ -f "$f" ] && cp "$f" "$CLAUDE_DIR/scripts/" && chmod +x "$CLAUDE_DIR/scripts/$(basename "$f")"
    done
    for f in "$SCRIPT_DIR"/scripts/*.sh; do
      [ -f "$f" ] && cp "$f" "$CLAUDE_DIR/scripts/" && chmod +x "$CLAUDE_DIR/scripts/$(basename "$f")"
    done
    echo "  -> CLI scripts installed to $CLAUDE_DIR/scripts/"
  fi
  # publish-polish-H.0: install scripts/agent-team/ (HETS substrate — was previously
  # only synced via per-phase manual cp; legacy installer now mirrors it explicitly).
  # Plugin install path resolves these via ${CLAUDE_PLUGIN_ROOT} so it doesn't need
  # this step — but legacy installer users now get the HETS infrastructure too.
  if [ -d "$SCRIPT_DIR/scripts/agent-team" ]; then
    mkdir -p "$CLAUDE_DIR/scripts/agent-team/_lib"
    for f in "$SCRIPT_DIR"/scripts/agent-team/*.js; do
      [ -f "$f" ] && cp "$f" "$CLAUDE_DIR/scripts/agent-team/" && chmod +x "$CLAUDE_DIR/scripts/agent-team/$(basename "$f")"
    done
    if [ -d "$SCRIPT_DIR/scripts/agent-team/_lib" ]; then
      for f in "$SCRIPT_DIR"/scripts/agent-team/_lib/*.js; do
        [ -f "$f" ] && cp "$f" "$CLAUDE_DIR/scripts/agent-team/_lib/"
      done
    fi
    echo "  -> HETS scripts installed to $CLAUDE_DIR/scripts/agent-team/"
  fi
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

  # HT.1.4 — phase-era source decomposition per ADR-0002 cross-language
  # application (bash sourced-file post-split shape). Each tests/smoke-hN.sh
  # file contains verbatim test bodies extracted from the pre-HT.1.4
  # 1188-LoC monolithic body; mutates parent-scope passed/failed counters
  # via bash lexical-scope inheritance. Source order preserves execution
  # order: tests 1-68 → 69-70 → 65 trailer (per HT.0.7 audit anomaly
  # preservation; test 65 is the intentional H.8.7 trailer position).
  source "$SCRIPT_DIR/tests/smoke-h4.sh"
  source "$SCRIPT_DIR/tests/smoke-h7.sh"
  source "$SCRIPT_DIR/tests/smoke-h8.sh"
  source "$SCRIPT_DIR/tests/smoke-ht.sh"
  # H.9.21 v2.1.0 library-memory-organizer smoke (Component J — 6 named scenarios).
  # smoke-library-init.sh (T105 J1) + smoke-library-migrate.sh (T106/T107/T110
  # J2/J3/J6 — stub until Sub-phase 4) + smoke-library-concurrent.sh (T108/T109
  # J4/J5 — fully implemented).
  source "$SCRIPT_DIR/tests/smoke-library-init.sh"
  source "$SCRIPT_DIR/tests/smoke-library-migrate.sh"
  source "$SCRIPT_DIR/tests/smoke-library-concurrent.sh"


  echo ""
  echo "  Results: $passed passed, $failed failed"
  [ "$failed" -gt 0 ] && echo "  Some tests failed — check hook scripts and paths"
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
