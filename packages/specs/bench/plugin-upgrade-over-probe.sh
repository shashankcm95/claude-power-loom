#!/usr/bin/env bash
# Plugin upgrade-over probe — Phase 0 Step 11.
#
# Empirically verifies that Claude Code's plugin loader could resolve the
# packages/ workspace layout. NOT a real `/plugin update` invocation
# (that needs interactive Claude Code) — a proxy that exercises every
# resolution layer reachable from bash.
#
# Sections:
#   A — Plugin manifest schema validity
#   B — Manifest-declared paths exist
#   C — hooks.json command paths resolve + syntax-load (CR MEDIUM-5)
#   D — Skills directory has SKILL.md per subdir
#   E — Commands directory has content per .md
#   F — Agents/ at repo root + frontmatter fields (CR MEDIUM-7)
#   G — Persona contract↔brief pairing
#   H — Runtime → Kernel DAG invariant
#   I — Contract verifier executes on every contract
#   J — Library module loads (12 _lib + identity + doctor probes)
#   K — CLI script entrypoints handle no-args cleanly
#   L — install.sh --diff dry-runs work
#   M — settings-reference paths resolve in installed ~/.claude/
#
# Usage:
#   bash packages/specs/bench/plugin-upgrade-over-probe.sh <toolkit-root>
# Example:
#   bash packages/specs/bench/plugin-upgrade-over-probe.sh "$(pwd)"
#
# Exit 0 if FAIL=0, exit 1 otherwise. WARN does not affect exit code.

set -uo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: $(basename "$0") <toolkit-root>" >&2
  echo "Example: bash $(basename "$0") \"\$(pwd)\"" >&2
  exit 1
fi
TOOLKIT="$1"; cd "$TOOLKIT" || { echo "ERROR: cannot cd into $TOOLKIT" >&2; exit 1; }

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

if [ -f packages/kernel/schema/plugin-manifest.schema.json ]; then
  ajv_out=$(npx --yes ajv-cli@5 validate -s packages/kernel/schema/plugin-manifest.schema.json \
              -d .claude-plugin/plugin.json --spec=draft2020 2>&1) || true
  if echo "$ajv_out" | grep -qi "valid"; then
    echo "  ✓ plugin.json validates against vendored schema"
    PASS=$((PASS + 1))
  else
    echo "  ⚠ plugin.json schema validation skipped/unavailable"
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
echo "=== C. hooks.json command paths resolve + syntax-load (CR MEDIUM-5) ==="
# Symmetric jq queries (CR MEDIUM-4): both count + loop use `// empty`.
TOTAL_HOOKS=$(jq -r '[.hooks[][].hooks[]?.command // empty] | length' packages/kernel/hooks.json)
MISSING=0
SYNTAX_ERRORS=0
for cmd in $(jq -r '.hooks[][].hooks[]?.command // empty' packages/kernel/hooks.json); do
  path_arg=$(echo "$cmd" | awk '{print $2}' | sed "s|\${CLAUDE_PLUGIN_ROOT}/||")
  if [ -z "$path_arg" ]; then continue; fi
  if [ ! -f "$path_arg" ]; then
    echo "  ✗ MISSING: $path_arg"
    MISSING=$((MISSING + 1))
    continue
  fi
  # CR MEDIUM-5: syntax check each hook script (proxy for "loads cleanly").
  if ! node --check "$path_arg" > /dev/null 2>&1; then
    echo "  ✗ SYNTAX ERROR: $path_arg"
    SYNTAX_ERRORS=$((SYNTAX_ERRORS + 1))
  fi
done
if [ "$MISSING" = "0" ]; then
  echo "  ✓ all $TOTAL_HOOKS hook command paths resolve"
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
fi
if [ "$SYNTAX_ERRORS" = "0" ]; then
  echo "  ✓ all $TOTAL_HOOKS hook scripts pass node --check"
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
echo "=== E. Commands directory: every .md has content ==="
CMD_COUNT=$(ls "$COMMANDS_PATH"/*.md 2>/dev/null | wc -l | tr -d ' ')
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
echo "=== F. Agents/ at repo root + frontmatter fields (CR MEDIUM-7) ==="
AGENT_COUNT=$(ls agents/*.md 2>/dev/null | wc -l | tr -d ' ')
check "agents/ has ≥10 .md files (got $AGENT_COUNT)" "[ '$AGENT_COUNT' -ge '10' ]"
check "agents/architect.md exists" "[ -f agents/architect.md ]"
check "agents/code-reviewer.md exists" "[ -f agents/code-reviewer.md ]"
# Frontmatter validity — Task-tool resolution needs `name:` `description:` `tools:` fields.
AGENT_FM_FAIL=0
for agent in agents/*.md; do
  # Must start with `---` then have all three fields within first 30 lines
  head -1 "$agent" | grep -q '^---' || { AGENT_FM_FAIL=$((AGENT_FM_FAIL + 1)); continue; }
  for field in "^name:" "^description:" "^tools:"; do
    if ! head -30 "$agent" | grep -qE "$field"; then
      echo "  ✗ $agent missing field: $field"
      AGENT_FM_FAIL=$((AGENT_FM_FAIL + 1))
      break
    fi
  done
done
if [ "$AGENT_FM_FAIL" = "0" ]; then
  echo "  ✓ all $AGENT_COUNT agents have valid frontmatter (name + description + tools)"
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
fi

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
echo "=== I. Contract verifier executes for every contract ==="
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
CV_RAN=0; CV_CRASHED=0
for contract in packages/runtime/contracts/[0-9]*.contract.json packages/runtime/contracts/{challenger,engineering-task}.contract.json; do
  [ -f "$contract" ] || continue
  out=$(node packages/kernel/validators/contract-verifier.js \
        --contract "$contract" --output /tmp/cv-probe-out/stub.md 2>&1)
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
  FAIL=$((FAIL + 1))
fi

echo
echo "=== J. Library module loads (CR HIGH-2: 12 _lib + identity + doctor) ==="
# All 12 kernel/_lib/ modules (CR HIGH-2 fix: was 6, now 12)
for mod in "packages/kernel/_lib/atomic-write.js" \
           "packages/kernel/_lib/env-placeholder.js" \
           "packages/kernel/hooks/_lib/file-path-pattern.js" \
           "packages/kernel/_lib/frontmatter.js" \
           "packages/kernel/_lib/library-catalog.js" \
           "packages/kernel/_lib/library-paths.js" \
           "packages/kernel/_lib/lock.js" \
           "packages/kernel/_lib/persona-store.js" \
           "packages/kernel/_lib/route-decide-export.js" \
           "packages/kernel/_lib/runState.js" \
           "packages/kernel/_lib/safe-exec.js" \
           "packages/kernel/_lib/synthid.js" \
           "packages/kernel/_lib/toolkit-root.js" \
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
echo "  (J: 23 library modules tested)"

echo
echo "=== K. CLI script entrypoints handle no-args (no silent crash) ==="
# CR HIGH-1: explicit exit-code + stderr-text check. Silent failure detected.
for entry in "packages/kernel/recall/loom-recall.js" \
             "packages/kernel/spawn-state/self-improve-store.js" \
             "packages/kernel/spawn-state/prompt-pattern-store.js" \
             "packages/kernel/algorithms/route-decide.js" \
             "packages/runtime/orchestration/adr.js" \
             "packages/runtime/orchestration/kb-resolver.js" \
             "packages/runtime/orchestration/contracts-validate.js" \
             "packages/runtime/orchestration/build-spawn-context.js"; do
  err=$(node "$entry" 2>&1 1>/dev/null); rc=$?
  # Crash = stack trace in stderr (regardless of exit code) OR empty stderr with exit ≥ 2.
  if echo "$err" | grep -qE "    at .*:[0-9]+:[0-9]+\$"; then
    echo "  ✗ stack trace in stderr: $entry"; FAIL=$((FAIL + 1))
  elif [ -z "$err" ] && [ "$rc" -ge 2 ]; then
    echo "  ✗ silent exit $rc with no output: $entry"; FAIL=$((FAIL + 1))
  elif echo "$err" | grep -qE "(Usage:|error:|required|Cannot find module|missing|expected|^ℹ |Contracts validation|validation report)"; then
    PASS=$((PASS + 1))
  else
    echo "  ⚠ ambiguous output (rc=$rc): $entry"; WARN=$((WARN + 1))
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
echo "=== M. settings-reference paths resolve in installed ~/.claude/ ==="
SR=packages/kernel/settings-reference.json
SR_COMMANDS=$(jq -r '..|.command? // empty' "$SR" 2>/dev/null | wc -l | tr -d ' ')
SR_MISSING=0
for cmd in $(jq -r '..|.command? // empty' "$SR" 2>/dev/null); do
  path_arg=$(echo "$cmd" | awk '{print $2}' | sed 's|HOME_DIR|'"$HOME"'|; s|^node ||')
  if [ -n "$path_arg" ] && [ ! -f "$path_arg" ]; then
    SR_MISSING=$((SR_MISSING + 1))
  fi
done
if [ "$SR_MISSING" = "0" ]; then
  echo "  ✓ all $SR_COMMANDS settings-reference paths resolve in installed ~/.claude/"
  PASS=$((PASS + 1))
else
  echo "  ⚠ $SR_MISSING settings-reference paths missing (run install.sh --hooks first)"
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
