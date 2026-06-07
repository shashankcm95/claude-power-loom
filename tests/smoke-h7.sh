# shellcheck shell=bash
# shellcheck disable=SC2168  # H.9.1 — sourced by install.sh run_smoke_tests(); `local` is function-scope at runtime
# tests/smoke-h7.sh — H.7.x phase-era smoke tests.
#
# Sourced by install.sh run_smoke_tests() function; mutates parent-scope
# $passed and $failed counters via bash lexical-scope inheritance.
#
# Per HT.1.4 (ADR-0002 cross-language application — bash sourced-file
# post-split shape). Test count: 26 (tests 11-19, 22-27, 30-40 — H.7.x;
# tests 20-21 retired with validate-markdown-emphasis.js at H.7.27;
# tests 28-29 retired with plugin-loaded-check.js at H.7.26).
#
# Normally SOURCED by install.sh run_smoke_tests() (which sets SCRIPT_DIR /
# CLAUDE_DIR / the passed+failed counters). For ad-hoc standalone diagnostics
# (`bash tests/smoke-h7.sh`) the two path roots fall back to this repo so the
# `$SCRIPT_DIR/...` / `$CLAUDE_DIR/...` invocations resolve instead of becoming
# `/...` (MODULE_NOT_FOUND). The `:=` defaults NEVER override values install.sh
# already set; the passed/failed counters still accumulate from 0, but the final
# summary line is only printed by install.sh's run_smoke_tests() when sourced.
: "${SCRIPT_DIR:=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
: "${CLAUDE_DIR:=$SCRIPT_DIR}"

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
  h77_first_result=$(echo '{"tool_name":"Bash","tool_input":{"command":"npm test"},"tool_response":{"stderr":"Error: failed","is_error":true}}' | CLAUDE_SESSION_ID="$h77_session" node "$CLAUDE_DIR/packages/kernel/hooks/post/error-critic.js" 2>/dev/null)
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
  h77_second_result=$(echo '{"tool_name":"Bash","tool_input":{"command":"npm test"},"tool_response":{"stderr":"Error: failed again","is_error":true}}' | CLAUDE_SESSION_ID="$h77_session" node "$CLAUDE_DIR/packages/kernel/hooks/post/error-critic.js" 2>/dev/null)
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
  h7_10_result=$(echo '{"tool_name":"Bash","tool_input":{"command":"npm test"},"tool_response":{"stderr":"Error: failed in B","is_error":true}}' | CLAUDE_SESSION_ID="$h7_10_session" node "$CLAUDE_DIR/packages/kernel/hooks/post/error-critic.js" 2>/dev/null)
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
  h7_12_compliant=$(printf '%s' "$h7_12_compliant_json" | node "$CLAUDE_DIR/packages/kernel/validators/validate-plan-schema.js" 2>&1)
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
  h7_12_missing_t1=$(printf '%s' "$h7_12_missing_t1_json" | node "$CLAUDE_DIR/packages/kernel/validators/validate-plan-schema.js" 2>&1)
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
  h7_12_missing_t2=$(printf '%s' "$h7_12_missing_t2_json" | node "$CLAUDE_DIR/packages/kernel/validators/validate-plan-schema.js" 2>&1)
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
  h7_12_nonplan=$(printf '%s' "$h7_12_nonplan_json" | node "$CLAUDE_DIR/packages/kernel/validators/validate-plan-schema.js" 2>&1)
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
  h7_15_custom_result=$(printf '%s' "$h7_15_custom_path_json" | CLAUDE_PLAN_DIR=/tmp/custom-plans node "$CLAUDE_DIR/packages/kernel/validators/validate-plan-schema.js" 2>&1)
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
  local h7_20_skill_dir="/tmp/h7-20-skills/skills/library/test"
  mkdir -p "$h7_20_skill_dir"
  cat > "$h7_20_skill_dir/SKILL.md" <<'SKILL_EOF'
---
name: test-skill
description: H.7.20 test fixture
---

# Test Skill

Body content here.
SKILL_EOF
  local h7_20_remove_json='{"tool_name":"Edit","tool_input":{"file_path":"/tmp/h7-20-skills/skills/library/test/SKILL.md","old_string":"---\nname: test-skill\ndescription: H.7.20 test fixture\n---\n\n","new_string":""}}'
  local h7_20_remove_result
  h7_20_remove_result=$(printf '%s' "$h7_20_remove_json" | node "$CLAUDE_DIR/packages/kernel/validators/validate-frontmatter-on-skills.js" 2>&1)
  if echo "$h7_20_remove_result" | grep -q '"decision":"block"'; then
    echo "  ✓ validate-frontmatter-on-skills: H.7.20 Edit-removes-frontmatter → block"
    passed=$((passed + 1))
  else
    echo "  ✗ validate-frontmatter-on-skills: H.7.20 Edit removing frontmatter should block — got: ${h7_20_remove_result:0:80}"
    failed=$((failed + 1))
  fi

  # Test 23 (H.7.20): Edit that touches body but preserves frontmatter → approve
  local h7_20_preserve_json='{"tool_name":"Edit","tool_input":{"file_path":"/tmp/h7-20-skills/skills/library/test/SKILL.md","old_string":"Body content here.","new_string":"Updated body content."}}'
  local h7_20_preserve_result
  h7_20_preserve_result=$(printf '%s' "$h7_20_preserve_json" | node "$CLAUDE_DIR/packages/kernel/validators/validate-frontmatter-on-skills.js" 2>&1)
  if echo "$h7_20_preserve_result" | grep -q '"decision":"approve"'; then
    echo "  ✓ validate-frontmatter-on-skills: H.7.20 Edit-preserves-frontmatter → approve"
    passed=$((passed + 1))
  else
    echo "  ✗ validate-frontmatter-on-skills: H.7.20 Edit preserving frontmatter should approve — got: ${h7_20_preserve_result:0:80}"
    failed=$((failed + 1))
  fi
  # Test 23b (v3.4 migration-rot fix): skills/commands/*.md ship frontmatter-less by convention —
  # the gate must EXCLUDE them (the regression that mis-blocked command-doc edits; the prior regex
  # `skills/<dir>/<file>.md` wrongly matched skills/commands/*). A frontmatter-less command → approve.
  local h7_cmd_json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/h7-20-skills/skills/commands/build-team.md","content":"# /build-team\n\nno frontmatter\n"}}'
  local h7_cmd_result
  h7_cmd_result=$(printf '%s' "$h7_cmd_json" | node "$CLAUDE_DIR/packages/kernel/validators/validate-frontmatter-on-skills.js" 2>&1)
  if echo "$h7_cmd_result" | grep -q '"decision":"approve"'; then
    echo "  ✓ validate-frontmatter-on-skills: skills/commands/*.md frontmatter-less → approve (excluded)"
    passed=$((passed + 1))
  else
    echo "  ✗ validate-frontmatter-on-skills: command doc should approve (excluded) — got: ${h7_cmd_result:0:80}"
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
  h7_21_complete_result=$(printf '%s' "$h7_21_complete_json" | node "$CLAUDE_DIR/packages/kernel/validators/validate-no-bare-secrets.js" 2>&1)
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
  h7_21_unrelated_result=$(printf '%s' "$h7_21_unrelated_json" | node "$CLAUDE_DIR/packages/kernel/validators/validate-no-bare-secrets.js" 2>&1)
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
  h7_21_preexist_result=$(printf '%s' "$h7_21_preexist_json" | node "$CLAUDE_DIR/packages/kernel/validators/validate-no-bare-secrets.js" 2>&1)
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
  h7_22_plan_result=$(echo "$h7_22_plan_json" | node "$CLAUDE_DIR/packages/kernel/validators/validate-plan-schema.js" 2>&1)
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
  h7_23_schema_result=$(node "$SCRIPT_DIR/packages/runtime/orchestration/contracts-validate.js" --scope contract-marketplace-schema 2>&1)
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
  h7_23_plan_result=$(echo "$h7_23_plan_json" | node "$CLAUDE_DIR/packages/kernel/validators/validate-plan-schema.js" 2>&1)
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
const r = require('$SCRIPT_DIR/packages/kernel/hooks/_lib/marketplace-state-reader.js');
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
  h7_23_1_block_result=$(echo '{"tool_name":"ExitPlanMode"}' | CLAUDE_PLAN_DIR=/tmp/h7-23-1-gate-test node "$CLAUDE_DIR/packages/kernel/hooks/pre/verify-plan-gate.js" 2>&1)
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
  h7_23_1_approve_result=$(echo '{"tool_name":"ExitPlanMode"}' | CLAUDE_PLAN_DIR=/tmp/h7-23-1-gate-test node "$CLAUDE_DIR/packages/kernel/hooks/pre/verify-plan-gate.js" 2>&1)
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
  h7_23_1_bypass_result=$(echo '{"tool_name":"ExitPlanMode"}' | SKIP_VERIFY_PLAN=1 CLAUDE_PLAN_DIR=/tmp/h7-23-1-gate-test node "$CLAUDE_DIR/packages/kernel/hooks/pre/verify-plan-gate.js" 2>&1)
  if echo "$h7_23_1_bypass_result" | grep -q '"approve"'; then
    echo "  ✓ verify-plan-gate: H.7.23.1 SKIP_VERIFY_PLAN=1 bypass works"
    passed=$((passed + 1))
  else
    echo "  ✗ verify-plan-gate: H.7.23.1 bypass should approve — got: ${h7_23_1_bypass_result:0:200}"
    failed=$((failed + 1))
  fi
  rm -rf /tmp/h7-23-1-gate-test

  # Test 36 (H.7.24): all SKILL.md files have frontmatter (drift-note 49 closure)
  # Phase-1-alpha/0a (SC2044): rewritten from `for f in $(find ...)` to
  # null-delimited `while read -d ''` per SC2044 — same fix-pattern as
  # #164 nova round-2 absorption. For-loops over find output are fragile
  # to whitespace in paths.
  local h7_24_missing_frontmatter=0
  while IFS= read -r -d '' skill_file; do
    local first_line
    first_line=$(head -1 "$skill_file")
    if [ "$first_line" != "---" ]; then
      h7_24_missing_frontmatter=$((h7_24_missing_frontmatter + 1))
    fi
  done < <(find "$SCRIPT_DIR/skills" -name "SKILL.md" -print0 2>/dev/null)
  if [ "$h7_24_missing_frontmatter" -eq 0 ]; then
    echo "  ✓ skill-files-frontmatter: H.7.24 all SKILL.md files have frontmatter"
    passed=$((passed + 1))
  else
    echo "  ✗ skill-files-frontmatter: H.7.24 $h7_24_missing_frontmatter SKILL.md file(s) missing frontmatter"
    failed=$((failed + 1))
  fi

  # Test 37 (H.7.24): prompt-enrich-trigger SKIPs `?` (drift-note 52 closure)
  local h7_24_qmark_result
  h7_24_qmark_result=$(echo '{"prompt":"?"}' | node "$CLAUDE_DIR/packages/kernel/hooks/lifecycle/prompt-enrich-trigger.js" 2>&1)
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
  h7_24_enabled_result=$(HOME=/tmp/h7-24-mock-home node "$SCRIPT_DIR/packages/runtime/orchestration/contracts-validate.js" --scope contract-plugin-hook-deployment 2>&1 || true)
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
  local h7_25_catalog="$SCRIPT_DIR/packages/skills/library/agent-team/patterns/forcing-instruction-family.md"
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
  local h7_25_conv="$SCRIPT_DIR/packages/skills/library/agent-team/patterns/validator-conventions.md"
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

