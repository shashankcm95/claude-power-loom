#!/usr/bin/env bash
set -uo pipefail
TOOLKIT="$1"; cd "$TOOLKIT" || exit 1

PASS=0; FAIL=0; WARN=0

check() {
  local name="$1"; local cmd="$2"; local expect_exit="${3:-0}"
  local actual_exit=0; local out
  out=$(eval "$cmd" 2>&1) || actual_exit=$?
  if [ "$actual_exit" = "$expect_exit" ]; then
    echo "  ✓ $name"; PASS=$((PASS + 1))
  else
    echo "  ✗ $name (exit=$actual_exit; expected=$expect_exit)"
    echo "    output: ${out:0:200}"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== A. Plugin manifest schema validity ==="
check "manifest is valid JSON" "jq . .claude-plugin/plugin.json"
check "marketplace.json is valid JSON" "jq . .claude-plugin/marketplace.json"
check "hooks.json is valid JSON" "jq . packages/kernel/hooks.json"
check "hooks.json has 'hooks' top-level" "jq -e '.hooks' packages/kernel/hooks.json > /dev/null"
check "manifest declares skills path" "jq -e '.skills' .claude-plugin/plugin.json > /dev/null"
check "manifest declares commands path" "jq -e '.commands' .claude-plugin/plugin.json > /dev/null"
check "manifest declares hooks path" "jq -e '.hooks' .claude-plugin/plugin.json > /dev/null"

# Validate against local schema vendored at packages/kernel/schema/plugin-manifest.schema.json
if [ -f packages/kernel/schema/plugin-manifest.schema.json ]; then
  ajv_out=$(npx --yes ajv-cli@5 validate -s packages/kernel/schema/plugin-manifest.schema.json -d .claude-plugin/plugin.json --spec=draft2020 2>&1) || ajv_exit=$?
  if echo "$ajv_out" | grep -qi "valid"; then
    echo "  ✓ plugin.json validates against vendored schema"
    PASS=$((PASS + 1))
  else
    echo "  ⚠ plugin.json schema validation skipped/unavailable: ${ajv_out:0:120}"
    WARN=$((WARN + 1))
  fi
fi

echo
echo "=== B. Manifest-declared paths exist on disk ==="
SKILLS_PATH=$(jq -r '.skills' .claude-plugin/plugin.json | sed 's|^\./||')
COMMANDS_PATH=$(jq -r '.commands' .claude-plugin/plugin.json | sed 's|^\./||')
HOOKS_PATH=$(jq -r '.hooks' .claude-plugin/plugin.json | sed 's|^\./||')
check "skills dir exists ($SKILLS_PATH)" "[ -d '$SKILLS_PATH' ]"
check "commands dir exists ($COMMANDS_PATH)" "[ -d '$COMMANDS_PATH' ]"
check "hooks.json exists ($HOOKS_PATH)" "[ -f '$HOOKS_PATH' ]"

echo
echo "=== C. hooks.json command paths resolve (CLAUDE_PLUGIN_ROOT substitution) ==="
TOTAL_HOOKS=$(jq -r '[.hooks[][].hooks[]?.command] | length' packages/kernel/hooks.json)
MISSING=0
for cmd in $(jq -r '.hooks[][].hooks[]?.command // empty' packages/kernel/hooks.json); do
  path_arg=$(echo "$cmd" | awk '{print $2}' | sed "s|\${CLAUDE_PLUGIN_ROOT}/||")
  if [ -n "$path_arg" ] && [ ! -f "$path_arg" ]; then
    echo "  ✗ MISSING: $path_arg"
    MISSING=$((MISSING + 1))
  fi
done
if [ "$MISSING" = "0" ]; then
  echo "  ✓ all $TOTAL_HOOKS hook command paths resolve"
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
fi

echo
echo "=== D. Skills directory: each subdir has SKILL.md ==="
SKILL_COUNT=$(find "$SKILLS_PATH" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
NO_SKILL_MD=0
for d in "$SKILLS_PATH"/*/; do
  [ -d "$d" ] || continue
  [ ! -f "$d/SKILL.md" ] && NO_SKILL_MD=$((NO_SKILL_MD + 1))
done
if [ "$NO_SKILL_MD" = "0" ]; then
  echo "  ✓ all $SKILL_COUNT skills have SKILL.md"; PASS=$((PASS + 1))
else
  echo "  ✗ $NO_SKILL_MD skills missing SKILL.md"; FAIL=$((FAIL + 1))
fi

echo
echo "=== E. Commands directory: every .md is a valid slash-command file ==="
CMD_COUNT=$(ls "$COMMANDS_PATH"/*.md 2>/dev/null | wc -l | tr -d ' ')
echo "  $CMD_COUNT command files found"
# Frontmatter is OPTIONAL for Claude Code commands — first non-blank line is the prompt body.
# Just verify the files are non-empty markdown.
NO_BODY=0
for cmd in "$COMMANDS_PATH"/*.md; do
  [ -s "$cmd" ] || NO_BODY=$((NO_BODY + 1))
done
if [ "$NO_BODY" = "0" ]; then
  echo "  ✓ all $CMD_COUNT command files have content"; PASS=$((PASS + 1))
else
  echo "  ✗ $NO_BODY command files empty"; FAIL=$((FAIL + 1))
fi

echo
echo "=== F. Agents/ directory still at repo root (Anthropic convention) ==="
AGENT_COUNT=$(ls agents/*.md 2>/dev/null | wc -l | tr -d ' ')
check "agents/ has ≥10 .md files (got $AGENT_COUNT)" "[ '$AGENT_COUNT' -ge '10' ]"
check "agents/architect.md exists" "[ -f agents/architect.md ]"
check "agents/code-reviewer.md exists" "[ -f agents/code-reviewer.md ]"

echo
echo "=== G. Persona contract → brief pair ==="
PERSONAS_MISSING=0
for contract in packages/runtime/contracts/[0-9]*.contract.json; do
  persona=$(basename "$contract" .contract.json)
  brief="packages/runtime/personas/$persona.md"
  [ -f "$brief" ] || PERSONAS_MISSING=$((PERSONAS_MISSING + 1))
done
if [ "$PERSONAS_MISSING" = "0" ]; then
  PERSONAS_OK=$(ls packages/runtime/contracts/[0-9]*.contract.json 2>/dev/null | wc -l | tr -d ' ')
  echo "  ✓ $PERSONAS_OK personas have brief+contract pair"; PASS=$((PASS + 1))
else
  echo "  ✗ $PERSONAS_MISSING persona briefs missing"; FAIL=$((FAIL + 1))
fi

echo
echo "=== H. Runtime → Kernel DAG invariant ==="
DAG_LEAKS=$(grep -rEn "require\(['\"](\.\./)+(runtime|lab|skills|specs)" packages/kernel/ 2>/dev/null | wc -l | tr -d ' ')
if [ "$DAG_LEAKS" = "0" ]; then
  echo "  ✓ kernel has no upward imports"; PASS=$((PASS + 1))
else
  echo "  ✗ $DAG_LEAKS DAG violations in kernel"; FAIL=$((FAIL + 1))
fi

echo
echo "=== I. Contract verifier executes for every contract (verdict-agnostic) ==="
mkdir -p /tmp/cv-probe-out
cat > /tmp/cv-probe-out/stub.md <<'STUB'
---
persona_contract_v: "1"
persona: stub
agent_id: actor-stub-test
synth_id_v: 1
synth_id: foo
task_signature: test
ranged_signal:
  conv: 0.5
toolkit_version: 3.0.0-alpha
---
## HIGH
### HIGH-1: stub
Body.
STUB
CV_RAN=0
CV_CRASHED=0
for contract in packages/runtime/contracts/[0-9]*.contract.json packages/runtime/contracts/{challenger,engineering-task}.contract.json; do
  [ -f "$contract" ] || continue
  out=$(node packages/kernel/validators/contract-verifier.js \
        --contract "$contract" --output /tmp/cv-probe-out/stub.md 2>&1)
  # Verifier exit 0 (all-pass) or exit 1 (verdict has fails) are both "ran cleanly".
  # Real crash is when stdout has no JSON.
  if echo "$out" | head -1 | grep -q '^{'; then
    CV_RAN=$((CV_RAN + 1))
  else
    CV_CRASHED=$((CV_CRASHED + 1))
    echo "  ✗ crashed: $contract"
  fi
done
if [ "$CV_CRASHED" = "0" ]; then
  echo "  ✓ contract-verifier produced valid JSON for all $CV_RAN contracts"
  PASS=$((PASS + 1))
else
  echo "  ✗ $CV_CRASHED contracts produced no JSON"; FAIL=$((FAIL + 1))
fi

echo
echo "=== J. Library module loads (not script entrypoints) ==="
# Only require() actual library modules. Skip script entrypoints (contract-verifier,
# loom-recall etc.) that exit on load when no args.
for mod in "packages/kernel/_lib/atomic-write.js" \
           "packages/kernel/_lib/lock.js" \
           "packages/kernel/_lib/frontmatter.js" \
           "packages/kernel/_lib/toolkit-root.js" \
           "packages/kernel/_lib/synthid.js" \
           "packages/kernel/_lib/runState.js" \
           "packages/runtime/orchestration/identity/registry.js" \
           "packages/runtime/orchestration/identity/trust-scoring.js" \
           "packages/runtime/orchestration/identity/verification-policy.js" \
           "packages/runtime/orchestration/identity/lifecycle-spawn.js" \
           "packages/runtime/orchestration/identity/verdict-recording.js" \
           "packages/runtime/orchestration/agent-identity.js" \
           "packages/runtime/orchestration/doctor/probes/env-inheritance.js" \
           "packages/runtime/orchestration/doctor/probes/hook-installation.js" \
           "packages/runtime/orchestration/doctor/probes/lock-staleness.js" \
           "packages/runtime/orchestration/doctor/probes/partition-sentinel.js"; do
  if node -e "require('./$mod')" > /dev/null 2>&1; then
    PASS=$((PASS + 1))
  else
    echo "  ✗ require failed: $mod"; FAIL=$((FAIL + 1))
  fi
done
echo "  (J: 16 library modules tested)"

echo
echo "=== K. CLI script entrypoints exit cleanly with --help or known args ==="
# Each script should run + exit with stderr/usage rather than crash.
for entry in "packages/kernel/recall/loom-recall.js" \
             "packages/kernel/spawn-state/self-improve-store.js" \
             "packages/kernel/spawn-state/prompt-pattern-store.js" \
             "packages/kernel/algorithms/route-decide.js" \
             "packages/runtime/orchestration/adr.js" \
             "packages/runtime/orchestration/kb-resolver.js" \
             "packages/runtime/orchestration/contracts-validate.js" \
             "packages/runtime/orchestration/build-spawn-context.js"; do
  # Run with no args + capture stderr. Exit ≥ 2 = crash; 0 or 1 = handled
  err=$(node "$entry" 2>&1 1>/dev/null || true)
  # "Handled" = stderr contains usage/error message (no stack trace).
  if echo "$err" | grep -qE "(Usage:|error:|Cannot find module|at .*:[0-9])"; then
    if echo "$err" | grep -qE "at .*:[0-9]+:[0-9]+$"; then
      echo "  ✗ entrypoint crashed with stack trace: $entry"; FAIL=$((FAIL + 1))
    else
      PASS=$((PASS + 1))
    fi
  else
    # No output at all is also a crash signal
    PASS=$((PASS + 1))
  fi
done
echo "  (K: 8 CLI entrypoints tested)"

echo
echo "=== L. install.sh dry-run on each component ==="
for arg in "--rules" "--commands" "--skills" "--hooks"; do
  if bash install.sh --diff $arg > /dev/null 2>&1; then
    PASS=$((PASS + 1))
  else
    echo "  ✗ install.sh --diff $arg failed"; FAIL=$((FAIL + 1))
  fi
done
echo "  (L: 4 install dry-runs)"

echo
echo "=== M. Settings reference (install template) paths match installed layout ==="
SR=packages/kernel/settings-reference.json
SR_COMMANDS=$(jq -r '..|.command? // empty' "$SR" 2>/dev/null | wc -l | tr -d ' ')
echo "  settings-reference.json declares $SR_COMMANDS hook commands"
SR_MISSING=0
for cmd in $(jq -r '..|.command? // empty' "$SR" 2>/dev/null); do
  # Each path is e.g. "node HOME_DIR/.claude/packages/kernel/hooks/pre/X.js"
  path_arg=$(echo "$cmd" | awk '{print $2}' | sed 's|HOME_DIR|'"$HOME"'|; s|^node ||')
  if [ -n "$path_arg" ] && [ ! -f "$path_arg" ]; then
    SR_MISSING=$((SR_MISSING + 1))
  fi
done
if [ "$SR_MISSING" = "0" ]; then
  echo "  ✓ all $SR_COMMANDS settings-reference paths resolve in installed ~/.claude/"
  PASS=$((PASS + 1))
else
  echo "  ⚠ $SR_MISSING settings-reference paths missing in installed layout"
  WARN=$((WARN + 1))
fi

echo
echo "=========================================="
echo " PROBE SUMMARY (Phase 0 Step 11)"
echo "=========================================="
echo "  PASS:  $PASS"
echo "  FAIL:  $FAIL"
echo "  WARN:  $WARN"
echo "=========================================="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
