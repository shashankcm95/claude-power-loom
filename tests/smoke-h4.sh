# shellcheck shell=bash
# shellcheck disable=SC2168  # H.9.1 — sourced by install.sh run_smoke_tests(); `local` is function-scope at runtime
# tests/smoke-h4.sh — pre-H.x cohort + H.4.x phase-era smoke tests.
#
# Sourced by install.sh run_smoke_tests() function; mutates parent-scope
# $passed and $failed counters via bash lexical-scope inheritance.
#
# Per HT.1.4 (ADR-0002 cross-language application — bash sourced-file
# post-split shape). Test count: 10 (tests 1-10).
#
# DO NOT execute directly — depends on parent-scope `local passed`,
# `local failed`, and `$CLAUDE_DIR` / `$SCRIPT_DIR` set by install.sh.

  # Test 1: fact-force-gate blocks unread file
  local result
  result=$(echo '{"tool_name":"Edit","tool_input":{"file_path":"/tmp/test-fact-gate-unread.txt"}}' | node "$CLAUDE_DIR/packages/kernel/hooks/pre/fact-force-gate.js" 2>/dev/null)
  if echo "$result" | grep -q '"decision":"block"'; then
    echo "  ✓ fact-force-gate: blocks unread existing file"
    passed=$((passed + 1))
  else
    echo "  ✗ fact-force-gate: FAILED to block unread file"
    failed=$((failed + 1))
  fi

  # Test 2: fact-force-gate allows new file
  result=$(echo '{"tool_name":"Write","tool_input":{"file_path":"/tmp/nonexistent-test-file-99999.txt"}}' | node "$CLAUDE_DIR/packages/kernel/hooks/pre/fact-force-gate.js" 2>/dev/null)
  if echo "$result" | grep -q '"decision":"approve"'; then
    echo "  ✓ fact-force-gate: allows new file creation"
    passed=$((passed + 1))
  else
    echo "  ✗ fact-force-gate: FAILED to allow new file"
    failed=$((failed + 1))
  fi

  # Test 3: config-guard blocks eslintrc
  result=$(echo '{"tool_name":"Edit","tool_input":{"file_path":"/app/.eslintrc.json"}}' | node "$CLAUDE_DIR/packages/kernel/hooks/pre/config-guard.js" 2>/dev/null)
  if echo "$result" | grep -q '"decision":"block"'; then
    echo "  ✓ config-guard: blocks .eslintrc edits"
    passed=$((passed + 1))
  else
    echo "  ✗ config-guard: FAILED to block .eslintrc"
    failed=$((failed + 1))
  fi

  # Test 4: config-guard allows normal files
  result=$(echo '{"tool_name":"Edit","tool_input":{"file_path":"/app/src/index.ts"}}' | node "$CLAUDE_DIR/packages/kernel/hooks/pre/config-guard.js" 2>/dev/null)
  if echo "$result" | grep -q '"decision":"approve"'; then
    echo "  ✓ config-guard: allows normal file edits"
    passed=$((passed + 1))
  else
    echo "  ✗ config-guard: FAILED to allow normal file"
    failed=$((failed + 1))
  fi

  # Test 5: session-reset runs clean and writes NO tracker. ③.1-W1 removed the old
  # reset-write — the fact-force-gate owns its per-session tracker (loadTracker's
  # clean-on-missing already yields a fresh slate per session_id). The sweep is
  # exercised by tests/unit/hooks/session-reset.test.js; here we only smoke the contract.
  local tmpdir sr_rc
  tmpdir=$(node -e "process.stdout.write(require('os').tmpdir())")
  CLAUDE_SESSION_ID="smoke-test" node "$CLAUDE_DIR/packages/kernel/hooks/lifecycle/session-reset.js" 2>/dev/null
  sr_rc=$?
  if [ $sr_rc -eq 0 ] && [ ! -f "$tmpdir/claude-read-tracker-smoke-test.json" ]; then
    echo "  ✓ session-reset: runs clean, writes no tracker (③.1-W1)"
    passed=$((passed + 1))
  else
    echo "  ✗ session-reset: expected exit 0 + no tracker write (rc=$sr_rc)"
    rm -f "$tmpdir/claude-read-tracker-smoke-test.json"
    failed=$((failed + 1))
  fi

  # Test 6: prompt-enrich-trigger flags vague prompts
  local vague_result
  vague_result=$(echo '{"prompt":"fix the auth"}' | node "$CLAUDE_DIR/packages/kernel/hooks/lifecycle/prompt-enrich-trigger.js" 2>/dev/null)
  if echo "$vague_result" | grep -q 'PROMPT-ENRICHMENT-GATE'; then
    echo "  ✓ prompt-enrich-trigger: flags vague prompt"
    passed=$((passed + 1))
  else
    echo "  ✗ prompt-enrich-trigger: FAILED to flag vague prompt"
    failed=$((failed + 1))
  fi

  # Test 7: prompt-enrich-trigger skips clear prompts
  local clear_result
  clear_result=$(echo '{"prompt":"git push origin main"}' | node "$CLAUDE_DIR/packages/kernel/hooks/lifecycle/prompt-enrich-trigger.js" 2>/dev/null)
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
  h43_variant_result=$(echo '{"prompt":"sure, go for it"}' | node "$CLAUDE_DIR/packages/kernel/hooks/lifecycle/prompt-enrich-trigger.js" 2>/dev/null)
  if [ -z "$h43_variant_result" ]; then
    echo "  ✓ prompt-enrich-trigger: H.4.3 confirmation-variant skip (sure, go for it)"
    passed=$((passed + 1))
  else
    echo "  ✗ prompt-enrich-trigger: H.4.3 confirmation-variant LEAKED (sure, go for it)"
    failed=$((failed + 1))
  fi

  # Test 9 (H.4.3): prompt-enrich-trigger skips standalone "go for it"
  local h43_standalone_result
  h43_standalone_result=$(echo '{"prompt":"go for it"}' | node "$CLAUDE_DIR/packages/kernel/hooks/lifecycle/prompt-enrich-trigger.js" 2>/dev/null)
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
  h43_uncertain_result=$(echo '{"prompt":"go on"}' | node "$CLAUDE_DIR/packages/kernel/hooks/lifecycle/prompt-enrich-trigger.js" 2>/dev/null)
  if echo "$h43_uncertain_result" | grep -q 'PROMPT-ENRICHMENT-GATE' && echo "$h43_uncertain_result" | grep -q 'tier: short-confirm'; then
    echo "  ✓ prompt-enrich-trigger: H.7.26 [PROMPT-ENRICHMENT-GATE] tier: short-confirm fires (consolidated from [CONFIRMATION-UNCERTAIN])"
    passed=$((passed + 1))
  else
    echo "  ✗ prompt-enrich-trigger: H.7.26 short-confirm tier missing — got: ${h43_uncertain_result:0:120}"
    failed=$((failed + 1))
  fi

