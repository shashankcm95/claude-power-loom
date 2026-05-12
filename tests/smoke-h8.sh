# shellcheck shell=bash
# shellcheck disable=SC2168  # H.9.1 — sourced by install.sh run_smoke_tests(); `local` is function-scope at runtime
# tests/smoke-h8.sh — H.8.x phase-era smoke tests.
#
# Sourced by install.sh run_smoke_tests() function; mutates parent-scope
# $passed and $failed counters via bash lexical-scope inheritance.
#
# Per HT.1.4 (ADR-0002 cross-language application — bash sourced-file
# post-split shape). Test count: 27 (tests 41-64, 66-68 — H.8.x; test 65
# H.8.7 trailer relocated to tests/smoke-ht.sh per HT.0.7 audit anomaly
# preservation).
#
# DO NOT execute directly — depends on parent-scope `local passed`,
# `local failed`, and `$CLAUDE_DIR` / `$SCRIPT_DIR` set by install.sh.

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

  # Test 48 (H.8.2 + HT.1.7 update): adr.js touched-by detects file in active
  # ADRs' files_affected. Post-HT.1.7, matched_count is 2 because BOTH ADR-0001
  # (seed; technical-tier mechanical discipline) AND ADR-0003 (accepted;
  # governance-tier institutional commitment) share the same 14-hook
  # files_affected list. Per HT.1.7 Design B, seed ADRs participate in drift
  # detection alongside accepted ADRs.
  local h8_2_touched_result
  h8_2_touched_result=$(node "$SCRIPT_DIR/scripts/agent-team/adr.js" touched-by hooks/scripts/fact-force-gate.js 2>/dev/null)
  if echo "$h8_2_touched_result" | grep -q '"matched_count": 2' && echo "$h8_2_touched_result" | grep -q '"adr_id": "0001"' && echo "$h8_2_touched_result" | grep -q '"adr_id": "0003"'; then
    echo "  ✓ adr.js: H.8.2 + HT.1.7 touched-by detects file in active ADRs (ADR-0001 seed + ADR-0003 accepted)"
    passed=$((passed + 1))
  else
    echo "  ✗ adr.js: H.8.2 + HT.1.7 touched-by should match fact-force-gate.js to BOTH ADR-0001 + ADR-0003"
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
  # H.9.16 drift-note 78(a) safe-pattern: T62_EXIT=0; T_OUT=$(...) || T_EXIT=$? (set -e + cmd-sub).
  T62_EXIT=0
  T62_OUT=$(HETS_KB_DIR="$T62_KBDIR" node "$SCRIPT_DIR/scripts/agent-team/kb-resolver.js" cat-summary test/fence 2>/dev/null) || T62_EXIT=$?
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
  # H.9.16 drift-note 78(a) safe-pattern: inline-pipeline cmd-subs suffix || true (parse-of-empty-input fail-soft).
  T63_TRUE_POSITIVE=$(HETS_ADRS_DIR="$T63_ADRS" node "$SCRIPT_DIR/scripts/agent-team/adr.js" touched-by hooks/scripts/foo.js 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('matched_count', -1))" 2>/dev/null) || true
  T63_FALSE_POSITIVE=$(HETS_ADRS_DIR="$T63_ADRS" node "$SCRIPT_DIR/scripts/agent-team/adr.js" touched-by hooks/scripts/barfoo.js 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('matched_count', -1))" 2>/dev/null) || true
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
  # H.9.16 drift-note 78(a) safe-pattern: inline-pipeline cmd-sub suffix || true.
  T64_NEW=$(HETS_ADRS_DIR="$T64_ADRS" node "$SCRIPT_DIR/scripts/agent-team/adr.js" new --title 'Test "quoted" title' 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('filename', ''))" 2>/dev/null) || true
  if [ -n "$T64_NEW" ] && [ -f "$T64_ADRS/$T64_NEW" ]; then
    # Verify the file has properly escaped title
    # H.9.16 drift-note 78(a) safe-pattern: grep cmd-sub suffix || true (grep exits 1 on no-match aborts under set -e).
    T64_TITLE_LINE=$(grep '^title:' "$T64_ADRS/$T64_NEW" 2>/dev/null) || true
    if echo "$T64_TITLE_LINE" | grep -q 'Test \\"quoted\\" title'; then
      # Verify the ADR loads cleanly
      # H.9.16 drift-note 78(a) safe-pattern: inline-pipeline cmd-sub suffix || true.
      T64_LOAD=$(HETS_ADRS_DIR="$T64_ADRS" node "$SCRIPT_DIR/scripts/agent-team/adr.js" list 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('count', -1))" 2>/dev/null) || true
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
  # H.9.12 update: fixture frontmatter expanded to satisfy Component A HARD-block
  # quality bar (version + tags ≥3 + sources_consulted ≥2 per _PRINCIPLES.md L42-46);
  # missing Quick Reference section preserves the H.8.8 SOFT-advisory trigger surface.
  echo -n "  Test 66 (H.8.8 validate-kb-doc emits forcing instruction on incomplete kb doc): "
  T66_TMPDIR=$(mktemp -d)
  T66_KB_DOC="$T66_TMPDIR/kb/architecture/test/incomplete.md"
  mkdir -p "$(dirname "$T66_KB_DOC")"
  cat > "$T66_KB_DOC" <<EOF
---
kb_id: architecture/test/incomplete
version: 1
tags:
  - test
  - h88-fixture
  - incomplete
sources_consulted:
  - "Test source 1"
  - "Test source 2"
related:
  - architecture/test/other
---

## Summary

This doc has frontmatter and a Summary but is missing Quick Reference (preserves H.8.8 SOFT-advisory trigger surface; Component A HARD-block satisfied).
EOF
  # H.9.16 drift-note 78(a) safe-pattern: source T_EXIT=0 init + || T_EXIT=$? suffix; downstream || true.
  T66_EXIT=0
  T66_OUT=$(echo "{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$T66_KB_DOC\"}}" | node "$SCRIPT_DIR/hooks/scripts/validators/validate-kb-doc.js" 2>/dev/null) || T66_EXIT=$?
  T66_DECISION=$(echo "$T66_OUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('decision', ''))" 2>/dev/null) || true
  T66_HAS_MARKER=$(echo "$T66_OUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print('[KB-DOC-INCOMPLETE]' in d.get('reason',''))" 2>/dev/null) || true
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
  # H.9.16 drift-note 78(a) safe-pattern: source T_EXIT=0 init + || T_EXIT=$? suffix; downstream || true.
  T67_EXIT=0
  T67_OUT=$(echo "{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$T67_DOC\"}}" | node "$SCRIPT_DIR/hooks/scripts/validators/validate-kb-doc.js" 2>/dev/null) || T67_EXIT=$?
  T67_HAS_REASON=$(echo "$T67_OUT" | python3 -c "import json,sys; print('reason' in json.load(sys.stdin))" 2>/dev/null) || true
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
  # H.9.16 drift-note 78(a) safe-pattern: source T_EXIT=0 init + || T_EXIT=$? suffix; downstream || true.
  T68_EXIT=0
  T68_OUT=$(echo "{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$T68_KB_DOC\"}}" | SKIP_KB_DOC_CHECK=1 node "$SCRIPT_DIR/hooks/scripts/validators/validate-kb-doc.js" 2>/dev/null) || T68_EXIT=$?
  T68_HAS_REASON=$(echo "$T68_OUT" | python3 -c "import json,sys; print('reason' in json.load(sys.stdin))" 2>/dev/null) || true
  if [ "$T68_HAS_REASON" = "False" ]; then
    echo "OK (bypass works)"
    passed=$((passed + 1))
  else
    echo "FAIL: bypass did not work"
    failed=$((failed + 1))
  fi
  rm -rf "$T68_TMPDIR"
