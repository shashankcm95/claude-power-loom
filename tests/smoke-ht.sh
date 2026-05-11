# shellcheck shell=bash
# shellcheck disable=SC2168  # H.9.1 — sourced by install.sh run_smoke_tests(); `local` is function-scope at runtime
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

  # Test 75: HT.1.13 — ADR-0005 ships at status: accepted directly per HT.1.7
  # precedent (per-phase pre-approval gate IS the acceptance ceremony).
  # Validates `adr.js list --status accepted` returns count ≥ 2 (ADR-0003 +
  # ADR-0005); ADR-0005 must be present by adr_id.
  echo -n "  Test 75 (HT.1.13 ADR-0005 accepted; adr.js list --status accepted includes ADR-0005): "
  T75_OUT=$(HETS_ADRS_DIR="$SCRIPT_DIR/swarm/adrs" node "$SCRIPT_DIR/scripts/agent-team/adr.js" list --status accepted 2>/dev/null)
  T75_COUNT=$(echo "$T75_OUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('count', -1))")
  T75_HAS_0005=$(echo "$T75_OUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print('yes' if any(a.get('adr_id') == '0005' for a in d.get('adrs', [])) else 'no')")
  if [ "$T75_COUNT" -ge "2" ] && [ "$T75_HAS_0005" = "yes" ]; then
    echo "OK (count=$T75_COUNT, includes ADR-0005)"
    passed=$((passed + 1))
  else
    echo "FAIL: count=$T75_COUNT, has_0005=$T75_HAS_0005 (want count≥2, has_0005=yes)"
    failed=$((failed + 1))
  fi

  # Test 76: HT.1.13 — slopfiles `<important if>` block-marker count is within
  # target band ≥ 8 and ≤ 14 (per architect LOW-2 absorption: tightened from
  # loose ≥ 8 to also enforce upper bound to catch over-conditionalization).
  # 14 is the post-HT.1.13 baseline (workflow.md 11 + fundamentals.md 1 +
  # prompt-enrichment.md 1 + self-improvement.md 1).
  echo -n "  Test 76 (HT.1.13 <important if> block-marker count in rules/core/ within target band): "
  T76_COUNT=$(grep -rn "<important if" "$SCRIPT_DIR/rules/core/" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$T76_COUNT" -ge "8" ] && [ "$T76_COUNT" -le "14" ]; then
    echo "OK (count=$T76_COUNT; target ≥ 8 and ≤ 14)"
    passed=$((passed + 1))
  else
    echo "FAIL: count=$T76_COUNT (want ≥ 8 and ≤ 14)"
    failed=$((failed + 1))
  fi

  # Test 77: HT.1.14 — bumpBatch in-process call (replaces 22-spawnSync worst-case)
  # Validates programmatic surface: require('./scripts/self-improve-store').bumpBatch(signals)
  # bumps turn counter + signals + returns expected shape. Uses ephemeral
  # HOME so test doesn't touch user state. Pre-creates ~/.claude/ + checkpoints/
  # so withLock can acquire its lock file (the directory must exist before
  # `_lib/lock.js` attempts to write the lockfile).
  echo -n "  Test 77 (HT.1.14 bumpBatch in-process call returns expected shape): "
  T77_TMPDIR=$(mktemp -d)
  mkdir -p "$T77_TMPDIR/.claude/checkpoints"
  T77_OUT=$(HOME="$T77_TMPDIR" node -e "
    const s = require('$SCRIPT_DIR/scripts/self-improve-store.js');
    const r = s.bumpBatch(['filePath:/tmp/foo.js', 'command:/test']);
    process.stdout.write(JSON.stringify(r));
  " 2>/dev/null)
  T77_TURN=$(echo "$T77_OUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('turnCounter', -1))" 2>/dev/null)
  T77_BUMPED=$(echo "$T77_OUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('signalsBumped', -1))" 2>/dev/null)
  T77_HAS_SHOULDSCAN=$(echo "$T77_OUT" | python3 -c "import json,sys; print('yes' if 'shouldScan' in json.load(sys.stdin) else 'no')" 2>/dev/null)
  rm -rf "$T77_TMPDIR"
  if [ "$T77_TURN" = "1" ] && [ "$T77_BUMPED" = "2" ] && [ "$T77_HAS_SHOULDSCAN" = "yes" ]; then
    echo "OK (turnCounter=1, signalsBumped=2, shouldScan in result)"
    passed=$((passed + 1))
  else
    echo "FAIL: turn=$T77_TURN, bumped=$T77_BUMPED, has_shouldScan=$T77_HAS_SHOULDSCAN"
    failed=$((failed + 1))
  fi

  # Test 78: HT.2.3 — session-end-nudge.js Stop event with absent sessions/ dir auto-creates
  # (drift-note 75 closure via _lib/lock.js Part A auto-mkdir). Validates:
  #   (a) require resolution across hooks/scripts/ → ../../scripts/agent-team/_lib/lock works
  #       (first cross-tree relative require in hooks/scripts/ per code-reviewer MEDIUM-CR3)
  #   (b) auto-mkdir creates ~/.claude/sessions/ transparently (Part A behavior)
  #   (c) hook exits 0 + writes stdin through to stdout (fail-soft contract preserved)
  #   (d) state file is written with count=1
  echo -n "  Test 78 (HT.2.3 session-end-nudge.js auto-mkdir on absent sessions/ dir): "
  T78_TMPDIR=$(mktemp -d)
  # Note: do NOT pre-create $T78_TMPDIR/.claude/sessions — that's what we're testing
  T78_OUT=$(echo "input-line-1" | HOME="$T78_TMPDIR" CLAUDE_SESSION_ID=t78-test \
    node "$SCRIPT_DIR/hooks/scripts/session-end-nudge.js" 2>/dev/null)
  T78_EXIT=$?
  T78_STATE_FILE="$T78_TMPDIR/.claude/sessions/nudge-t78-test.json"
  T78_COUNT=$(python3 -c "import json; print(json.load(open('$T78_STATE_FILE')).get('count', -1))" 2>/dev/null)
  if [ "$T78_EXIT" = "0" ] && [ "$T78_OUT" = "input-line-1" ] && [ "$T78_COUNT" = "1" ]; then
    echo "OK (exit=0, stdout=input, auto-mkdir created sessions/ + state file count=1)"
    passed=$((passed + 1))
  else
    echo "FAIL: exit=$T78_EXIT, stdout=$T78_OUT, count=$T78_COUNT"
    failed=$((failed + 1))
  fi
  rm -rf "$T78_TMPDIR"

  # Test 79: HT.2.3 — session-end-nudge.js fail-soft contract on lock contention
  # (drift-note 67 closure via _lib/lock.js Part B migration). Validates:
  #   (a) When lock is held by a live PID (background sleep), acquireLock times out
  #   (b) Hook exits 0 (NOT exit-2 — fail-soft per ADR-0001 + ADR-0003)
  #   (c) Hook writes stdin through to stdout (fail-soft pass-through preserved)
  # Approach: pre-create lockfile with a live child sleep PID (child process owned
  # by the test; signable via process.kill(pid, 0) → succeeds → lock treated as held).
  # Stale-PID approach (write garbage to lockfile) won't work because _lib/lock.js
  # reclaims invalid/dead PIDs immediately; only a LIVE signable PID forces timeout.
  echo -n "  Test 79 (HT.2.3 session-end-nudge.js fail-soft on lock contention): "
  T79_TMPDIR=$(mktemp -d)
  mkdir -p "$T79_TMPDIR/.claude/sessions"
  T79_LOCK="$T79_TMPDIR/.claude/sessions/nudge-t79-test.json.lock"
  sleep 10 &
  T79_CHILD_PID=$!
  echo "$T79_CHILD_PID" > "$T79_LOCK"
  T79_START=$(date +%s)
  T79_OUT=$(echo "input-line-2" | HOME="$T79_TMPDIR" CLAUDE_SESSION_ID=t79-test \
    CLAUDE_SESSION_NUDGE_THRESHOLD=10 \
    node "$SCRIPT_DIR/hooks/scripts/session-end-nudge.js" 2>/dev/null)
  T79_EXIT=$?
  T79_END=$(date +%s)
  T79_ELAPSED=$((T79_END - T79_START))
  # kill + wait must tolerate killed-child exit codes under `set -euo pipefail`:
  # `wait` on a killed child returns 128+SIGNAL (143 for SIGTERM); `|| true`
  # absorbs that exit code so the test framework continues.
  kill $T79_CHILD_PID 2>/dev/null || true
  wait $T79_CHILD_PID 2>/dev/null || true
  # Note: state file should NOT have been mutated (lock acquisition failed)
  T79_STATE_FILE="$T79_TMPDIR/.claude/sessions/nudge-t79-test.json"
  T79_STATE_EXISTS=$([ -e "$T79_STATE_FILE" ] && echo "yes" || echo "no")
  if [ "$T79_EXIT" = "0" ] && [ "$T79_OUT" = "input-line-2" ] && \
     [ "$T79_ELAPSED" -ge 1 ] && [ "$T79_ELAPSED" -le 5 ] && \
     [ "$T79_STATE_EXISTS" = "no" ]; then
    echo "OK (exit=0, stdout=input, elapsed=${T79_ELAPSED}s in 1-5s range, no state mutation on timeout)"
    passed=$((passed + 1))
  else
    echo "FAIL: exit=$T79_EXIT, stdout=$T79_OUT, elapsed=${T79_ELAPSED}s, state_exists=$T79_STATE_EXISTS"
    failed=$((failed + 1))
  fi
  rm -rf "$T79_TMPDIR"

  # Test 80: H.9.0 — markdownlint in local smoke harness (closes the process gap
  # surfaced by 2026-05-11 CI markdown-lint failure post-HT.3.3 merge: 22 MD037/MD038
  # errors had accumulated across HT ledger entries because markdownlint wasn't in
  # local verification — CI was the sole enforcer + ran only on push to main).
  # Validates:
  #   (a) markdownlint-cli2 runs against substrate markdown via same command CI uses
  #   (b) Exit code 0 — substrate markdown lint clean
  # Approach: invoke same command as `.github/workflows/ci.yml` Markdown lint job.
  # First-run on a fresh machine may take ~5-10s to fetch markdownlint-cli2 into
  # npx cache; subsequent runs are ~2-3s. Acceptable smoke-harness latency.
  echo -n "  Test 80 (H.9.0 markdownlint in local smoke harness; npx markdownlint-cli2 against substrate): "
  T80_OUT=$(cd "$SCRIPT_DIR" && npx --yes markdownlint-cli2 "**/*.md" "#node_modules" "#swarm" 2>&1)
  T80_EXIT=$?
  if [ $T80_EXIT -eq 0 ]; then
    echo "OK (substrate markdown lint clean; 0 errors)"
    passed=$((passed + 1))
  else
    echo "FAIL: markdownlint reported errors"
    echo "$T80_OUT" | tail -5
    failed=$((failed + 1))
  fi

  # Test 81: H.9.1 — shellcheck error-severity in local smoke harness (closes the
  # sibling format-discipline gap analogous to H.9.0 markdownlint; shellcheck was
  # neither in CI nor local verification). False-positive SC2148 (missing shebang)
  # + SC2168 (`local` outside function) fires on sourced test files resolved at
  # H.9.1 by adding `# shellcheck shell=bash` + `# shellcheck disable=SC2168`
  # directives at the top of `tests/smoke-h{4,7,8,ht}.sh` — those files are sourced
  # by `install.sh run_smoke_tests()` so `local` IS function-scope at runtime; the
  # directives declare shell + suppress the false positive shellcheck can't follow.
  # Validates:
  #   (a) shellcheck --severity=error runs against all substrate .sh files
  #   (b) Exit code 0 — substrate shellcheck clean at error severity
  # Approach: enumerate substrate .sh files via `find` (future-extensible to new
  # `*.sh` additions), pipe to `xargs` → `npx --yes shellcheck --severity=error`.
  # First-run on a fresh machine may take ~10-15s to download shellcheck binary
  # into npx cache; subsequent runs are ~1-2s. Acceptable smoke-harness latency.
  echo -n "  Test 81 (H.9.1 shellcheck error-severity in local smoke harness; npx shellcheck against substrate .sh files): "
  T81_OUT=$(cd "$SCRIPT_DIR" && find . -name "*.sh" -not -path "./node_modules/*" -not -path "./.git/*" -print0 | xargs -0 npx --yes shellcheck --severity=error 2>&1)
  T81_EXIT=$?
  if [ $T81_EXIT -eq 0 ]; then
    echo "OK (substrate shellcheck clean at error severity; 0 errors)"
    passed=$((passed + 1))
  else
    echo "FAIL: shellcheck reported errors"
    echo "$T81_OUT" | tail -5
    failed=$((failed + 1))
  fi

  # Test 82: H.9.2 — JSON syntax in local smoke harness (sibling format-discipline
  # 3rd application; closes JSON content-format-time discipline gap analogous to
  # H.9.0 markdownlint + H.9.1 shellcheck). Substrate has 30 substrate-active
  # *.json files (configs at .claude-plugin/, hooks/, .markdownlint.json; persona
  # contracts at swarm/personas-contracts/; schemas at swarm/schemas/; test
  # fixtures at swarm/test-fixtures/) + 19 swarm/run-state/ chaos-artifact JSON
  # files excluded (chaos test outputs may contain non-JSON when capturing stderr
  # alongside stdout; not active substrate). H.9.2 baseline: 30 files, 0 errors
  # — purely preventive gate (no current drift to fix; establishes gate before
  # drift accumulates).
  # Validates:
  #   (a) jq empty parses every substrate-active *.json file as valid JSON
  #   (b) Exit code 0 — substrate JSON syntax clean
  # Approach: enumerate via `find` (excludes node_modules/.git/swarm/run-state) +
  # pipe to `xargs -n1 jq empty` (jq pre-installed on macOS + Ubuntu CI). Each
  # file parsed individually; xargs continues on failure + propagates non-zero
  # exit code if any file fails.
  echo -n "  Test 82 (H.9.2 JSON syntax in local smoke harness; jq empty against substrate .json files): "
  T82_OUT=$(cd "$SCRIPT_DIR" && find . -name "*.json" -not -path "./node_modules/*" -not -path "./.git/*" -not -path "./swarm/run-state/*" -print0 | xargs -0 -n1 jq empty 2>&1)
  T82_EXIT=$?
  T82_COUNT=$(cd "$SCRIPT_DIR" && find . -name "*.json" -not -path "./node_modules/*" -not -path "./.git/*" -not -path "./swarm/run-state/*" | wc -l | tr -d ' ')
  if [ $T82_EXIT -eq 0 ]; then
    echo "OK (substrate JSON syntax clean; $T82_COUNT files checked, 0 errors)"
    passed=$((passed + 1))
  else
    echo "FAIL: jq reported JSON syntax errors"
    echo "$T82_OUT" | tail -5
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
