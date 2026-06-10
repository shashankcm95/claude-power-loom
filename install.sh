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
  # Phase 0 (v3.0-alpha): source moved rules/ → packages/skills/rules/. Install
  # target unchanged (~/.claude/rules/toolkit/) — Claude Code convention.
  local rules_src="$SCRIPT_DIR/packages/skills/rules"
  if $DRY_RUN; then
    echo "[DRY RUN] Rules:"
    find "$rules_src" -name '*.md' | while read -r f; do
      local rel="${f#"$rules_src"/}"
      diff_component "$f" "$CLAUDE_DIR/rules/toolkit/$rel" "rules/$rel"
    done
    return
  fi
  echo "Installing rules..."
  mkdir -p "$CLAUDE_DIR/rules/toolkit"
  cp -r "$rules_src"/* "$CLAUDE_DIR/rules/toolkit/"
  echo "  -> Rules installed to ~/.claude/rules/toolkit/"
}

install_hooks() {
  # Phase 0 (v3.0-alpha): mirror the new packages/kernel + packages/runtime layout
  # to ~/.claude/packages/. The plugin install path uses ${CLAUDE_PLUGIN_ROOT} so
  # it resolves from the plugin-managed source tree directly — this legacy path
  # mirror is for shell-only / CI use.
  #
  # settings-reference.json (already updated in Step 5) points hook commands at
  # HOME_DIR/.claude/packages/kernel/hooks/... so this mirror is the layout users
  # need for the legacy install path to actually work.
  local k_src="$SCRIPT_DIR/packages/kernel"
  local r_src="$SCRIPT_DIR/packages/runtime"
  local k_dst="$CLAUDE_DIR/packages/kernel"
  local r_dst="$CLAUDE_DIR/packages/runtime"

  if $DRY_RUN; then
    echo "[DRY RUN] Hooks (kernel hooks + validators):"
    find "$k_src/hooks" -name '*.js' 2>/dev/null | while read -r f; do
      local rel="${f#"$k_src"/}"
      diff_component "$f" "$k_dst/$rel" "packages/kernel/$rel"
    done
    find "$k_src/validators" -name '*.js' 2>/dev/null | while read -r f; do
      diff_component "$f" "$k_dst/validators/$(basename "$f")" "packages/kernel/validators/$(basename "$f")"
    done
    echo "[DRY RUN] Note: --diff --hooks shows kernel/hooks + kernel/validators only."
    echo "[DRY RUN]       Full install also copies kernel/{_lib,recall,spawn-state,algorithms,schema},"
    echo "[DRY RUN]       runtime/{orchestration,contracts,personas,schema}, root scripts/,"
    echo "[DRY RUN]       and back-compat ~/.claude/scripts/{loom-recall,self-improve-store,prompt-pattern-store}.js"
    echo "[DRY RUN]       + back-compat ~/.claude/_lib/ (kernel _lib helpers for entrypoint resolution)."
    return
  fi

  echo "Installing kernel substrate (hooks + validators + _lib + recall + spawn-state + algorithms)..."

  # 1. kernel/hooks/ — split into pre/post/lifecycle/ + hooks/_lib/
  # Phase-1-alpha/0a (SC2206): quote $sub inside array-glob; nullglob handles
  # the *.js expansion. Original `"$k_src"/hooks/$sub/*.js` left $sub unquoted
  # which exposed it to word-splitting if $sub ever contained whitespace
  # (defensive — current values are safe literal strings).
  mkdir -p "$k_dst/hooks/pre" "$k_dst/hooks/post" "$k_dst/hooks/lifecycle" "$k_dst/hooks/_lib"
  shopt -s nullglob
  for sub in pre post lifecycle _lib; do
    files=("$k_src/hooks/$sub"/*.js)
    if [ ${#files[@]} -gt 0 ]; then
      cp "${files[@]}" "$k_dst/hooks/$sub/"
      # _lib is library code — no +x; hook entrypoints are +x
      [ "$sub" != "_lib" ] && chmod +x "$k_dst/hooks/$sub"/*.js
    fi
  done
  shopt -u nullglob

  # 2. kernel/validators/ (formerly hooks/scripts/validators/ — now hosts contract-verifier.js too)
  mkdir -p "$k_dst/validators"
  shopt -s nullglob
  validator_files=("$k_src"/validators/*.js)
  shopt -u nullglob
  if [ ${#validator_files[@]} -gt 0 ]; then
    cp "${validator_files[@]}" "$k_dst/validators/"
    chmod +x "$k_dst"/validators/*.js
  fi

  # 3. kernel/_lib/ (shared substrate primitives — frontmatter, lock, atomic-write, etc.)
  mkdir -p "$k_dst/_lib"
  shopt -s nullglob
  klib_files=("$k_src"/_lib/*.js)
  shopt -u nullglob
  if [ ${#klib_files[@]} -gt 0 ]; then
    cp "${klib_files[@]}" "$k_dst/_lib/"
  fi

  # 4. kernel/recall/ + kernel/spawn-state/ + kernel/algorithms/ + kernel/schema/
  # Phase-1-alpha/0a (SC2206): quote $sub inside array-glob (same fix-pattern
  # as section 1 above).
  for sub in recall spawn-state algorithms schema; do
    if [ -d "$k_src/$sub" ]; then
      mkdir -p "$k_dst/$sub"
      shopt -s nullglob
      sub_files=("$k_src/$sub"/*)
      shopt -u nullglob
      if [ ${#sub_files[@]} -gt 0 ]; then
        cp -r "$k_src/$sub"/* "$k_dst/$sub/"
        find "$k_dst/$sub" -name '*.js' -exec chmod +x {} \;
      fi
    fi
  done

  # 5. kernel/hooks.json + kernel/config-guard-patterns.json + kernel/settings-reference.json
  for f in hooks.json config-guard-patterns.json settings-reference.json; do
    [ -f "$k_src/$f" ] && cp "$k_src/$f" "$k_dst/$f"
  done

  # 6. runtime/ (HETS orchestration — was scripts/agent-team/)
  echo "Installing runtime substrate (HETS orchestration + contracts + personas)..."
  mkdir -p "$r_dst/orchestration/identity" "$r_dst/orchestration/doctor/probes" \
           "$r_dst/orchestration/aggregate" "$r_dst/contracts" "$r_dst/personas" "$r_dst/schema"
  shopt -s nullglob
  # orchestration top-level .js + .sh
  for f in "$r_src"/orchestration/*.js "$r_src"/orchestration/*.sh; do
    [ -f "$f" ] && cp "$f" "$r_dst/orchestration/"
  done
  find "$r_dst/orchestration" -maxdepth 1 -name '*.js' -exec chmod +x {} \;
  find "$r_dst/orchestration" -maxdepth 1 -name '*.sh' -exec chmod +x {} \;
  # orchestration nested subdirs
  # Phase-1-alpha/0a (SC2206): quote $sub inside array-glob (same fix-pattern
  # as kernel section 1/4 above).
  for sub in identity aggregate; do
    sub_files=("$r_src/orchestration/$sub"/*.js)
    if [ ${#sub_files[@]} -gt 0 ]; then
      cp "${sub_files[@]}" "$r_dst/orchestration/$sub/"
      chmod +x "$r_dst/orchestration/$sub"/*.js
    fi
  done
  # doctor/probes nested
  probe_files=("$r_src"/orchestration/doctor/probes/*.js)
  if [ ${#probe_files[@]} -gt 0 ]; then
    cp "${probe_files[@]}" "$r_dst/orchestration/doctor/probes/"
    chmod +x "$r_dst"/orchestration/doctor/probes/*.js
  fi
  # contracts + personas + schema
  for f in "$r_src"/contracts/*.json; do
    [ -f "$f" ] && cp "$f" "$r_dst/contracts/"
  done
  for f in "$r_src"/personas/*.md; do
    [ -f "$f" ] && cp "$f" "$r_dst/personas/"
  done
  for f in "$r_src"/schema/*; do
    [ -f "$f" ] && cp "$f" "$r_dst/schema/"
  done
  shopt -u nullglob

  # 7. Plugin-level CLI scripts at scripts/ root (library, library-migrate, generate-persona-agents, etc.)
  if [ -d "$SCRIPT_DIR/scripts" ]; then
    mkdir -p "$CLAUDE_DIR/scripts"
    shopt -s nullglob
    for f in "$SCRIPT_DIR"/scripts/*.js "$SCRIPT_DIR"/scripts/*.sh; do
      [ -f "$f" ] && cp "$f" "$CLAUDE_DIR/scripts/" && chmod +x "$CLAUDE_DIR/scripts/$(basename "$f")"
    done
    shopt -u nullglob
    echo "  -> CLI scripts installed to $CLAUDE_DIR/scripts/"
  fi

  # 7b. Back-compat for legacy ~/.claude/scripts/ entrypoints (Phase 0 transition).
  # Scripts that moved kernel-side (loom-recall, self-improve-store, prompt-pattern-store)
  # are still referenced by their legacy paths in:
  #   - 20+ skill SKILL.md docs (packages/skills/library/*/SKILL.md)
  #   - Persona briefs (packages/runtime/personas/*.md)
  #   - Global rules (packages/skills/rules/core/self-improvement.md)
  #   - The SessionStart self-improve queue injection
  # Updating all those references is Step 10 path-fix work. Until then, dual-install
  # these specific entrypoints so legacy callers resolve. The kernel-side copies (step 4
  # above) are the canonical install; these are duplicates for back-compat.
  for src_rel in "packages/kernel/recall/loom-recall.js" \
                  "packages/kernel/spawn-state/self-improve-store.js" \
                  "packages/kernel/spawn-state/prompt-pattern-store.js"; do
    if [ -f "$SCRIPT_DIR/$src_rel" ]; then
      cp "$SCRIPT_DIR/$src_rel" "$CLAUDE_DIR/scripts/$(basename "$src_rel")"
      chmod +x "$CLAUDE_DIR/scripts/$(basename "$src_rel")"
    fi
  done
  echo "  -> Back-compat ~/.claude/scripts/ entrypoints installed (loom-recall, self-improve-store, prompt-pattern-store)"

  # 7c. Stage kernel _lib helpers under ~/.claude/_lib/ so the back-compat
  # entrypoints above can resolve their `require('../_lib/X')` imports
  # (atomic-write, lock) when invoked from ~/.claude/scripts/.
  #
  # Resolution: node resolves `require('../_lib/X')` relative to the file's
  # directory. From ~/.claude/scripts/self-improve-store.js, `..` is
  # ~/.claude/, so `../_lib/X` resolves to ~/.claude/_lib/X (NOT
  # ~/.claude/scripts/_lib/X). This mirrors the kernel package layout
  # where the same require from packages/kernel/spawn-state/script.js
  # resolves to packages/kernel/_lib/X.
  #
  # Without this, self-improve-store.js and prompt-pattern-store.js crash
  # with MODULE_NOT_FOUND on first hard require. (loom-recall.js has no
  # _lib deps and works without this staging.)
  #
  # This is back-compat scaffolding for the Phase 0 transition. When the
  # 20+ legacy callers are migrated to ~/.claude/packages/kernel/... paths,
  # both step 7b and this step 7c can be removed together.
  if [ -d "$SCRIPT_DIR/packages/kernel/_lib" ]; then
    mkdir -p "$CLAUDE_DIR/_lib"
    shopt -s nullglob
    for f in "$SCRIPT_DIR"/packages/kernel/_lib/*.js; do
      [ -f "$f" ] && cp "$f" "$CLAUDE_DIR/_lib/"
    done
    shopt -u nullglob
    echo "  -> Back-compat _lib helpers installed (~/.claude/_lib/)"
  fi

  echo "  -> Kernel + runtime substrate installed to $CLAUDE_DIR/packages/"
  echo ""
  echo "  NOTE: Hook configuration must be manually merged."
  echo "  See packages/kernel/settings-reference.json for the configuration template."
  echo "  Replace HOME_DIR with your actual home directory path."
}

install_commands() {
  # Phase 0 (v3.0-alpha): source moved commands/ → packages/skills/commands/.
  local commands_src="$SCRIPT_DIR/packages/skills/commands"
  if $DRY_RUN; then
    echo "[DRY RUN] Commands:"
    for f in "$commands_src"/*.md; do
      diff_component "$f" "$CLAUDE_DIR/commands/$(basename "$f")" "commands/$(basename "$f")"
    done
    return
  fi
  echo "Installing commands..."
  mkdir -p "$CLAUDE_DIR/commands"
  cp "$commands_src"/*.md "$CLAUDE_DIR/commands/"
  echo "  -> $(ls "$commands_src"/*.md | wc -l | tr -d ' ') commands installed"
}

install_skills() {
  # Phase 0 (v3.0-alpha): source moved skills/ → packages/skills/library/.
  # Install target preserves the original ~/.claude/skills/<name>/SKILL.md
  # convention (Claude Code skill discovery is library-flat).
  local skills_src="$SCRIPT_DIR/packages/skills/library"
  if $DRY_RUN; then
    echo "[DRY RUN] Skills:"
    find "$skills_src" -name 'SKILL.md' | while read -r f; do
      local rel="${f#"$skills_src"/}"
      diff_component "$f" "$CLAUDE_DIR/skills/$rel" "skills/$rel"
    done
    return
  fi
  echo "Installing skills..."
  mkdir -p "$CLAUDE_DIR/skills"
  cp -r "$skills_src"/* "$CLAUDE_DIR/skills/"
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
  # H.9.21.1 v2.1.1 Component H FULL bulkhead smoke (T111/T112 — per-persona
  # 16-way parallel writers + partition-personas round-trip + idempotency).
  source "$SCRIPT_DIR/tests/smoke-library-bulkhead.sh"
  # H.9.21.5 v2.1.6 library gc smoke (T114/T115 — stale-lockfile reclamation
  # + orphaned _backups reclamation + sentinel protection invariant).
  source "$SCRIPT_DIR/tests/smoke-library-gc.sh"
  # H.9.22 v2.2.0 library daybook smoke (T116-T119 — markdown render +
  # --json schema + --brief size budget + empty-library robustness).
  source "$SCRIPT_DIR/tests/smoke-library-daybook.sh"
  # library reindex smoke (T120 — catalog rebuild from directly-written volumes,
  # repairs the pre-compact SAVE_PROMPT catalog-drift failure mode).
  source "$SCRIPT_DIR/tests/smoke-library-reindex.sh"
  # CAND-5 (self-improve 2026-06-10) — the 3 drift gates that were CI-only
  # (T121 signpost --check, T122 doc-paths, T123 contracts-validate); closes the
  # local-vs-CI gap that let SIGNPOST / doc-path / related-link drift reach push 5x.
  source "$SCRIPT_DIR/tests/smoke-drift-gates.sh"


  echo ""
  echo "  Results: $passed passed, $failed failed"
  # Honest exit status: 0 when all smoke tests pass, non-zero when any fail.
  # The prior `[ "$failed" -gt 0 ] && echo ...` was this function's LAST command,
  # so under `set -euo pipefail` it returned 1 whenever $failed == 0 (the all-pass
  # case) and `set -e` aborted install.sh before the final "Done!" echo — an
  # inverted exit code (1 on success). CI greps the "Results:" line so it stayed
  # green; humans / scripts checking $? saw a false failure on success.
  if [ "$failed" -gt 0 ]; then
    echo "  Some tests failed — check hook scripts and paths"
    return 1
  fi
  return 0
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
