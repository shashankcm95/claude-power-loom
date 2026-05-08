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

  # Test 10 (H.4.3): prompt-enrich-trigger emits [CONFIRMATION-UNCERTAIN]
  # for short ambiguous prompts that fail strict skip regex
  local h43_uncertain_result
  h43_uncertain_result=$(echo '{"prompt":"go on"}' | node "$CLAUDE_DIR/hooks/scripts/prompt-enrich-trigger.js" 2>/dev/null)
  if echo "$h43_uncertain_result" | grep -q 'CONFIRMATION-UNCERTAIN'; then
    echo "  ✓ prompt-enrich-trigger: H.4.3 [CONFIRMATION-UNCERTAIN] forcing instruction"
    passed=$((passed + 1))
  else
    echo "  ✗ prompt-enrich-trigger: H.4.3 [CONFIRMATION-UNCERTAIN] missing — got: ${h43_uncertain_result:0:80}"
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

  # Test 19 (H.7.18): markdown emphasis validator — Tier 1 cluster fires forcing instruction
  # 2+ unbackticked underscore-bearing tokens in same paragraph → [MARKDOWN-EMPHASIS-DRIFT]
  local h7_18_tier1_json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/emphasis-test.md","content":"# Title\n\nThis paragraph mentions HETS_TOOLKIT_DIR and CLAUDE_PLUGIN_ROOT outside backticks.\n"}}'
  local h7_18_tier1_result
  h7_18_tier1_result=$(printf '%s' "$h7_18_tier1_json" | node "$CLAUDE_DIR/hooks/scripts/validators/validate-markdown-emphasis.js" 2>&1)
  if echo "$h7_18_tier1_result" | grep -q '\[MARKDOWN-EMPHASIS-DRIFT\]' && echo "$h7_18_tier1_result" | grep -q 'HETS_TOOLKIT_DIR'; then
    echo "  ✓ validate-markdown-emphasis: H.7.18 Tier 1 cluster fires [MARKDOWN-EMPHASIS-DRIFT]"
    passed=$((passed + 1))
  else
    echo "  ✗ validate-markdown-emphasis: H.7.18 Tier 1 cluster should fire forcing instruction"
    failed=$((failed + 1))
  fi

  # Test 20 (H.7.18): same tokens backticked → silent (no false positive)
  local h7_18_clean_json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/emphasis-clean.md","content":"# Title\n\nThis paragraph mentions `HETS_TOOLKIT_DIR` and `CLAUDE_PLUGIN_ROOT` properly backticked.\n"}}'
  local h7_18_clean_result
  h7_18_clean_result=$(printf '%s' "$h7_18_clean_json" | node "$CLAUDE_DIR/hooks/scripts/validators/validate-markdown-emphasis.js" 2>&1)
  if echo "$h7_18_clean_result" | grep -q 'MARKDOWN-EMPHASIS-DRIFT'; then
    echo "  ✗ validate-markdown-emphasis: H.7.18 backticked tokens should NOT fire (false positive)"
    failed=$((failed + 1))
  else
    echo "  ✓ validate-markdown-emphasis: H.7.18 backticked tokens stay silent (no false positive)"
    passed=$((passed + 1))
  fi

  # Test 21 (H.7.18): non-.md path → silent (path filter)
  local h7_18_nonmd_json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.json","content":"HETS_TOOLKIT_DIR and CLAUDE_PLUGIN_ROOT"}}'
  local h7_18_nonmd_result
  h7_18_nonmd_result=$(printf '%s' "$h7_18_nonmd_json" | node "$CLAUDE_DIR/hooks/scripts/validators/validate-markdown-emphasis.js" 2>&1)
  if echo "$h7_18_nonmd_result" | grep -q 'MARKDOWN-EMPHASIS-DRIFT'; then
    echo "  ✗ validate-markdown-emphasis: H.7.18 non-.md path should be silent (path filter)"
    failed=$((failed + 1))
  else
    echo "  ✓ validate-markdown-emphasis: H.7.18 non-.md path stays silent (path filter excludes)"
    passed=$((passed + 1))
  fi

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
