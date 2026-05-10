# tests/smoke-ht.sh — HT.1.x phase-era + H.8.7 trailer smoke tests.
#
# Sourced by install.sh run_smoke_tests() function; mutates parent-scope
# $passed and $failed counters via bash lexical-scope inheritance.
#
# Per HT.1.4 (ADR-0002 cross-language application — bash sourced-file
# post-split shape). Test count: 7 (tests 69-70 — HT.1.1 noCritiqueLanguage;
# test 71 — HT.1.5 build-team-helpers.sh dispatch; test 72 — HT.1.6
# documentary persona DEFAULT_ROSTERS + /research path-extraction integration;
# tests 73-74 — HT.1.7 seed status enum + active-for-drift Design B; test 65 —
# H.8.7 adr.js symlink defense, intentional trailer position per HT.0.7 audit
# anomaly preservation).
#
# Source order: tests 69, 70, 71, 72, 73, 74 first (HT.1.x phase tests in
# numeric order), then test 65 (H.8.7 trailer) last — preserves the original
# execution order of run_smoke_tests pre-extraction.
#
# DO NOT execute directly — depends on parent-scope `local passed`,
# `local failed`, and `$CLAUDE_DIR` / `$SCRIPT_DIR` set by install.sh.

  # Test 69: HT.1.1 — noCritiqueLanguage antiPatternCheck (positive: clean documentary output → A4 pass + verdict pass)
  echo -n "  Test 69 (HT.1.1 noCritiqueLanguage A4 passes on clean documentary output): "
  T69_TMPDIR=$(mktemp -d)
  T69_CONTRACT="$T69_TMPDIR/contract.json"
  T69_OUTPUT="$T69_TMPDIR/output.md"
  cat > "$T69_CONTRACT" <<EOF
{
  "agentId": "test-no-critique-positive",
  "persona": "test-documentary",
  "role": "actor",
  "documentary": true,
  "antiPattern": [
    { "id": "A4", "check": "noCritiqueLanguage", "args": { "forbidden_phrases": ["should be", "recommend", "anti-pattern"] }, "severity": "warn" }
  ]
}
EOF
  cat > "$T69_OUTPUT" <<EOF
# Documentary output (clean)

The function getCwd at src/util.js:42 returns the current working directory.
The caller at src/main.js:10 passes the result to processFile.
EOF
  T69_OUT=$(node "$SCRIPT_DIR/scripts/agent-team/contract-verifier.js" --contract "$T69_CONTRACT" --output "$T69_OUTPUT" 2>/dev/null)
  T69_VERDICT=$(echo "$T69_OUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('verdict', ''))")
  T69_A4_STATUS=$(echo "$T69_OUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('antiPattern', {}).get('A4', {}).get('status', ''))")
  if [ "$T69_VERDICT" = "pass" ] && [ "$T69_A4_STATUS" = "pass" ]; then
    echo "OK (verdict=pass + A4=pass)"
    passed=$((passed + 1))
  else
    echo "FAIL: verdict=$T69_VERDICT A4=$T69_A4_STATUS (want verdict=pass + A4=pass)"
    failed=$((failed + 1))
  fi
  rm -rf "$T69_TMPDIR"

  # Test 70: HT.1.1 — noCritiqueLanguage antiPatternCheck (negative: forbidden phrase → A4 warn + verdict partial)
  echo -n "  Test 70 (HT.1.1 noCritiqueLanguage A4 warns on forbidden-phrase output): "
  T70_TMPDIR=$(mktemp -d)
  T70_CONTRACT="$T70_TMPDIR/contract.json"
  T70_OUTPUT="$T70_TMPDIR/output.md"
  cat > "$T70_CONTRACT" <<EOF
{
  "agentId": "test-no-critique-negative",
  "persona": "test-documentary",
  "role": "actor",
  "documentary": true,
  "antiPattern": [
    { "id": "A4", "check": "noCritiqueLanguage", "args": { "forbidden_phrases": ["should be", "recommend", "anti-pattern"] }, "severity": "warn" }
  ]
}
EOF
  cat > "$T70_OUTPUT" <<EOF
# Documentary output (with critique slip)

The function getCwd at src/util.js:42 returns the cwd. This should be refactored
to use a more idiomatic shape per the existing convention at src/main.js:10.
EOF
  T70_OUT=$(node "$SCRIPT_DIR/scripts/agent-team/contract-verifier.js" --contract "$T70_CONTRACT" --output "$T70_OUTPUT" 2>/dev/null)
  T70_VERDICT=$(echo "$T70_OUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('verdict', ''))")
  T70_A4_STATUS=$(echo "$T70_OUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('antiPattern', {}).get('A4', {}).get('status', ''))")
  T70_A4_FOUND=$(echo "$T70_OUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('antiPattern', {}).get('A4', {}).get('foundPhrase', ''))")
  if [ "$T70_VERDICT" = "partial" ] && [ "$T70_A4_STATUS" = "warn" ] && [ "$T70_A4_FOUND" = "should be" ]; then
    echo "OK (verdict=partial + A4=warn + foundPhrase=should be)"
    passed=$((passed + 1))
  else
    echo "FAIL: verdict=$T70_VERDICT A4=$T70_A4_STATUS foundPhrase=$T70_A4_FOUND (want verdict=partial + A4=warn + foundPhrase='should be')"
    failed=$((failed + 1))
  fi
  rm -rf "$T70_TMPDIR"

  # Test 71: HT.1.5 — build-team-helpers.sh dispatch smoke (helper script syntax + 5+1 subcommand
  # surface integrity). Exercises --help (exits 0; lists subcommands) and unknown-subcommand
  # error path (exits 1; emits usage to stderr). Per HT.1.5 sub-plan probe #4.
  echo -n "  Test 71 (HT.1.5 build-team-helpers.sh dispatch + subcommand surface): "
  T71_HELPER="$SCRIPT_DIR/scripts/agent-team/build-team-helpers.sh"
  if [ ! -f "$T71_HELPER" ]; then
    echo "FAIL: helper script missing at $T71_HELPER"
    failed=$((failed + 1))
  else
    # --help (exits 0): direct capture is set-e-safe
    T71_HELP_OUT=$(bash "$T71_HELPER" --help 2>/dev/null)
    T71_HELP_EXIT=$?
    # Unknown subcommand (exits 1): wrap in if-form to bypass install.sh's `set -e`
    if T71_UNKNOWN_OUT=$(bash "$T71_HELPER" __nonexistent_subcommand__ 2>&1 >/dev/null); then
      T71_UNKNOWN_EXIT=0
    else
      T71_UNKNOWN_EXIT=$?
    fi
    if [ "$T71_HELP_EXIT" = "0" ] \
        && echo "$T71_HELP_OUT" | grep -q "Subcommands:" \
        && echo "$T71_HELP_OUT" | grep -q "route-decide-gate" \
        && echo "$T71_HELP_OUT" | grep -q "build-spawn-context" \
        && echo "$T71_HELP_OUT" | grep -q "verify-with-contract-selection" \
        && echo "$T71_HELP_OUT" | grep -q "assign-challenger-pair" \
        && echo "$T71_HELP_OUT" | grep -q "record-verdict" \
        && [ "$T71_UNKNOWN_EXIT" = "1" ] \
        && echo "$T71_UNKNOWN_OUT" | grep -q "Unknown subcommand"; then
      echo "OK (--help exits 0 with 5 subcommands; unknown subcommand exits 1)"
      passed=$((passed + 1))
    else
      echo "FAIL: help_exit=$T71_HELP_EXIT unknown_exit=$T71_UNKNOWN_EXIT (want help_exit=0 + 5 subcommands listed + unknown_exit=1)"
      failed=$((failed + 1))
    fi
  fi

  # Test 72: HT.1.6 — documentary persona DEFAULT_ROSTERS + /research path-extraction
  # integration smoke. Closes the integration-test gap that masked drift-notes 65 + 66.
  # Asserts: (a) cmdAssign returns valid identity for 14-codebase-locator (DEFAULT_ROSTERS
  # entry exists post-HT.1.6); (b) `jq -r '.identity'` extracts the full identity string
  # (commands/research.md path-extraction works post-HT.1.6 .full → .identity fix).
  echo -n "  Test 72 (HT.1.6 documentary persona DEFAULT_ROSTERS + /research integration): "
  T72_STORE=$(mktemp -u)
  HETS_IDENTITY_STORE="$T72_STORE" node "$SCRIPT_DIR/scripts/agent-team/agent-identity.js" init >/dev/null 2>&1
  T72_OUT=$(HETS_IDENTITY_STORE="$T72_STORE" node "$SCRIPT_DIR/scripts/agent-team/agent-identity.js" assign --persona 14-codebase-locator --task ht-1-6-test 2>&1)
  T72_IDENTITY=$(echo "$T72_OUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('identity', ''))" 2>/dev/null)
  T72_PERSONA=$(echo "$T72_OUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('persona', ''))" 2>/dev/null)
  # Use if-form to bypass install.sh's `set -e` propagation when grep finds 0 matches
  # (grep -c emits "0" + exits 1; combined with `|| echo "?"` the substitution would
  # capture both grep's "0" + echo's "?" = "0\n?" which breaks string equality below).
  T72_RESEARCH_FULL_REFS=0
  if grep -q "jq -r '\.full'" "$SCRIPT_DIR/commands/research.md" 2>/dev/null; then
    T72_RESEARCH_FULL_REFS=$(grep -c "jq -r '\.full'" "$SCRIPT_DIR/commands/research.md")
  fi
  T72_RESEARCH_IDENTITY_REFS=0
  if grep -q "jq -r '\.identity'" "$SCRIPT_DIR/commands/research.md" 2>/dev/null; then
    T72_RESEARCH_IDENTITY_REFS=$(grep -c "jq -r '\.identity'" "$SCRIPT_DIR/commands/research.md")
  fi
  if [ "$T72_PERSONA" = "14-codebase-locator" ] \
      && echo "$T72_IDENTITY" | grep -qE "^14-codebase-locator\.(scout|nav|atlas)$" \
      && [ "$T72_RESEARCH_FULL_REFS" = "0" ] \
      && [ "$T72_RESEARCH_IDENTITY_REFS" -ge "3" ]; then
    echo "OK (assign returns 14-codebase-locator.<roster-name>; research.md uses .identity not .full × 3)"
    passed=$((passed + 1))
  else
    echo "FAIL: persona='$T72_PERSONA' identity='$T72_IDENTITY' research.md_full=$T72_RESEARCH_FULL_REFS research.md_identity=$T72_RESEARCH_IDENTITY_REFS"
    failed=$((failed + 1))
  fi
  rm -f "$T72_STORE"

  # Test 73: HT.1.7 — seed status enum in adr.js list filter. Validates that
  # ADR-0001 retagged from `accepted` to `seed` (HT.1.7 Design B) is queryable
  # via `adr.js list --status seed`. Reads the live `swarm/adrs/` directory.
  echo -n "  Test 73 (HT.1.7 seed status enum; adr.js list --status seed returns ADR-0001): "
  T73_OUT=$(HETS_ADRS_DIR="$SCRIPT_DIR/swarm/adrs" node "$SCRIPT_DIR/scripts/agent-team/adr.js" list --status seed 2>/dev/null)
  T73_COUNT=$(echo "$T73_OUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('count', -1))")
  T73_FIRST_ID=$(echo "$T73_OUT" | python3 -c "import json,sys; d=json.load(sys.stdin); adrs=d.get('adrs',[]); print(adrs[0]['adr_id'] if adrs else '')")
  if [ "$T73_COUNT" = "1" ] && [ "$T73_FIRST_ID" = "0001" ]; then
    echo "OK (count=1, adr_id=0001)"
    passed=$((passed + 1))
  else
    echo "FAIL: count=$T73_COUNT, adr_id=$T73_FIRST_ID (want count=1, adr_id=0001)"
    failed=$((failed + 1))
  fi

  # Test 74: HT.1.7 — seed ADRs participate in drift detection (Design B).
  # Validates that `touched-by hooks/scripts/fact-force-gate.js` returns BOTH
  # ADR-0001 (seed; mechanical discipline) AND ADR-0003 (accepted; governance
  # commitment). isActive() widening at HT.1.7 admits seed status alongside
  # accepted; both ADRs share the same files_affected list (14 hook scripts).
  echo -n "  Test 74 (HT.1.7 seed active-for-drift; touched-by returns ADR-0001 + ADR-0003): "
  T74_OUT=$(HETS_ADRS_DIR="$SCRIPT_DIR/swarm/adrs" node "$SCRIPT_DIR/scripts/agent-team/adr.js" touched-by hooks/scripts/fact-force-gate.js 2>/dev/null)
  T74_COUNT=$(echo "$T74_OUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('matched_count', -1))")
  T74_HAS_0001=$(echo "$T74_OUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print('yes' if any(a.get('adr_id') == '0001' for a in d.get('adrs', [])) else 'no')")
  T74_HAS_0003=$(echo "$T74_OUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print('yes' if any(a.get('adr_id') == '0003' for a in d.get('adrs', [])) else 'no')")
  if [ "$T74_COUNT" = "2" ] && [ "$T74_HAS_0001" = "yes" ] && [ "$T74_HAS_0003" = "yes" ]; then
    echo "OK (matched_count=2, includes ADR-0001 seed + ADR-0003 accepted)"
    passed=$((passed + 1))
  else
    echo "FAIL: count=$T74_COUNT, has_0001=$T74_HAS_0001, has_0003=$T74_HAS_0003 (want count=2, both yes)"
    failed=$((failed + 1))
  fi

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
