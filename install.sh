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

  # Test 6: prompt-enrich-trigger flags vague prompts
  local vague_result
  vague_result=$(echo '{"prompt":"fix the auth"}' | node "$CLAUDE_DIR/hooks/scripts/prompt-enrich-trigger.js" 2>/dev/null)
  if echo "$vague_result" | grep -q 'PROMPT-ENRICHMENT-GATE'; then
    echo "  ✓ prompt-enrich-trigger: flags vague prompt"
    passed=$((passed + 1))
  else
    echo "  ✗ prompt-enrich-trigger: FAILED to flag vague prompt"
    failed=$((failed + 1))
  fi

  # Test 7: prompt-enrich-trigger skips clear prompts
  local clear_result
  clear_result=$(echo '{"prompt":"git push origin main"}' | node "$CLAUDE_DIR/hooks/scripts/prompt-enrich-trigger.js" 2>/dev/null)
  if [ -z "$clear_result" ]; then
    echo "  ✓ prompt-enrich-trigger: skips clear prompt"
    passed=$((passed + 1))
  else
    echo "  ✗ prompt-enrich-trigger: false-positive on clear prompt"
    failed=$((failed + 1))
  fi

  # Test 8 (H.4.3): prompt-enrich-trigger skips "sure, go for it"-class
  # confirmation variants (was previously leaking past strict skip regex)
  local h43_variant_result
  h43_variant_result=$(echo '{"prompt":"sure, go for it"}' | node "$CLAUDE_DIR/hooks/scripts/prompt-enrich-trigger.js" 2>/dev/null)
  if [ -z "$h43_variant_result" ]; then
    echo "  ✓ prompt-enrich-trigger: H.4.3 confirmation-variant skip (sure, go for it)"
    passed=$((passed + 1))
  else
    echo "  ✗ prompt-enrich-trigger: H.4.3 confirmation-variant LEAKED (sure, go for it)"
    failed=$((failed + 1))
  fi

  # Test 9 (H.4.3): prompt-enrich-trigger skips standalone "go for it"
  local h43_standalone_result
  h43_standalone_result=$(echo '{"prompt":"go for it"}' | node "$CLAUDE_DIR/hooks/scripts/prompt-enrich-trigger.js" 2>/dev/null)
  if [ -z "$h43_standalone_result" ]; then
    echo "  ✓ prompt-enrich-trigger: H.4.3 standalone confirmation skip (go for it)"
    passed=$((passed + 1))
  else
    echo "  ✗ prompt-enrich-trigger: H.4.3 standalone confirmation LEAKED (go for it)"
    failed=$((failed + 1))
  fi

  # Test 10 (H.4.3 / H.7.26): prompt-enrich-trigger emits PROMPT-ENRICHMENT-GATE
  # with `tier: short-confirm` discriminator for short ambiguous prompts that
  # fail strict skip regex. H.7.26 consolidated former [CONFIRMATION-UNCERTAIN]
  # into this tier of the unified marker (drift-note 57).
  local h43_uncertain_result
  h43_uncertain_result=$(echo '{"prompt":"go on"}' | node "$CLAUDE_DIR/hooks/scripts/prompt-enrich-trigger.js" 2>/dev/null)
  if echo "$h43_uncertain_result" | grep -q 'PROMPT-ENRICHMENT-GATE' && echo "$h43_uncertain_result" | grep -q 'tier: short-confirm'; then
    echo "  ✓ prompt-enrich-trigger: H.7.26 [PROMPT-ENRICHMENT-GATE] tier: short-confirm fires (consolidated from [CONFIRMATION-UNCERTAIN])"
    passed=$((passed + 1))
  else
    echo "  ✗ prompt-enrich-trigger: H.7.26 short-confirm tier missing — got: ${h43_uncertain_result:0:120}"
    failed=$((failed + 1))
  fi

  # Test 11 (H.7.7): error-critic Critic→Refiner — first failure stays silent
  # (below escalation threshold). H.7.10 update: use explicit CLAUDE_SESSION_ID
  # so script's session-scoping (mira C-1 fix) gives both invocations the
  # same subdir; without this, each invocation generates random hex SESSION_ID
  # and the count never accumulates.
  local tmp_failures
  tmp_failures=$(node -e "console.log(require('os').tmpdir())")"/.claude-toolkit-failures"
  rm -rf "$tmp_failures"
  local h77_session="test-h7-7-session-A"
  local h77_first_result
  h77_first_result=$(echo '{"tool_name":"Bash","tool_input":{"command":"npm test"},"tool_response":{"stderr":"Error: failed","is_error":true}}' | CLAUDE_SESSION_ID="$h77_session" node "$CLAUDE_DIR/hooks/scripts/error-critic.js" 2>/dev/null)
  if [ -z "$h77_first_result" ]; then
    echo "  ✓ error-critic: H.7.7 first failure stays silent (below threshold)"
    passed=$((passed + 1))
  else
    echo "  ✗ error-critic: H.7.7 first failure should be silent — got: ${h77_first_result:0:80}"
    failed=$((failed + 1))
  fi

  # Test 12 (H.7.7): error-critic emits [FAILURE-REPEATED] forcing instruction
  # on the SECOND failure of the same command. Same session as test 11.
  local h77_second_result
  h77_second_result=$(echo '{"tool_name":"Bash","tool_input":{"command":"npm test"},"tool_response":{"stderr":"Error: failed again","is_error":true}}' | CLAUDE_SESSION_ID="$h77_session" node "$CLAUDE_DIR/hooks/scripts/error-critic.js" 2>/dev/null)
  if echo "$h77_second_result" | grep -q 'FAILURE-REPEATED'; then
    echo "  ✓ error-critic: H.7.7 [FAILURE-REPEATED] forcing instruction on 2nd same-command failure"
    passed=$((passed + 1))
  else
    echo "  ✗ error-critic: H.7.7 [FAILURE-REPEATED] missing on 2nd failure — got: ${h77_second_result:0:80}"
    failed=$((failed + 1))
  fi

  # Test 13 (H.7.10): cross-session leak detection (mira C-1 retrospective fix).
  # Tests 11+12 just got count=2 in session-A. Test 13 fires the SAME COMMAND
  # in a DIFFERENT session (session-B) and verifies count starts fresh at 1
  # (silent, below threshold) — NOT continuing from 2 (which would emit
  # [FAILURE-REPEATED] and prove the leak still exists).
  # Critical property: NO rm -rf between tests 12 and 13. State persistence
  # across the test boundary is what catches the cross-session leak.
  local h7_10_session="test-h7-10-session-B"
  local h7_10_result
  h7_10_result=$(echo '{"tool_name":"Bash","tool_input":{"command":"npm test"},"tool_response":{"stderr":"Error: failed in B","is_error":true}}' | CLAUDE_SESSION_ID="$h7_10_session" node "$CLAUDE_DIR/hooks/scripts/error-critic.js" 2>/dev/null)
  if [ -z "$h7_10_result" ]; then
    echo "  ✓ error-critic: H.7.10 cross-session leak fix — fresh session count starts at 1 (silent)"
    passed=$((passed + 1))
  else
    echo "  ✗ error-critic: H.7.10 cross-session leak — session-B unexpectedly escalated; mira C-1 still present"
    failed=$((failed + 1))
  fi
  rm -rf "$tmp_failures"  # cleanup all session subdirs at once

  # Test 14 (H.7.12): validate-plan-schema — compliant new-style plan stays silent
  # Compliant plan has all Tier 1 + Tier 2 + Tier 3 sections + Routing Decision JSON
  local h7_12_compliant_json='{"tool_name":"Write","tool_input":{"file_path":"/Users/foo/.claude/plans/h7-12-test.md","content":"# Title\n\n## Context\nbody\n\n## Routing Decision\nJSON block\n\n## HETS Spawn Plan\nN/A\n\n## Files To Modify\nfiles\n\n## Phases\nphases\n\n## Verification Probes\nprobes\n\n## Out of Scope\noos\n\n## Drift Notes\nnotes\n"}}'
  local h7_12_compliant
  h7_12_compliant=$(printf '%s' "$h7_12_compliant_json" | node "$CLAUDE_DIR/hooks/scripts/validators/validate-plan-schema.js" 2>&1)
  if echo "$h7_12_compliant" | grep -q 'PLAN-SCHEMA-DRIFT'; then
    echo "  ✗ validate-plan-schema: H.7.12 compliant plan emitted forcing instruction (false positive)"
    failed=$((failed + 1))
  else
    echo "  ✓ validate-plan-schema: H.7.12 compliant new-style plan stays silent"
    passed=$((passed + 1))
  fi

  # Test 15 (H.7.12): missing Tier 1 (Verification Probes absent) → forcing instruction
  local h7_12_missing_t1_json='{"tool_name":"Write","tool_input":{"file_path":"/Users/foo/.claude/plans/h7-12-missing-t1.md","content":"# Title\n\n## Context\nbody\n\n## Files To Modify\nfiles\n"}}'
  local h7_12_missing_t1
  h7_12_missing_t1=$(printf '%s' "$h7_12_missing_t1_json" | node "$CLAUDE_DIR/hooks/scripts/validators/validate-plan-schema.js" 2>&1)
  if echo "$h7_12_missing_t1" | grep -q '\[PLAN-SCHEMA-DRIFT\]' && echo "$h7_12_missing_t1" | grep -q 'Verification Probes'; then
    echo "  ✓ validate-plan-schema: H.7.12 missing Tier 1 (Verification Probes) fires forcing instruction"
    passed=$((passed + 1))
  else
    echo "  ✗ validate-plan-schema: H.7.12 Tier 1 missing should emit [PLAN-SCHEMA-DRIFT]"
    failed=$((failed + 1))
  fi

  # Test 16 (H.7.12): Tier 2 conditional — fires only when "Routing Decision" string detected
  # Plan mentions Routing Decision in body (signaling new-style) but missing HETS Spawn Plan section
  local h7_12_missing_t2_json='{"tool_name":"Write","tool_input":{"file_path":"/Users/foo/.claude/plans/h7-12-missing-t2.md","content":"# Title\n\n## Context\nbody mentioning Routing Decision somewhere\n\n## Files To Modify\nfiles\n\n## Verification Probes\nprobes\n"}}'
  local h7_12_missing_t2
  h7_12_missing_t2=$(printf '%s' "$h7_12_missing_t2_json" | node "$CLAUDE_DIR/hooks/scripts/validators/validate-plan-schema.js" 2>&1)
  if echo "$h7_12_missing_t2" | grep -q '\[PLAN-SCHEMA-DRIFT\]' && echo "$h7_12_missing_t2" | grep -q 'Tier 2'; then
    echo "  ✓ validate-plan-schema: H.7.12 Tier 2 conditional fires on new-style plan missing HETS Spawn Plan"
    passed=$((passed + 1))
  else
    echo "  ✗ validate-plan-schema: H.7.12 Tier 2 should fire when 'Routing Decision' string detected but section missing"
    failed=$((failed + 1))
  fi

  # Test 17 (H.7.12): non-plan path stays silent (path filter excludes)
  local h7_12_nonplan_json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/random-doc.md","content":"random content with no sections"}}'
  local h7_12_nonplan
  h7_12_nonplan=$(printf '%s' "$h7_12_nonplan_json" | node "$CLAUDE_DIR/hooks/scripts/validators/validate-plan-schema.js" 2>&1)
  if echo "$h7_12_nonplan" | grep -q 'PLAN-SCHEMA-DRIFT'; then
    echo "  ✗ validate-plan-schema: H.7.12 non-plan path should be silent (path filter)"
    failed=$((failed + 1))
  else
    echo "  ✓ validate-plan-schema: H.7.12 non-plan path stays silent (path filter excludes)"
    passed=$((passed + 1))
  fi

  # Test 18 (H.7.15): drift-note 12 — custom plan path via CLAUDE_PLAN_DIR env var
  # With env var set, .md files under that path also get tiered-schema enforcement.
  # Same JSON as test 17 (path /tmp/custom-plans/test.md missing Tier 1 sections);
  # without env var: silent (test 17-style); with env var: forcing instruction fires.
  local h7_15_custom_path_json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/custom-plans/test.md","content":"# Title\n\n## Context\nbody\n"}}'
  local h7_15_custom_result
  h7_15_custom_result=$(printf '%s' "$h7_15_custom_path_json" | CLAUDE_PLAN_DIR=/tmp/custom-plans node "$CLAUDE_DIR/hooks/scripts/validators/validate-plan-schema.js" 2>&1)
  if echo "$h7_15_custom_result" | grep -q '\[PLAN-SCHEMA-DRIFT\]' && echo "$h7_15_custom_result" | grep -q 'Tier 1'; then
    echo "  ✓ validate-plan-schema: H.7.15 CLAUDE_PLAN_DIR env var enables custom plan path enforcement"
    passed=$((passed + 1))
  else
    echo "  ✗ validate-plan-schema: H.7.15 CLAUDE_PLAN_DIR env var should fire forcing instruction on custom path"
    failed=$((failed + 1))
  fi

  # H.7.27: tests 19-21 retired with validate-markdown-emphasis.js (architect
  # FLAG #6 commitment from H.7.25 — recovery is mechanical, not semantic;
  # forcing-instruction is wrong tool). Detection migrated to markdownlint
  # MD037 in CI (.github/workflows/ci.yml's markdown-lint job, default-enabled
  # in .markdownlint.json). Empirically verified: `npx markdownlint-cli2`
  # flags the same cluster pattern the hook used to detect.

  # Test 19 (H.7.27): MD037 absorption empirical check — markdownlint catches
  # the cluster pattern that the retired hook used to detect (drift-note 21
  # closure follow-on; drift-note 47-sibling concern resolved).
  local h7_27_md037_test
  h7_27_md037_test=$(mktemp /tmp/h7-27-md037-XXXXXX.md)
  printf '# Test\n\nThis paragraph has HETS_TOOLKIT_DIR _h70-test _lib/ tokens.\n' > "$h7_27_md037_test"
  local h7_27_md037_result
  h7_27_md037_result=$(npx --yes markdownlint-cli2 "$h7_27_md037_test" 2>&1 || true)
  if echo "$h7_27_md037_result" | grep -q 'MD037'; then
    echo "  ✓ markdownlint-cli2: H.7.27 MD037 catches the cluster pattern that retired [MARKDOWN-EMPHASIS-DRIFT] used to detect"
    passed=$((passed + 1))
  else
    echo "  ✗ markdownlint-cli2: H.7.27 MD037 should catch cluster pattern — got: ${h7_27_md037_result:0:200}"
    failed=$((failed + 1))
  fi
  rm -f "$h7_27_md037_test"

  # Test 22 (H.7.20): validate-frontmatter-on-skills Edit coverage — Edit that
  # REMOVES frontmatter should block. Setup temp skill file with valid frontmatter,
  # send Edit JSON that removes the frontmatter block.
  local h7_20_skill_dir="/tmp/h7-20-skills/skills/test"
  mkdir -p "$h7_20_skill_dir"
  cat > "$h7_20_skill_dir/SKILL.md" <<'SKILL_EOF'
---
name: test-skill
description: H.7.20 test fixture
---

# Test Skill

Body content here.
SKILL_EOF
  local h7_20_remove_json='{"tool_name":"Edit","tool_input":{"file_path":"/tmp/h7-20-skills/skills/test/SKILL.md","old_string":"---\nname: test-skill\ndescription: H.7.20 test fixture\n---\n\n","new_string":""}}'
  local h7_20_remove_result
  h7_20_remove_result=$(printf '%s' "$h7_20_remove_json" | node "$CLAUDE_DIR/hooks/scripts/validators/validate-frontmatter-on-skills.js" 2>&1)
  if echo "$h7_20_remove_result" | grep -q '"decision":"block"'; then
    echo "  ✓ validate-frontmatter-on-skills: H.7.20 Edit-removes-frontmatter → block"
    passed=$((passed + 1))
  else
    echo "  ✗ validate-frontmatter-on-skills: H.7.20 Edit removing frontmatter should block — got: ${h7_20_remove_result:0:80}"
    failed=$((failed + 1))
  fi

  # Test 23 (H.7.20): Edit that touches body but preserves frontmatter → approve
  local h7_20_preserve_json='{"tool_name":"Edit","tool_input":{"file_path":"/tmp/h7-20-skills/skills/test/SKILL.md","old_string":"Body content here.","new_string":"Updated body content."}}'
  local h7_20_preserve_result
  h7_20_preserve_result=$(printf '%s' "$h7_20_preserve_json" | node "$CLAUDE_DIR/hooks/scripts/validators/validate-frontmatter-on-skills.js" 2>&1)
  if echo "$h7_20_preserve_result" | grep -q '"decision":"approve"'; then
    echo "  ✓ validate-frontmatter-on-skills: H.7.20 Edit-preserves-frontmatter → approve"
    passed=$((passed + 1))
  else
    echo "  ✗ validate-frontmatter-on-skills: H.7.20 Edit preserving frontmatter should approve — got: ${h7_20_preserve_result:0:80}"
    failed=$((failed + 1))
  fi
  rm -rf /tmp/h7-20-skills

  # Test 24 (H.7.21): validate-no-bare-secrets Edit-result scan — Edit that
  # inserts a 16+ char value into a *_KEY= placeholder context should block,
  # because the post-edit result completes literal-secret-assignment pattern.
  # Pre-H.7.21 the validator only saw new_string (no prefix) and approved.
  mkdir -p /tmp/h7-21
  printf 'API_KEY=PLACEHOLDER\n' > /tmp/h7-21/test1.env
  local h7_21_complete_json='{"tool_name":"Edit","tool_input":{"file_path":"/tmp/h7-21/test1.env","old_string":"PLACEHOLDER","new_string":"abcd1234efgh5678ijkl"}}'
  local h7_21_complete_result
  h7_21_complete_result=$(printf '%s' "$h7_21_complete_json" | node "$CLAUDE_DIR/hooks/scripts/validators/validate-no-bare-secrets.js" 2>&1)
  if echo "$h7_21_complete_result" | grep -q '"decision":"block"' && echo "$h7_21_complete_result" | grep -q 'literal-secret-assignment'; then
    echo "  ✓ validate-no-bare-secrets: H.7.21 Edit-completes-assignment → block"
    passed=$((passed + 1))
  else
    echo "  ✗ validate-no-bare-secrets: H.7.21 Edit completing assignment should block — got: ${h7_21_complete_result:0:120}"
    failed=$((failed + 1))
  fi

  # Test 25 (H.7.21): Edit unrelated text in file with no secrets → approve
  printf 'Hello world\n' > /tmp/h7-21/test2.txt
  local h7_21_unrelated_json='{"tool_name":"Edit","tool_input":{"file_path":"/tmp/h7-21/test2.txt","old_string":"world","new_string":"there"}}'
  local h7_21_unrelated_result
  h7_21_unrelated_result=$(printf '%s' "$h7_21_unrelated_json" | node "$CLAUDE_DIR/hooks/scripts/validators/validate-no-bare-secrets.js" 2>&1)
  if echo "$h7_21_unrelated_result" | grep -q '"decision":"approve"'; then
    echo "  ✓ validate-no-bare-secrets: H.7.21 Edit-unrelated-text → approve"
    passed=$((passed + 1))
  else
    echo "  ✗ validate-no-bare-secrets: H.7.21 Edit unrelated text should approve — got: ${h7_21_unrelated_result:0:120}"
    failed=$((failed + 1))
  fi

  # Test 26 (H.7.21): Edit on file with pre-existing stripe-live-shaped key
  # surfaces the secret in the post-edit scan even when the Edit touches a
  # different line. Fixture key built via shell concat to keep install.sh
  # source free of bare-secret literals (see drift-note 32).
  local h7_21_stripe_value='abcd1234efgh5678ijkl9999'
  printf 'STRIPE_KEY=sk_live_%s\nNAME=Bob\n' "$h7_21_stripe_value" > /tmp/h7-21/test3.env
  local h7_21_preexist_json='{"tool_name":"Edit","tool_input":{"file_path":"/tmp/h7-21/test3.env","old_string":"NAME=Bob","new_string":"NAME=Alice"}}'
  local h7_21_preexist_result
  h7_21_preexist_result=$(printf '%s' "$h7_21_preexist_json" | node "$CLAUDE_DIR/hooks/scripts/validators/validate-no-bare-secrets.js" 2>&1)
  if echo "$h7_21_preexist_result" | grep -q '"decision":"block"' && echo "$h7_21_preexist_result" | grep -q 'stripe-live-key'; then
    echo "  ✓ validate-no-bare-secrets: H.7.21 Edit-with-preexisting-secret → block"
    passed=$((passed + 1))
  else
    echo "  ✗ validate-no-bare-secrets: H.7.21 Edit on file with pre-existing secret should block — got: ${h7_21_preexist_result:0:120}"
    failed=$((failed + 1))
  fi
  rm -rf /tmp/h7-21

  # H.7.26: tests 27-28 retired with plugin-loaded-check.js (drift-note 57
  # consolidation — [PLUGIN-NOT-LOADED] retired in favor of session-reset.js
  # inverse-condition stderr branch, which already covers the same substrate
  # state. Test 29's H.7.22 Principle Audit assertion below is unaffected.

  # Test 27 (H.7.22): validate-plan-schema requires Principle Audit on HETS-routed plans
  mkdir -p /tmp/h7-22-plan-test/.claude/plans
  local h7_22_plan_no_audit='# Phase X — test\n\n## Context\nA test.\n\n## Routing Decision\n```json\n{ "recommendation": "route" }\n```\n\n## HETS Spawn Plan\nMira architect.\n\n## Files To Modify\nNone.\n\n## Verification Probes\nN/A.\n'
  printf "%b" "$h7_22_plan_no_audit" > /tmp/h7-22-plan-test/.claude/plans/test-plan.md
  local h7_22_plan_json
  h7_22_plan_json=$(printf '{"tool_name":"Write","tool_input":{"file_path":"/tmp/h7-22-plan-test/.claude/plans/test-plan.md","content":%s}}' "$(printf "%b" "$h7_22_plan_no_audit" | node -e "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify(s)))")")
  local h7_22_plan_result
  h7_22_plan_result=$(echo "$h7_22_plan_json" | node "$CLAUDE_DIR/hooks/scripts/validators/validate-plan-schema.js" 2>&1)
  if echo "$h7_22_plan_result" | grep -q 'Principle Audit'; then
    echo "  ✓ validate-plan-schema: H.7.22 requires Principle Audit on HETS-routed plan"
    passed=$((passed + 1))
  else
    echo "  ✗ validate-plan-schema: H.7.22 should flag missing Principle Audit — got: ${h7_22_plan_result:0:120}"
    failed=$((failed + 1))
  fi
  rm -rf /tmp/h7-22-plan-test

  # Test 30 (H.7.23): contract-marketplace-schema validator passes on HEAD
  # AND emits the "schemas: 2 validated" confirmation (per H.7.23 plan code-reviewer FLAG #7
  # — assert validation actually ran, not just exit code 0)
  local h7_23_schema_result
  h7_23_schema_result=$(node "$SCRIPT_DIR/scripts/agent-team/contracts-validate.js" --scope contract-marketplace-schema 2>&1)
  if echo "$h7_23_schema_result" | grep -q 'schemas: 2 validated' && echo "$h7_23_schema_result" | grep -q '0 violation'; then
    echo "  ✓ contract-marketplace-schema: H.7.23 validates HEAD plugin.json + marketplace.json"
    passed=$((passed + 1))
  else
    echo "  ✗ contract-marketplace-schema: H.7.23 failed — got: ${h7_23_schema_result:0:200}"
    failed=$((failed + 1))
  fi

  # Test 31 (H.7.23): validate-plan-schema requires Pre-Approval Verification on HETS-routed plans
  # (Tier 1 conditional — same gate as Principle Audit per H.7.22). Plan with HETS Spawn Plan
  # + recommendation:route + Principle Audit but MISSING Pre-Approval Verification → fires drift.
  mkdir -p /tmp/h7-23-plan-test/.claude/plans
  local h7_23_plan_no_paver='# Phase X — test\n\n## Context\nA test.\n\n## Routing Decision\n```json\n{ "recommendation": "route" }\n```\n\n## HETS Spawn Plan\nMira architect — substantive content here.\n\n## Files To Modify\nNone.\n\n## Verification Probes\nN/A.\n\n## Principle Audit\nKISS, DRY, SOLID, YAGNI all checked.\n'
  printf "%b" "$h7_23_plan_no_paver" > /tmp/h7-23-plan-test/.claude/plans/test-plan.md
  local h7_23_plan_json
  h7_23_plan_json=$(printf '{"tool_name":"Write","tool_input":{"file_path":"/tmp/h7-23-plan-test/.claude/plans/test-plan.md","content":%s}}' "$(printf "%b" "$h7_23_plan_no_paver" | node -e "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify(s)))")")
  local h7_23_plan_result
  h7_23_plan_result=$(echo "$h7_23_plan_json" | node "$CLAUDE_DIR/hooks/scripts/validators/validate-plan-schema.js" 2>&1)
  if echo "$h7_23_plan_result" | grep -q 'Pre-Approval Verification'; then
    echo "  ✓ validate-plan-schema: H.7.23 requires Pre-Approval Verification on HETS-routed plan"
    passed=$((passed + 1))
  else
    echo "  ✗ validate-plan-schema: H.7.23 should flag missing Pre-Approval Verification — got: ${h7_23_plan_result:0:200}"
    failed=$((failed + 1))
  fi
  rm -rf /tmp/h7-23-plan-test

  # Test 32 (H.7.23): marketplace-state-reader functional probe — exposes
  # getMirrorRoot, getMirrorAgeDays. Not testing the [MARKETPLACE-STALE]
  # path directly (would require simulating a stale git clone) — instead
  # verifying the helper module loads and resolves the live mirror.
  local h7_23_reader_result
  h7_23_reader_result=$(node -e "
const r = require('$SCRIPT_DIR/hooks/scripts/_lib/marketplace-state-reader.js');
const root = r.getMirrorRoot();
if (!root) { console.log('NO-MIRROR'); process.exit(0); }
const age = r.getMirrorAgeDays(root);
if (age === null) { console.log('NO-AGE'); process.exit(0); }
if (age >= 0) console.log('READER-OK age=' + age.toFixed(2));
" 2>&1)
  if echo "$h7_23_reader_result" | grep -qE 'READER-OK|NO-MIRROR'; then
    echo "  ✓ marketplace-state-reader: H.7.23 module loads + resolves mirror state"
    passed=$((passed + 1))
  else
    echo "  ✗ marketplace-state-reader: H.7.23 failed — got: ${h7_23_reader_result:0:120}"
    failed=$((failed + 1))
  fi

  # Test 33 (H.7.23.1): verify-plan-gate blocks ExitPlanMode when plan is
  # HETS-routed AND missing ## Pre-Approval Verification section
  mkdir -p /tmp/h7-23-1-gate-test
  cat > /tmp/h7-23-1-gate-test/test-plan.md <<'GATE_EOF'
# Test plan

## Context
Test.

## Routing Decision
```json
{ "recommendation": "route" }
```

## HETS Spawn Plan
Mira architect — substantive content.

## Files To Modify
None.

## Verification Probes
N/A.

## Principle Audit
KISS, DRY checked.
GATE_EOF
  local h7_23_1_block_result
  h7_23_1_block_result=$(echo '{"tool_name":"ExitPlanMode"}' | CLAUDE_PLAN_DIR=/tmp/h7-23-1-gate-test node "$CLAUDE_DIR/hooks/scripts/validators/verify-plan-gate.js" 2>&1)
  if echo "$h7_23_1_block_result" | grep -q '"block"' && echo "$h7_23_1_block_result" | grep -q 'PRE-APPROVAL-VERIFICATION-NEEDED'; then
    echo "  ✓ verify-plan-gate: H.7.23.1 blocks ExitPlanMode when verification missing"
    passed=$((passed + 1))
  else
    echo "  ✗ verify-plan-gate: H.7.23.1 should block — got: ${h7_23_1_block_result:0:200}"
    failed=$((failed + 1))
  fi

  # Test 34 (H.7.23.1): verify-plan-gate approves when section is present
  cat >> /tmp/h7-23-1-gate-test/test-plan.md <<'GATE_EOF'

## Pre-Approval Verification

Verified by parallel spawn. Verdict: PASS.
GATE_EOF
  local h7_23_1_approve_result
  h7_23_1_approve_result=$(echo '{"tool_name":"ExitPlanMode"}' | CLAUDE_PLAN_DIR=/tmp/h7-23-1-gate-test node "$CLAUDE_DIR/hooks/scripts/validators/verify-plan-gate.js" 2>&1)
  if echo "$h7_23_1_approve_result" | grep -q '"approve"'; then
    echo "  ✓ verify-plan-gate: H.7.23.1 approves when verification section present"
    passed=$((passed + 1))
  else
    echo "  ✗ verify-plan-gate: H.7.23.1 should approve — got: ${h7_23_1_approve_result:0:200}"
    failed=$((failed + 1))
  fi

  # Test 35 (H.7.23.1): verify-plan-gate respects SKIP_VERIFY_PLAN=1 bypass
  cat > /tmp/h7-23-1-gate-test/test-plan.md <<'GATE_EOF'
# Test plan
## Context
Test.
## Routing Decision
```json
{ "recommendation": "route" }
```
## HETS Spawn Plan
Mira architect — substantive content.
## Files To Modify
None.
## Verification Probes
N/A.
GATE_EOF
  local h7_23_1_bypass_result
  h7_23_1_bypass_result=$(echo '{"tool_name":"ExitPlanMode"}' | SKIP_VERIFY_PLAN=1 CLAUDE_PLAN_DIR=/tmp/h7-23-1-gate-test node "$CLAUDE_DIR/hooks/scripts/validators/verify-plan-gate.js" 2>&1)
  if echo "$h7_23_1_bypass_result" | grep -q '"approve"'; then
    echo "  ✓ verify-plan-gate: H.7.23.1 SKIP_VERIFY_PLAN=1 bypass works"
    passed=$((passed + 1))
  else
    echo "  ✗ verify-plan-gate: H.7.23.1 bypass should approve — got: ${h7_23_1_bypass_result:0:200}"
    failed=$((failed + 1))
  fi
  rm -rf /tmp/h7-23-1-gate-test

  # Test 36 (H.7.24): all SKILL.md files have frontmatter (drift-note 49 closure)
  local h7_24_missing_frontmatter=0
  for skill_file in $(find "$SCRIPT_DIR/skills" -name "SKILL.md" 2>/dev/null); do
    local first_line
    first_line=$(head -1 "$skill_file")
    if [ "$first_line" != "---" ]; then
      h7_24_missing_frontmatter=$((h7_24_missing_frontmatter + 1))
    fi
  done
  if [ "$h7_24_missing_frontmatter" -eq 0 ]; then
    echo "  ✓ skill-files-frontmatter: H.7.24 all SKILL.md files have frontmatter"
    passed=$((passed + 1))
  else
    echo "  ✗ skill-files-frontmatter: H.7.24 $h7_24_missing_frontmatter SKILL.md file(s) missing frontmatter"
    failed=$((failed + 1))
  fi

  # Test 37 (H.7.24): prompt-enrich-trigger SKIPs `?` (drift-note 52 closure)
  local h7_24_qmark_result
  h7_24_qmark_result=$(echo '{"prompt":"?"}' | node "$CLAUDE_DIR/hooks/scripts/prompt-enrich-trigger.js" 2>&1)
  if [ -z "$h7_24_qmark_result" ] || ! echo "$h7_24_qmark_result" | grep -q 'PROMPT-ENRICHMENT-GATE'; then
    echo "  ✓ prompt-enrich-trigger: H.7.24 single ? prompt does NOT fire enrichment gate"
    passed=$((passed + 1))
  else
    echo "  ✗ prompt-enrich-trigger: H.7.24 ? should have been skipped — got: ${h7_24_qmark_result:0:120}"
    failed=$((failed + 1))
  fi

  # Test 38 (H.7.24): contract-plugin-hook-deployment surfaces informational
  # stderr when enabledPlugins truthy + CLAUDE_PLUGIN_ROOT unset (drift-note 50).
  # Mock settings.json to set up the condition.
  mkdir -p /tmp/h7-24-mock-home/.claude
  cat > /tmp/h7-24-mock-home/.claude/settings.json <<'SETTINGS_EOF'
{
  "hooks": {},
  "enabledPlugins": { "power-loom@power-loom-marketplace": true }
}
SETTINGS_EOF
  local h7_24_enabled_result
  h7_24_enabled_result=$(HOME=/tmp/h7-24-mock-home node "$SCRIPT_DIR/scripts/agent-team/contracts-validate.js" --scope contract-plugin-hook-deployment 2>&1 || true)
  if echo "$h7_24_enabled_result" | grep -q 'enabledPlugins shows.*enabled'; then
    echo "  ✓ contract-plugin-hook-deployment: H.7.24 informational stderr fires when enabledPlugins truthy"
    passed=$((passed + 1))
  else
    echo "  ✗ contract-plugin-hook-deployment: H.7.24 informational message missing — got: ${h7_24_enabled_result:0:200}"
    failed=$((failed + 1))
  fi
  rm -rf /tmp/h7-24-mock-home

  # Test 39 (H.7.25): forcing-instruction-family.md exists AND lists all 11
  # markers in TABLE-ROW context (per code-reviewer FLAG #3 — strengthen from
  # presence-only grep to assert each marker appears in a markdown table cell,
  # not just in prose). Closes drift-note 21 catalog completeness.
  local h7_25_catalog="$SCRIPT_DIR/skills/agent-team/patterns/forcing-instruction-family.md"
  local h7_25_markers="PROMPT-ENRICHMENT-GATE ROUTE-DECISION-UNCERTAIN CONFIRMATION-UNCERTAIN FAILURE-REPEATED SELF-IMPROVE PLAN-SCHEMA-DRIFT ROUTE-META-UNCERTAIN MARKDOWN-EMPHASIS-DRIFT PLUGIN-NOT-LOADED MARKETPLACE-STALE PRE-APPROVAL-VERIFICATION-NEEDED"
  local h7_25_missing_markers=0
  if [ ! -f "$h7_25_catalog" ]; then
    h7_25_missing_markers=11
  else
    for marker in $h7_25_markers; do
      # Match table-row line containing [MARKER-NAME] — line starts with `|`
      # and contains `[${marker}` (allows backtick-wrapped markers like `[NAME]`)
      if ! grep -qE "^\|.*\[${marker}" "$h7_25_catalog"; then
        h7_25_missing_markers=$((h7_25_missing_markers + 1))
      fi
    done
  fi
  if [ "$h7_25_missing_markers" -eq 0 ]; then
    echo "  ✓ forcing-instruction-family: H.7.25 catalog lists all 11 markers in table-row context"
    passed=$((passed + 1))
  else
    echo "  ✗ forcing-instruction-family: H.7.25 catalog missing $h7_25_missing_markers marker(s) in table-row context"
    failed=$((failed + 1))
  fi

  # Test 40 (H.7.25): Convention G section present in validator-conventions.md
  # AND contains "Class 1", "Class 2", "decision tree", and "N=15" tokens
  # (per code-reviewer FLAG #4 — assert structural completeness, not just
  # heading presence). Closes drift-note 21 taxonomy codification.
  local h7_25_conv="$SCRIPT_DIR/skills/agent-team/patterns/validator-conventions.md"
  local h7_25_conv_missing=0
  if [ ! -f "$h7_25_conv" ]; then
    h7_25_conv_missing=4
  else
    grep -qE '## Convention G' "$h7_25_conv" || h7_25_conv_missing=$((h7_25_conv_missing + 1))
    grep -qE 'Class 1' "$h7_25_conv" || h7_25_conv_missing=$((h7_25_conv_missing + 1))
    grep -qE 'Class 2' "$h7_25_conv" || h7_25_conv_missing=$((h7_25_conv_missing + 1))
    grep -qE 'decision tree' "$h7_25_conv" || h7_25_conv_missing=$((h7_25_conv_missing + 1))
    grep -qE 'N=15' "$h7_25_conv" || h7_25_conv_missing=$((h7_25_conv_missing + 1))
  fi
  if [ "$h7_25_conv_missing" -eq 0 ]; then
    echo "  ✓ convention-g: H.7.25 validator-conventions.md Convention G has all structural tokens (Class 1, Class 2, decision tree, N=15)"
    passed=$((passed + 1))
  else
    echo "  ✗ convention-g: H.7.25 validator-conventions.md Convention G missing $h7_25_conv_missing structural token(s)"
    failed=$((failed + 1))
  fi

  # Test 41 (H.8.0): kb-resolver cat-summary extracts only Summary section
  # (Tier 1 — cheap inline injection)
  local h8_0_summary_result
  h8_0_summary_result=$(node "$SCRIPT_DIR/scripts/agent-team/kb-resolver.js" cat-summary architecture/crosscut/single-responsibility 2>/dev/null)
  if echo "$h8_0_summary_result" | grep -q '## Summary' && ! echo "$h8_0_summary_result" | grep -q '## Quick Reference' && ! echo "$h8_0_summary_result" | grep -q '## Intent'; then
    echo "  ✓ kb-resolver: H.8.0 cat-summary returns only Summary section (Tier 1)"
    passed=$((passed + 1))
  else
    echo "  ✗ kb-resolver: H.8.0 cat-summary should return only Summary, not later sections"
    failed=$((failed + 1))
  fi

  # Test 42 (H.8.0): kb-resolver cat-quick-ref extracts Summary + Quick Reference
  # but stops before Intent (Tier 2 — mid-density injection)
  local h8_0_quickref_result
  h8_0_quickref_result=$(node "$SCRIPT_DIR/scripts/agent-team/kb-resolver.js" cat-quick-ref architecture/crosscut/single-responsibility 2>/dev/null)
  if echo "$h8_0_quickref_result" | grep -q '## Summary' && echo "$h8_0_quickref_result" | grep -q '## Quick Reference' && ! echo "$h8_0_quickref_result" | grep -q '## Intent'; then
    echo "  ✓ kb-resolver: H.8.0 cat-quick-ref returns Summary + Quick Reference (Tier 2)"
    passed=$((passed + 1))
  else
    echo "  ✗ kb-resolver: H.8.0 cat-quick-ref should return Summary + Quick Reference, not Intent"
    failed=$((failed + 1))
  fi

  # Test 43 (H.8.0): kb-resolver cat-quick-ref falls back gracefully on doc
  # WITHOUT Quick Reference section (older kb docs); returns just Summary +
  # informational stderr note
  local h8_0_fallback_stdout
  local h8_0_fallback_stderr
  h8_0_fallback_stdout=$(node "$SCRIPT_DIR/scripts/agent-team/kb-resolver.js" cat-quick-ref hets/spawn-conventions 2>/dev/null)
  h8_0_fallback_stderr=$(node "$SCRIPT_DIR/scripts/agent-team/kb-resolver.js" cat-quick-ref hets/spawn-conventions 2>&1 >/dev/null)
  if echo "$h8_0_fallback_stdout" | grep -q '## Summary' && ! echo "$h8_0_fallback_stdout" | grep -q '## Quick Reference' && echo "$h8_0_fallback_stderr" | grep -q "no '## Quick Reference'"; then
    echo "  ✓ kb-resolver: H.8.0 cat-quick-ref falls back to Summary + stderr note when no Quick Reference"
    passed=$((passed + 1))
  else
    echo "  ✗ kb-resolver: H.8.0 cat-quick-ref fallback should return Summary + warn on stderr"
    failed=$((failed + 1))
  fi

  # Test 44 (H.8.1): architecture-relevance-detector matches state-mutation signal
  # and returns idempotency refs
  local h8_1_state_result
  h8_1_state_result=$(node "$SCRIPT_DIR/scripts/agent-team/architecture-relevance-detector.js" detect --task "implement state mutation in distributed system with retry logic" 2>/dev/null)
  if echo "$h8_1_state_result" | grep -q '"state-mutation"' && echo "$h8_1_state_result" | grep -q 'architecture/crosscut/idempotency'; then
    echo "  ✓ architecture-relevance-detector: H.8.1 state-mutation signal routes to idempotency"
    passed=$((passed + 1))
  else
    echo "  ✗ architecture-relevance-detector: H.8.1 state-mutation signal should match + route to idempotency"
    failed=$((failed + 1))
  fi

  # Test 45 (H.8.1): no-signal task returns empty refs + summary tier (cheap default)
  local h8_1_empty_result
  h8_1_empty_result=$(node "$SCRIPT_DIR/scripts/agent-team/architecture-relevance-detector.js" detect --task "hello world" 2>/dev/null)
  if echo "$h8_1_empty_result" | grep -q '"ref_count": 0' && echo "$h8_1_empty_result" | grep -q '"tier_recommendation": "summary"'; then
    echo "  ✓ architecture-relevance-detector: H.8.1 no-match task returns empty refs + summary tier"
    passed=$((passed + 1))
  else
    echo "  ✗ architecture-relevance-detector: H.8.1 no-match task should return empty refs"
    failed=$((failed + 1))
  fi

  # Test 46 (H.8.1): multiple matched signals (3+) → tier escalates from
  # summary to quick-ref. Verifies the tier-recommendation logic.
  local h8_1_complex_result
  h8_1_complex_result=$(node "$SCRIPT_DIR/scripts/agent-team/architecture-relevance-detector.js" detect --task "extract a shared utility from these 5 services with acyclic dependencies and avoid circular imports; multi-file refactor across modules; trade-off vs DRY" 2>/dev/null)
  if echo "$h8_1_complex_result" | grep -q '"tier_recommendation": "quick-ref"' && echo "$h8_1_complex_result" | grep -q 'architecture/crosscut/acyclic-dependencies'; then
    echo "  ✓ architecture-relevance-detector: H.8.1 multi-signal task → quick-ref tier escalation + acyclic ref"
    passed=$((passed + 1))
  else
    echo "  ✗ architecture-relevance-detector: H.8.1 multi-signal task should escalate to quick-ref tier"
    failed=$((failed + 1))
  fi

  # Test 47 (H.8.2): adr.js list returns the seed ADR-0001
  local h8_2_list_result
  h8_2_list_result=$(node "$SCRIPT_DIR/scripts/agent-team/adr.js" list 2>/dev/null)
  if echo "$h8_2_list_result" | grep -q '"adr_id": "0001"' && echo "$h8_2_list_result" | grep -q 'fail open'; then
    echo "  ✓ adr.js: H.8.2 list shows seed ADR-0001 (fail-open hook discipline)"
    passed=$((passed + 1))
  else
    echo "  ✗ adr.js: H.8.2 list should include seed ADR-0001"
    failed=$((failed + 1))
  fi

  # Test 48 (H.8.2): adr.js touched-by detects file in ADR-0001 files_affected
  local h8_2_touched_result
  h8_2_touched_result=$(node "$SCRIPT_DIR/scripts/agent-team/adr.js" touched-by hooks/scripts/fact-force-gate.js 2>/dev/null)
  if echo "$h8_2_touched_result" | grep -q '"matched_count": 1' && echo "$h8_2_touched_result" | grep -q '"adr_id": "0001"'; then
    echo "  ✓ adr.js: H.8.2 touched-by detects file in active ADR's files_affected"
    passed=$((passed + 1))
  else
    echo "  ✗ adr.js: H.8.2 touched-by should match fact-force-gate.js to ADR-0001"
    failed=$((failed + 1))
  fi

  # Test 49 (H.8.2): validate-adr-drift hook emits [ADR-DRIFT-CHECK] when
  # editing an ADR-managed file
  local h8_2_hook_result
  h8_2_hook_result=$(echo '{"tool_name":"Edit","tool_input":{"file_path":"hooks/scripts/fact-force-gate.js"}}' | node "$CLAUDE_DIR/hooks/scripts/validators/validate-adr-drift.js" 2>/dev/null)
  if echo "$h8_2_hook_result" | grep -q 'ADR-DRIFT-CHECK' && echo "$h8_2_hook_result" | grep -q 'ADR-0001'; then
    echo "  ✓ validate-adr-drift: H.8.2 emits [ADR-DRIFT-CHECK] when editing ADR-managed file"
    passed=$((passed + 1))
  else
    echo "  ✗ validate-adr-drift: H.8.2 should emit forcing instruction with ADR-0001 reference"
    failed=$((failed + 1))
  fi

  # Test 50 (H.8.2): validate-adr-drift hook silent on non-ADR-managed files
  local h8_2_silent_result
  h8_2_silent_result=$(echo '{"tool_name":"Edit","tool_input":{"file_path":"some-random-file.txt"}}' | node "$CLAUDE_DIR/hooks/scripts/validators/validate-adr-drift.js" 2>/dev/null)
  if ! echo "$h8_2_silent_result" | grep -q 'ADR-DRIFT-CHECK'; then
    echo "  ✓ validate-adr-drift: H.8.2 silent (no forcing instruction) on non-ADR-managed file"
    passed=$((passed + 1))
  else
    echo "  ✗ validate-adr-drift: H.8.2 should NOT emit forcing instruction on non-ADR-managed file"
    failed=$((failed + 1))
  fi

  # Test 51 (H.8.2): validate-adr-drift respects SKIP_ADR_CHECK=1 bypass
  local h8_2_bypass_result
  h8_2_bypass_result=$(echo '{"tool_name":"Edit","tool_input":{"file_path":"hooks/scripts/fact-force-gate.js"}}' | SKIP_ADR_CHECK=1 node "$CLAUDE_DIR/hooks/scripts/validators/validate-adr-drift.js" 2>/dev/null)
  if ! echo "$h8_2_bypass_result" | grep -q 'ADR-DRIFT-CHECK'; then
    echo "  ✓ validate-adr-drift: H.8.2 SKIP_ADR_CHECK=1 bypass works"
    passed=$((passed + 1))
  else
    echo "  ✗ validate-adr-drift: H.8.2 SKIP_ADR_CHECK=1 should suppress forcing instruction"
    failed=$((failed + 1))
  fi

  # Test 52 (H.8.3): build-spawn-context composes detector + kb-resolver
  # to produce structured spawn context with detected signals + loaded KB refs
  local h8_3_compose_result
  h8_3_compose_result=$(node "$SCRIPT_DIR/scripts/agent-team/build-spawn-context.js" --task "implement state mutation in distributed system with retry logic" --cap 2 2>/dev/null)
  if echo "$h8_3_compose_result" | grep -q 'SPAWN CONTEXT' && echo "$h8_3_compose_result" | grep -q 'state-mutation' && echo "$h8_3_compose_result" | grep -q 'idempotency' && echo "$h8_3_compose_result" | grep -q 'Tier: summary'; then
    echo "  ✓ build-spawn-context: H.8.3 composes detector + kb-resolver into spawn context"
    passed=$((passed + 1))
  else
    echo "  ✗ build-spawn-context: H.8.3 should produce structured context with signals + KB"
    failed=$((failed + 1))
  fi

  # Test 53 (H.8.3): build-spawn-context surfaces active ADRs when --files
  # argument matches an ADR's files_affected list
  local h8_3_adr_result
  h8_3_adr_result=$(node "$SCRIPT_DIR/scripts/agent-team/build-spawn-context.js" --task "modify hook for new feature" --files "hooks/scripts/fact-force-gate.js" 2>/dev/null)
  if echo "$h8_3_adr_result" | grep -q 'Active ADRs touching' && echo "$h8_3_adr_result" | grep -q 'ADR-0001' && echo "$h8_3_adr_result" | grep -q 'fail open'; then
    echo "  ✓ build-spawn-context: H.8.3 surfaces active ADRs touching specified files"
    passed=$((passed + 1))
  else
    echo "  ✗ build-spawn-context: H.8.3 should include active ADRs touching --files"
    failed=$((failed + 1))
  fi

  # Test 54 (H.8.3): build-spawn-context --format json emits valid JSON
  # with the expected top-level keys
  local h8_3_json_result
  h8_3_json_result=$(node "$SCRIPT_DIR/scripts/agent-team/build-spawn-context.js" --task "extract shared utility" --format json 2>/dev/null)
  if echo "$h8_3_json_result" | python3 -c "import json,sys; d=json.load(sys.stdin); assert 'task' in d and 'detection' in d and 'kb_refs_loaded' in d and 'active_adrs' in d; print('OK')" 2>/dev/null | grep -q 'OK'; then
    echo "  ✓ build-spawn-context: H.8.3 --format json emits valid structured output"
    passed=$((passed + 1))
  else
    echo "  ✗ build-spawn-context: H.8.3 --format json should produce parseable JSON with required keys"
    failed=$((failed + 1))
  fi

  # Test 55: H.8.4 shell-injection regression coverage (chaos C1 fix)
  echo -n "  Test 55 (H.8.4 shell-injection regression — adversarial fixture): "
  # Pre-clean any leftover markers
  rm -f /tmp/PWNED-t55-* 2>/dev/null
  FIXTURE="$SCRIPT_DIR/swarm/test-fixtures/malicious-task-strings.json"
  PAYLOADS_OK=true
  for id in t55-01 t55-02 t55-03 t55-04 t55-05 t55-06; do
    payload=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$FIXTURE','utf8')).payloads.find(p=>p.id==='$id').payload)")
    node "$SCRIPT_DIR/scripts/agent-team/build-spawn-context.js" --task "$payload" --format json >/dev/null 2>&1 || true
  done
  # Hook stdin path (t55-07)
  hook_payload=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$FIXTURE','utf8')).payloads.find(p=>p.id==='t55-07').payload)")
  echo "{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$hook_payload\"}}" | node "$CLAUDE_DIR/hooks/scripts/validators/validate-adr-drift.js" >/dev/null 2>&1 || true
  # Assert NO marker file was created
  for marker in /tmp/PWNED-t55-01 /tmp/PWNED-t55-02 /tmp/PWNED-t55-03 /tmp/PWNED-t55-04 /tmp/PWNED-t55-05 /tmp/PWNED-t55-06 /tmp/PWNED-t55-07; do
    if [ -f "$marker" ]; then PAYLOADS_OK=false; rm -f "$marker"; fi
  done
  if [ "$PAYLOADS_OK" = "true" ]; then
    echo "OK"
    passed=$((passed + 1))
  else
    echo "FAIL: shell injection succeeded — RCE regression!"
    failed=$((failed + 1))
  fi

  # Test 56: H.8.4 non-ASCII chars in detector.js (chaos C2 prevention)
  # Scoped to architecture-relevance-detector.js — the file that had the C2 bug.
  # ROUTING_RULES is the load-bearing data; non-ASCII anywhere outside comments
  # is suspicious in this file specifically. Other files (contract-verifier emojis,
  # prompt-pattern-store control-char escapes) legitimately use non-ASCII.
  # H.8.4 fix per blair post-fix review: BSD grep on macOS does not support -P.
  # Delegated to python3 for cross-platform regex.
  echo -n "  Test 56 (H.8.4 non-ASCII regex-literal invariant — detector.js): "
  NONASCII=$(python3 - <<'PY' "$SCRIPT_DIR"
import os, re, sys
root = sys.argv[1]
target = os.path.join(root, "scripts/agent-team/architecture-relevance-detector.js")
hits = []
nonascii_re = re.compile(r"[^\x00-\x7f]")
in_block_comment = False
try:
    with open(target, "r", encoding="utf8") as fh:
        for lineno, line in enumerate(fh, 1):
            stripped = line.strip()
            # Skip whole-line comments
            if stripped.startswith("//") or stripped.startswith("*"):
                continue
            # Track multi-line /* ... */ blocks
            if "/*" in line and "*/" not in line:
                in_block_comment = True
                continue
            if in_block_comment:
                if "*/" in line:
                    in_block_comment = False
                continue
            # Strip inline /* ... */ block comments before scanning
            scanline = re.sub(r"/\*.*?\*/", "", line)
            # Strip inline // line comments before scanning
            scanline = re.sub(r"//.*$", "", scanline)
            if nonascii_re.search(scanline):
                hits.append(f"{target}:{lineno}:{line.rstrip()[:120]}")
except OSError:
    pass
print("\n".join(hits))
PY
)
  if [ -z "$NONASCII" ]; then
    echo "OK"
    passed=$((passed + 1))
  else
    echo "FAIL: non-ASCII char in regex literal"
    echo "$NONASCII" | head -5
    failed=$((failed + 1))
  fi

  # Test 57: H.8.4 routing-rule count invariant (chaos CC1 prevention)
  # H.8.4 fix per blair post-fix review: BSD grep on macOS does not support -P.
  # Delegated to python3 for cross-platform regex.
  echo -n "  Test 57 (H.8.4 routing-rule count invariant): "
  CANONICAL=$(node "$SCRIPT_DIR/scripts/agent-team/architecture-relevance-detector.js" list-signals 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('rule_count', -1))" 2>/dev/null || echo "-1")
  if [ "$CANONICAL" -lt 1 ]; then
    echo "FAIL: cannot read canonical rule_count"
    failed=$((failed + 1))
  else
    DRIFT_REPORT=$(python3 - <<PY "$SCRIPT_DIR" "$CANONICAL"
import os, re, sys
root = sys.argv[1]
canonical = sys.argv[2]
docs = [
    os.path.join(root, "CHANGELOG.md"),
    os.path.join(root, "skills/agent-team/SKILL.md"),
    os.path.join(root, "swarm/kb-architecture-planning/_NOTES.md"),
    os.path.join(root, "README.md"),
]
pat = re.compile(r"(\d+)\s+routing\s+rules?", re.IGNORECASE)
drift = []
for doc in docs:
    if not os.path.isfile(doc):
        continue
    with open(doc, "r", encoding="utf8") as fh:
        for lineno, line in enumerate(fh, 1):
            for m in pat.finditer(line):
                if m.group(1) != canonical:
                    drift.append(f"{doc}:{lineno}: says {m.group(1)}, canonical is {canonical}")
print("\n".join(drift))
PY
)
    if [ -z "$DRIFT_REPORT" ]; then
      echo "OK ($CANONICAL rules)"
      passed=$((passed + 1))
    else
      echo "FAIL: routing-rule count drift detected"
      echo "$DRIFT_REPORT" | head -5
      failed=$((failed + 1))
    fi
  fi

  # Test 58: H.8.6 — three documentary persona contracts (14/15/16) present with documentary:true
  echo -n "  Test 58 (H.8.6 documentary persona contracts present + documentary flag): "
  T58_OK=true
  for n in 14-codebase-locator 15-codebase-analyzer 16-codebase-pattern-finder; do
    F="$SCRIPT_DIR/swarm/personas-contracts/${n}.contract.json"
    if [ ! -f "$F" ]; then
      T58_OK=false; break
    fi
    DOC_FLAG=$(python3 -c "import json; d=json.load(open('$F')); print(d.get('documentary', False))" 2>/dev/null)
    if [ "$DOC_FLAG" != "True" ]; then
      T58_OK=false; break
    fi
  done
  if [ "$T58_OK" = "true" ]; then
    echo "OK (14/15/16 present, documentary:true)"
    passed=$((passed + 1))
  else
    echo "FAIL: missing contract or documentary flag"
    failed=$((failed + 1))
  fi

  # Test 59: H.8.6 — RPI slash commands present (/research + /implement)
  echo -n "  Test 59 (H.8.6 RPI slash commands /research + /implement present): "
  if [ -f "$SCRIPT_DIR/commands/research.md" ] && [ -f "$SCRIPT_DIR/commands/implement.md" ]; then
    echo "OK"
    passed=$((passed + 1))
  else
    echo "FAIL: missing /research or /implement command"
    failed=$((failed + 1))
  fi

  # Test 60: H.8.6 — thoughts/ filesystem layout
  echo -n "  Test 60 (H.8.6 thoughts/ filesystem layout): "
  if [ -d "$SCRIPT_DIR/swarm/thoughts/shared/research" ] \
     && [ -d "$SCRIPT_DIR/swarm/thoughts/shared/plans" ] \
     && [ -f "$SCRIPT_DIR/swarm/thoughts/README.md" ] \
     && [ -f "$SCRIPT_DIR/swarm/thoughts/shared/research/README.md" ] \
     && [ -f "$SCRIPT_DIR/swarm/thoughts/shared/plans/README.md" ]; then
    echo "OK"
    passed=$((passed + 1))
  else
    echo "FAIL: missing thoughts/ dir or README"
    failed=$((failed + 1))
  fi

  # Test 61: H.8.7 — _lib/frontmatter.js extracted; consumers consume helper
  echo -n "  Test 61 (H.8.7 _lib/frontmatter.js extracted; no inline parseFrontmatter in consumers): "
  if [ -f "$SCRIPT_DIR/scripts/agent-team/_lib/frontmatter.js" ] \
     && grep -q "require.*_lib/frontmatter" "$SCRIPT_DIR/scripts/agent-team/kb-resolver.js" \
     && grep -q "require.*_lib/frontmatter" "$SCRIPT_DIR/scripts/agent-team/adr.js" \
     && ! grep -qE '^function parseFrontmatter' "$SCRIPT_DIR/scripts/agent-team/kb-resolver.js" \
     && ! grep -qE '^function parseFrontmatter' "$SCRIPT_DIR/scripts/agent-team/adr.js"; then
    echo "OK"
    passed=$((passed + 1))
  else
    echo "FAIL: helper missing or inline parseFrontmatter remains"
    failed=$((failed + 1))
  fi

  # Test 62: H.8.7 — extractSections fence-aware (chaos H1)
  echo -n "  Test 62 (H.8.7 extractSections fence-aware): "
  T62_TMPDIR=$(mktemp -d)
  T62_KBDIR="$T62_TMPDIR/kb"
  mkdir -p "$T62_KBDIR/test"
  cat > "$T62_KBDIR/test/fence.md" <<'EOF'
---
kb_id: test/fence
---

## Summary

This is the summary.

```
## NotASection
This is inside a code fence and must not be detected as a boundary.
```

## Quick Reference

This is the quick reference.

## Full Content

This is the full content.
EOF
  T62_OUT=$(HETS_KB_DIR="$T62_KBDIR" node "$SCRIPT_DIR/scripts/agent-team/kb-resolver.js" cat-summary test/fence 2>/dev/null)
  # Summary should include "## Summary" + body + the fenced block + closing fence
  # Summary should NOT include "## Quick Reference" (it's the next real H2)
  if echo "$T62_OUT" | grep -q "This is the summary" \
     && echo "$T62_OUT" | grep -q "inside a code fence" \
     && ! echo "$T62_OUT" | grep -q "This is the quick reference"; then
    echo "OK"
    passed=$((passed + 1))
  else
    echo "FAIL: extractSections fence-blindness regressed or other extraction issue"
    failed=$((failed + 1))
  fi
  rm -rf "$T62_TMPDIR"

  # Test 63: H.8.7 — touched-by path-segment-aware (chaos H2)
  echo -n "  Test 63 (H.8.7 touched-by path-segment-aware; barfoo.js does NOT match foo.js): "
  T63_TMPDIR=$(mktemp -d)
  T63_ADRS="$T63_TMPDIR/adrs"
  mkdir -p "$T63_ADRS"
  cat > "$T63_ADRS/0099-test.md" <<'EOF'
---
adr_id: 0099
title: "Test ADR for path-segment matching"
status: accepted
superseded_by: null
files_affected:
  - hooks/scripts/foo.js
invariants_introduced:
  - test invariant
---
## Context
Test.
EOF
  T63_TRUE_POSITIVE=$(HETS_ADRS_DIR="$T63_ADRS" node "$SCRIPT_DIR/scripts/agent-team/adr.js" touched-by hooks/scripts/foo.js 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('matched_count', -1))")
  T63_FALSE_POSITIVE=$(HETS_ADRS_DIR="$T63_ADRS" node "$SCRIPT_DIR/scripts/agent-team/adr.js" touched-by hooks/scripts/barfoo.js 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('matched_count', -1))")
  if [ "$T63_TRUE_POSITIVE" = "1" ] && [ "$T63_FALSE_POSITIVE" = "0" ]; then
    echo "OK (true-positive=1, false-positive=0)"
    passed=$((passed + 1))
  else
    echo "FAIL: true=$T63_TRUE_POSITIVE (want 1), false=$T63_FALSE_POSITIVE (want 0)"
    failed=$((failed + 1))
  fi
  rm -rf "$T63_TMPDIR"

  # Test 64: H.8.7 — cmdNew YAML escaping (chaos H3)
  echo -n "  Test 64 (H.8.7 cmdNew YAML escaping; title with quotes does not corrupt frontmatter): "
  T64_TMPDIR=$(mktemp -d)
  T64_ADRS="$T64_TMPDIR/adrs"
  mkdir -p "$T64_ADRS"
  cp "$SCRIPT_DIR/swarm/adrs/_TEMPLATE.md" "$T64_ADRS/_TEMPLATE.md" 2>/dev/null
  T64_NEW=$(HETS_ADRS_DIR="$T64_ADRS" node "$SCRIPT_DIR/scripts/agent-team/adr.js" new --title 'Test "quoted" title' 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('filename', ''))")
  if [ -n "$T64_NEW" ] && [ -f "$T64_ADRS/$T64_NEW" ]; then
    # Verify the file has properly escaped title
    T64_TITLE_LINE=$(grep '^title:' "$T64_ADRS/$T64_NEW")
    if echo "$T64_TITLE_LINE" | grep -q 'Test \\"quoted\\" title'; then
      # Verify the ADR loads cleanly
      T64_LOAD=$(HETS_ADRS_DIR="$T64_ADRS" node "$SCRIPT_DIR/scripts/agent-team/adr.js" list 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('count', -1))")
      if [ "$T64_LOAD" = "1" ]; then
        echo "OK (title escaped + ADR loads)"
        passed=$((passed + 1))
      else
        echo "FAIL: ADR not loadable post-creation"
        failed=$((failed + 1))
      fi
    else
      echo "FAIL: title not escaped — got: $T64_TITLE_LINE"
      failed=$((failed + 1))
    fi
  else
    echo "FAIL: cmdNew did not produce file"
    failed=$((failed + 1))
  fi
  rm -rf "$T64_TMPDIR"

  # Test 66: H.8.8 — validate-kb-doc.js fires [KB-DOC-INCOMPLETE] on incomplete kb/architecture doc
  echo -n "  Test 66 (H.8.8 validate-kb-doc emits forcing instruction on incomplete kb doc): "
  T66_TMPDIR=$(mktemp -d)
  T66_KB_DOC="$T66_TMPDIR/kb/architecture/test/incomplete.md"
  mkdir -p "$(dirname "$T66_KB_DOC")"
  cat > "$T66_KB_DOC" <<EOF
---
kb_id: architecture/test/incomplete
---

## Summary

This doc has frontmatter and a Summary but is missing tags, Quick Reference.
EOF
  T66_OUT=$(echo "{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$T66_KB_DOC\"}}" | node "$SCRIPT_DIR/hooks/scripts/validators/validate-kb-doc.js" 2>/dev/null)
  T66_DECISION=$(echo "$T66_OUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('decision', ''))")
  T66_HAS_MARKER=$(echo "$T66_OUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print('[KB-DOC-INCOMPLETE]' in d.get('reason',''))")
  if [ "$T66_DECISION" = "approve" ] && [ "$T66_HAS_MARKER" = "True" ]; then
    echo "OK (approve + [KB-DOC-INCOMPLETE] marker)"
    passed=$((passed + 1))
  else
    echo "FAIL: decision=$T66_DECISION marker=$T66_HAS_MARKER"
    failed=$((failed + 1))
  fi
  rm -rf "$T66_TMPDIR"

  # Test 67: H.8.8 — validate-kb-doc.js silent (no forcing instruction) on complete kb doc
  echo -n "  Test 67 (H.8.8 validate-kb-doc silent on complete kb/architecture doc): "
  T67_DOC="$SCRIPT_DIR/skills/agent-team/kb/architecture/crosscut/single-responsibility.md"
  T67_OUT=$(echo "{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$T67_DOC\"}}" | node "$SCRIPT_DIR/hooks/scripts/validators/validate-kb-doc.js" 2>/dev/null)
  T67_HAS_REASON=$(echo "$T67_OUT" | python3 -c "import json,sys; print('reason' in json.load(sys.stdin))")
  if [ "$T67_HAS_REASON" = "False" ]; then
    echo "OK (silent approve)"
    passed=$((passed + 1))
  else
    echo "FAIL: complete kb doc emitted reason"
    failed=$((failed + 1))
  fi

  # Test 68: H.8.8 — SKIP_KB_DOC_CHECK=1 bypass works
  echo -n "  Test 68 (H.8.8 SKIP_KB_DOC_CHECK=1 bypass): "
  T68_TMPDIR=$(mktemp -d)
  T68_KB_DOC="$T68_TMPDIR/kb/architecture/test/incomplete.md"
  mkdir -p "$(dirname "$T68_KB_DOC")"
  echo "no frontmatter no sections" > "$T68_KB_DOC"
  T68_OUT=$(echo "{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$T68_KB_DOC\"}}" | SKIP_KB_DOC_CHECK=1 node "$SCRIPT_DIR/hooks/scripts/validators/validate-kb-doc.js" 2>/dev/null)
  T68_HAS_REASON=$(echo "$T68_OUT" | python3 -c "import json,sys; print('reason' in json.load(sys.stdin))")
  if [ "$T68_HAS_REASON" = "False" ]; then
    echo "OK (bypass works)"
    passed=$((passed + 1))
  else
    echo "FAIL: bypass did not work"
    failed=$((failed + 1))
  fi
  rm -rf "$T68_TMPDIR"

  # Test 65: H.8.7 — adr.js symlink defense (chaos M3)
  echo -n "  Test 65 (H.8.7 adr.js symlink defense; symlink in ADRS_DIR ignored): "
  T65_TMPDIR=$(mktemp -d)
  T65_ADRS="$T65_TMPDIR/adrs"
  T65_TARGET="$T65_TMPDIR/target"
  mkdir -p "$T65_ADRS" "$T65_TARGET"
  # Plant a symlink with valid-looking name pointing outside
  ln -s "$T65_TARGET/0099-malicious.md" "$T65_ADRS/0099-malicious.md" 2>/dev/null
  # touched-by + active should not crash + should not include the symlink as a loaded ADR
  T65_LIST=$(HETS_ADRS_DIR="$T65_ADRS" node "$SCRIPT_DIR/scripts/agent-team/adr.js" list 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('count', -1))")
  if [ "$T65_LIST" = "0" ]; then
    echo "OK (symlink filtered out)"
    passed=$((passed + 1))
  else
    echo "FAIL: list count = $T65_LIST (want 0)"
    failed=$((failed + 1))
  fi
  rm -rf "$T65_TMPDIR"

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
