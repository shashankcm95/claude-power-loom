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
  # H.9.6 (2026-05-11): scope extended to include swarm/kb-architecture-planning/
  # planning docs (was excluded by blanket "#swarm" — H.9.4 surfaced the gap when
  # explicit lint on the 3 modified docs caught MD056 + MD037 issues that Test 80
  # didn't see; post-compact cumulative-audit confirmed scope right-sized).
  # Validates:
  #   (a) markdownlint-cli2 runs against substrate markdown via same command CI uses
  #       PLUS swarm/kb-architecture-planning/ planning docs (5 underscore-prefix
  #       planning artifacts + README); swarm/ otherwise excluded (chaos-run-state
  #       noise + research/plan/HT-state narrative with carve-out backtick patterns)
  #   (b) Exit code 0 — substrate markdown lint clean
  # Approach: invoke same command as `.github/workflows/ci.yml` Markdown lint job,
  # plus an explicit swarm/kb-architecture-planning/**/*.md include glob (markdownlint-cli2
  # ordered globs: explicit include before "#swarm" exclude takes precedence).
  # First-run on a fresh machine may take ~5-10s to fetch markdownlint-cli2 into
  # npx cache; subsequent runs are ~2-3s. Acceptable smoke-harness latency.
  echo -n "  Test 80 (H.9.0+H.9.6 markdownlint in local smoke harness; substrate + swarm/kb-architecture-planning/): "
  # H.9.6.2: explicit `|| T80_EXIT=$?` guard required because install.sh runs with
  # `set -euo pipefail` (line 2); a bare `T80_OUT=$(failing_cmd 2>&1)` triggers
  # errexit BEFORE the if/else branch can report FAIL, hiding the failure mode
  # (caught by CI when H.9.6 introduced duplicate `last_session_phase_priors:`
  # key in HT-state.md frontmatter — Test 83 failed silently locally; CI surfaced).
  T80_EXIT=0
  T80_OUT=$(cd "$SCRIPT_DIR" && npx --yes markdownlint-cli2 "**/*.md" "swarm/kb-architecture-planning/**/*.md" "#node_modules" "#swarm" 2>&1) || T80_EXIT=$?
  if [ $T80_EXIT -eq 0 ]; then
    echo "OK (substrate markdown lint clean; 0 errors)"
    passed=$((passed + 1))
  else
    echo "FAIL: markdownlint reported errors (exit $T80_EXIT)"
    echo "$T80_OUT" | head -30
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
  # H.9.6.2: see Test 80 comment for `|| T81_EXIT=$?` rationale.
  T81_EXIT=0
  T81_OUT=$(cd "$SCRIPT_DIR" && find . -name "*.sh" -not -path "./node_modules/*" -not -path "./.git/*" -print0 | xargs -0 npx --yes shellcheck --severity=error 2>&1) || T81_EXIT=$?
  if [ $T81_EXIT -eq 0 ]; then
    echo "OK (substrate shellcheck clean at error severity; 0 errors)"
    passed=$((passed + 1))
  else
    echo "FAIL: shellcheck reported errors (exit $T81_EXIT)"
    echo "$T81_OUT" | head -30
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
  # H.9.6.2: see Test 80 comment for `|| T82_EXIT=$?` rationale.
  T82_EXIT=0
  T82_OUT=$(cd "$SCRIPT_DIR" && find . -name "*.json" -not -path "./node_modules/*" -not -path "./.git/*" -not -path "./swarm/run-state/*" -print0 | xargs -0 -n1 jq empty 2>&1) || T82_EXIT=$?
  T82_COUNT=$(cd "$SCRIPT_DIR" && find . -name "*.json" -not -path "./node_modules/*" -not -path "./.git/*" -not -path "./swarm/run-state/*" | wc -l | tr -d ' ')
  if [ $T82_EXIT -eq 0 ]; then
    echo "OK (substrate JSON syntax clean; $T82_COUNT files checked, 0 errors)"
    passed=$((passed + 1))
  else
    echo "FAIL: jq reported JSON syntax errors (exit $T82_EXIT)"
    echo "$T82_OUT" | head -30
    failed=$((failed + 1))
  fi

  # Test 83: H.9.5 — yaml-lint on substrate frontmatter (sibling format-discipline
  # 4th application; closes YAML content-format-time discipline gap analogous to
  # H.9.0 markdownlint + H.9.1 shellcheck + H.9.2 JSON syntax). Substrate has 130
  # .md files with YAML frontmatter; H.9.5 ensures all are strict YAML 1.2 valid.
  # Empirical pre-validation surfaced 12 files with narrative-with-embedded-colons
  # patterns (HT-state.md + 11 plan files); H.9.5 migration wrapped 223 narrative
  # values in double quotes + converted internal `"..."` to `` `...` `` (semantic-
  # preserving) + consolidated 8 duplicate `last_session_phase_prior:` keys in
  # HT-state.md into a single block-list under `last_session_phase_priors:`.
  # Substrate's `parseFrontmatter` already strips outer "..." (impl line 142);
  # block-list shape handled per HT.2.2 impl. No parser change required.
  # Validates:
  #   (a) Extract frontmatter from each .md with `---` markers
  #   (b) yaml-lint each extracted frontmatter as a standalone YAML doc
  #   (c) Exit code 0 — all substrate frontmatter parses as valid YAML 1.2
  # Approach: mktemp dir + walk substrate via find + extract via awk + pipe all
  # to yaml-lint (single invocation across all extracted files for speed).
  # First-run on fresh machine takes ~10-15s downloading yaml-lint via npx;
  # subsequent runs are ~3-5s. Acceptable smoke-harness latency.
  echo -n "  Test 83 (H.9.5 yaml-lint on substrate frontmatter; extracted .md frontmatter blocks): "
  T83_TMPDIR=$(mktemp -d)
  T83_COUNT=0
  # H.9.6.2: track per-file source mapping so a yaml-lint failure can report
  # which substrate file owns the bad frontmatter (drift-note 78 — H.9.6
  # CI-break post-mortem surfaced that the yaml-lint stack-trace alone, with
  # no source-file path, made diagnosis hard until cross-referenced manually).
  T83_MANIFEST="$T83_TMPDIR/manifest.txt"
  : > "$T83_MANIFEST"
  while IFS= read -r T83_FILE; do
    if head -1 "$T83_FILE" 2>/dev/null | grep -q "^---$"; then
      T83_COUNT=$((T83_COUNT + 1))
      awk 'BEGIN{state=0} /^---$/ { if(state==0){state=1;next}; if(state==1){state=2;exit} } state==1' "$T83_FILE" > "$T83_TMPDIR/fm-$T83_COUNT.yaml"
      echo "fm-$T83_COUNT.yaml -> $T83_FILE" >> "$T83_MANIFEST"
    fi
  done < <(find "$SCRIPT_DIR" -name "*.md" -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/swarm/run-state/*")
  # H.9.6.2: see Test 80 comment for `|| T83_EXIT=$?` rationale (this is the
  # exact site where the set -e + cmd-sub failure-hiding bug bit at H.9.6).
  T83_EXIT=0
  T83_OUT=$(npx --yes yaml-lint "$T83_TMPDIR"/fm-*.yaml 2>&1) || T83_EXIT=$?
  if [ $T83_EXIT -eq 0 ]; then
    echo "OK (substrate frontmatter YAML 1.2 valid; $T83_COUNT files checked, 0 errors)"
    passed=$((passed + 1))
    rm -rf "$T83_TMPDIR"
  else
    echo "FAIL: yaml-lint reported frontmatter errors (exit $T83_EXIT)"
    echo "$T83_OUT" | head -30
    # H.9.6.2: extract which fm-N.yaml file(s) appear in yaml-lint output;
    # cross-reference manifest to surface owning substrate .md path(s).
    echo "  Failing frontmatter sources (per manifest):"
    echo "$T83_OUT" | grep -oE 'fm-[0-9]+\.yaml' | sort -u | while IFS= read -r FM; do
      grep "^$FM " "$T83_MANIFEST" || true
    done
    failed=$((failed + 1))
    rm -rf "$T83_TMPDIR"
  fi

  # Test 84: H.9.7 — ESLint v9 + eslint:recommended on substrate .js files
  # (sibling format-discipline 5th application; closes JavaScript content-
  # format-time discipline gap analogous to H.9.0 markdownlint + H.9.1
  # (shellcheck) + H.9.2 jq + H.9.5 yaml-lint). Substrate has 53 .js files;
  # H.9.7 baseline surfaced 44 errors (HT.1.2 stale-`parsed` real bugs in
  # contract-verifier.js + 13 no-empty + 21 no-unused-vars + 4 no-useless-
  # escape + 4 legitimate-security regex sites); all 44 fixed.
  # eslint.config.js inline-rolls eslint:recommended (60 rules) per Option B
  # (zero-runtime-dep substrate convention preserved); ADR-0006 invariant 4
  # commits to manual sync at ESLint major-version bumps.
  # H.9.6.2 safe-pattern: T84_EXIT=0; T84_OUT=$(...) || T84_EXIT=$?
  echo -n "  Test 84 (H.9.7 ESLint v9 + eslint:recommended on substrate .js): "
  T84_EXIT=0
  T84_OUT=$(cd "$SCRIPT_DIR" && npx --yes eslint@9 . 2>&1) || T84_EXIT=$?
  if [ $T84_EXIT -eq 0 ]; then
    echo "OK (substrate JavaScript ESLint clean at error severity; 0 errors)"
    passed=$((passed + 1))
  else
    echo "FAIL: ESLint reported errors (exit $T84_EXIT)"
    echo "$T84_OUT" | head -30
    failed=$((failed + 1))
  fi

  # Test 84b: H.9.7 — ADR-0006 invariant 5 enforcement (suppression-detection).
  # ADR-0006 invariant 2 prohibits `eslint-disable` directives (any variant) in
  # substrate `.js` files. Without active smoke-time enforcement, the prohibition
  # would rely on code-review discipline alone (~5-commit drift risk per code-
  # reviewer FLAG-3 estimate at H.9.7 pre-approval gate). Test 84b greps for
  # actual disable-DIRECTIVES (comment-form `//` or `/*` prefix immediately before
  # `eslint-disable`), NOT raw substring matches. This precision handles two
  # legitimate cases that contain the literal string but are NOT suppressions:
  # (a) `hooks/scripts/console-log-check.js` regex literals `\/\/\s*eslint-disable`
  #     — escaped slashes don't match comment-form pattern;
  # (b) `eslint.config.js` documentation comments describing the rule itself
  #     — explicitly excluded from grep scope (the config IS where the discipline
  #     lives; mentioning it in comments is meta, not directive use).
  # grep exit codes: 0 = matches found (BAD); 1 = no matches (GOOD); >1 = error.
  echo -n "  Test 84b (H.9.7 ADR-0006 invariant 5 suppression-detection in substrate .js): "
  T84B_EXIT=0
  T84B_OUT=$(cd "$SCRIPT_DIR" && grep -rlE '(//|/\*)[ \t]*eslint-disable' . --include="*.js" --exclude-dir=node_modules --exclude-dir=.git --exclude="eslint.config.js" 2>&1) || T84B_EXIT=$?
  if [ $T84B_EXIT -eq 1 ]; then
    echo "OK (0 eslint-disable suppressions in substrate .js per ADR-0006 invariant 2)"
    passed=$((passed + 1))
  elif [ $T84B_EXIT -eq 0 ]; then
    echo "FAIL: eslint-disable suppressions found (ADR-0006 invariant 2 violated):"
    echo "$T84B_OUT" | head -10
    failed=$((failed + 1))
  else
    echo "FAIL: grep exited with unexpected code $T84B_EXIT"
    echo "$T84B_OUT" | head -5
    failed=$((failed + 1))
  fi

  # Test 85: H.9.9 — error-critic.js lock-contention fail-soft contract.
  # Validates ADR-0001 invariant 2 (hooks never block on hook errors) + invariant 3
  # (every fail-open path goes through logger so failure is observable).
  # Approach: write parent shell's $$ PID (guaranteed-alive) into LOCK_PATH;
  # acquireLock probes via process.kill(pid, 0) — pid is alive so probe succeeds
  # -> wait loop continues -> 2000ms LOCK_TIMEOUT_MS expires -> acquireLock returns
  # false -> error-critic.js logs lock_timeout + returns silently (fail-soft).
  # Per H.9.9 gate architect HIGH-2 + code-reviewer HIGH-CR3 + MED-CR4 + MED-CR6
  # convergent absorption: stale-PID determinism + trap cleanup + lock_timeout
  # log assertion + ms timing.
  echo -n "  Test 85 (H.9.9 error-critic.js lock-contention fail-soft contract; ADR-0001 invariants 2+3): "
  h99_session="h99-test-$$"
  h99_failure_dir="${TMPDIR:-/tmp}/.claude-toolkit-failures/$h99_session"
  h99_log="$HOME/.claude/logs/error-critic.log"
  mkdir -p "$h99_failure_dir"
  mkdir -p "$(dirname "$h99_log")"
  touch "$h99_log"
  echo "$$" > "$h99_failure_dir/.lock"
  trap 'rm -f "$h99_failure_dir/.lock" 2>/dev/null' EXIT
  h99_log_size_before=$(stat -f %z "$h99_log" 2>/dev/null || stat -c %s "$h99_log" 2>/dev/null || echo 0)
  h99_start_ms=$(node -e "console.log(Date.now())")
  H99_EXIT=0
  h99_result=$(echo '{"tool_name":"Bash","tool_input":{"command":"npm test"},"tool_response":{"stderr":"Error: failed","is_error":true}}' | CLAUDE_SESSION_ID="$h99_session" node "$SCRIPT_DIR/hooks/scripts/error-critic.js" 2>/dev/null) || H99_EXIT=$?
  h99_end_ms=$(node -e "console.log(Date.now())")
  h99_elapsed_ms=$((h99_end_ms - h99_start_ms))
  rm -f "$h99_failure_dir/.lock"
  trap - EXIT
  h99_log_size_after=$(stat -f %z "$h99_log" 2>/dev/null || stat -c %s "$h99_log" 2>/dev/null || echo 0)
  h99_log_delta=$((h99_log_size_after - h99_log_size_before))
  if [ $h99_log_delta -gt 0 ]; then
    h99_log_has_timeout=$(tail -c $((h99_log_delta + 100)) "$h99_log" 2>/dev/null | grep -c 'lock_timeout' || echo 0)
  else
    h99_log_has_timeout=0
  fi
  if [ $H99_EXIT -eq 0 ] && [ -z "$h99_result" ] && [ $h99_elapsed_ms -ge 1500 ] && [ $h99_elapsed_ms -le 3500 ] && [ $h99_log_has_timeout -ge 1 ]; then
    echo "OK (exit=0 + no forcing instruction + elapsed=${h99_elapsed_ms}ms in 1500-3500ms + lock_timeout logged)"
    passed=$((passed + 1))
  else
    echo "FAIL: exit=$H99_EXIT result='${h99_result:0:60}' elapsed=${h99_elapsed_ms}ms log_delta=$h99_log_delta lock_timeout_count=$h99_log_has_timeout"
    failed=$((failed + 1))
  fi
  rm -rf "$h99_failure_dir" 2>/dev/null

  # Test 86: H.9.11 — PreToolUse YAML frontmatter validator catches duplicate
  # top-level keys at Edit/Write time (drift-note 80 URGENT 5-recurrence closure +
  # drift-note 78(b) ledger-write convention enforcement gap). Fault-injects a
  # synthetic HT-state.md with duplicate `last_session_phase_priors:` opener;
  # pipes both Write- and Edit-event JSON to validator; asserts both block.
  # Test 85 conventions: lowercase passed/failed counters (L557/560 precedent);
  # `trap - EXIT` reset after manual cleanup (L547 precedent); Node JSON.stringify
  # for event-payload encoding (architect HIGH-3 absorption).
  echo -n "  Test 86 (H.9.11 validate-yaml-frontmatter blocks duplicate last_session_phase_priors on Write + Edit): "
  T86_TMP=$(mktemp -d)
  trap 'rm -rf "$T86_TMP"' EXIT
  mkdir -p "$T86_TMP/swarm/thoughts/shared"
  T86_HT_STATE="$T86_TMP/swarm/thoughts/shared/HT-state.md"
  # Synthetic fixture only — controlled content (no backslashes); never adapt
  # this fixture-build to pipe real HT-state.md content. (code-reviewer LOW-CR7
  # documented constraint.)
  cat > "$T86_HT_STATE" <<'EOF'
---
last_session_phase: "test"
last_session_phase_priors:
  - "entry 1"
last_session_phase_priors:
  - "duplicate opener bug"
---
body
EOF

  # Write-event variant
  T86_INPUT=$(node -e "
    const fs = require('fs');
    console.log(JSON.stringify({
      tool_name: 'Write',
      tool_input: {
        file_path: '$T86_HT_STATE',
        content: fs.readFileSync('$T86_HT_STATE', 'utf8')
      }
    }));
  ")
  T86_EXIT=0
  T86_OUT=$(echo "$T86_INPUT" | node "$SCRIPT_DIR/hooks/scripts/validators/validate-yaml-frontmatter.js") || T86_EXIT=$?

  # Edit-event variant (drift-note 80 root cause is the Edit pattern, not Write)
  T86_EDIT_INPUT=$(node -e "
    console.log(JSON.stringify({
      tool_name: 'Edit',
      tool_input: {
        file_path: '$T86_HT_STATE',
        old_string: 'last_session_phase: \"test\"',
        new_string: 'last_session_phase: \"test\"\nlast_session_phase_priors:\n  - \"injected dup opener\"'
      }
    }));
  ")
  T86_EDIT_EXIT=0
  T86_EDIT_OUT=$(echo "$T86_EDIT_INPUT" | node "$SCRIPT_DIR/hooks/scripts/validators/validate-yaml-frontmatter.js") || T86_EDIT_EXIT=$?

  rm -rf "$T86_TMP"
  trap - EXIT

  if [ $T86_EXIT -ne 0 ] || [ $T86_EDIT_EXIT -ne 0 ]; then
    echo "FAIL: validator exit Write=$T86_EXIT Edit=$T86_EDIT_EXIT (expected 0; fail-soft contract)"
    failed=$((failed + 1))
  elif echo "$T86_OUT" | grep -q '"decision":"block"' && echo "$T86_OUT" | grep -q "last_session_phase_priors" \
    && echo "$T86_EDIT_OUT" | grep -q '"decision":"block"' && echo "$T86_EDIT_OUT" | grep -q "last_session_phase_priors"; then
    echo "OK (blocked dup-key on both Write + Edit paths)"
    passed=$((passed + 1))
  else
    echo "FAIL: validator did not block dup-key (Write=${T86_OUT:0:80} Edit=${T86_EDIT_OUT:0:80})"
    failed=$((failed + 1))
  fi

  # Test 87: H.9.10 — Atomics.wait true-sleep CPU-usage validation.
  # Promoted from optional to required per architect HIGH-2 (only empirical
  # proof of the H.9.10 fix target: busy-wait → true-sleep). Test 79 + 85
  # measure wall-clock elapsed (preserved by Atomics.wait); Test 87 measures
  # CPU usage during the wait (changed by Atomics.wait). Without Test 87,
  # the fix's actual target is unverified.
  #
  # Approach: spawn child holding lock for ~2s; parent calls acquireLock
  # with maxWaitMs=1500ms (will time out) and measures process.cpuUsage()
  # before+after. Assert cpu_fraction < 0.1 (i.e., <10% CPU during wait).
  # Atomics.wait true-sleep yields ~0.5-5% CPU; busy-wait would yield ~100%.
  echo -n "  Test 87 (H.9.10 Atomics.wait true-sleep CPU-usage probe; expect <10% CPU during wait): "
  T87_TMP=$(mktemp -d)
  trap 'rm -rf "$T87_TMP"' EXIT
  T87_LOCK="$T87_TMP/h910-lock"
  T87_RESULT=$(node -e "
    const fs = require('fs');
    const path = require('path');
    const { spawn } = require('child_process');
    const { acquireLock } = require('$SCRIPT_DIR/scripts/agent-team/_lib/lock');
    const lockPath = '$T87_LOCK';
    // Spawn child that holds the lock for 2s using a real different PID.
    const childScript = \`
      const fs = require('fs');
      fs.mkdirSync(require('path').dirname('\${lockPath}'), { recursive: true });
      fs.writeFileSync('\${lockPath}', String(process.pid));
      setTimeout(() => { try { fs.unlinkSync('\${lockPath}'); } catch {} }, 2200);
    \`;
    const child = spawn('node', ['-e', childScript], { stdio: 'ignore', detached: false });
    // Wait for child to write lock file
    const waitStart = Date.now();
    while (!fs.existsSync(lockPath) && Date.now() - waitStart < 1000) { /* spin briefly */ }
    if (!fs.existsSync(lockPath)) {
      console.log('FAIL_NO_LOCK');
      try { child.kill(); } catch {}
      process.exit(1);
    }
    // Measure CPU + elapsed during acquire-with-contention
    const cpuStart = process.cpuUsage();
    const start = Date.now();
    const got = acquireLock(lockPath, { maxWaitMs: 1500, sleepMs: 100 });
    const elapsedMs = Date.now() - start;
    const cpuEnd = process.cpuUsage(cpuStart);
    const cpuUs = cpuEnd.user + cpuEnd.system;
    const cpuFraction = cpuUs / 1000 / elapsedMs;
    try { child.kill(); } catch {}
    // got should be false (timed out); cpuFraction should be <0.1 (10%)
    console.log(JSON.stringify({ got, elapsedMs, cpuUs, cpuFraction }));
  " 2>&1)
  rm -rf "$T87_TMP"
  trap - EXIT
  T87_GOT=$(echo "$T87_RESULT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('got'))" 2>/dev/null)
  T87_ELAPSED=$(echo "$T87_RESULT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('elapsedMs'))" 2>/dev/null)
  T87_CPU=$(echo "$T87_RESULT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('cpuFraction'))" 2>/dev/null)
  T87_CPU_OK=$(echo "$T87_RESULT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(1 if d.get('cpuFraction', 1) < 0.1 else 0)" 2>/dev/null)
  if [ "$T87_GOT" = "False" ] && [ "$T87_CPU_OK" = "1" ]; then
    echo "OK (got=false elapsed=${T87_ELAPSED}ms cpu_fraction=${T87_CPU} < 0.1 = <10% CPU true-sleep confirmed)"
    passed=$((passed + 1))
  else
    echo "FAIL: got=$T87_GOT elapsed=${T87_ELAPSED}ms cpu_fraction=${T87_CPU} (expected got=false + cpu_fraction<0.1) [raw: ${T87_RESULT:0:160}]"
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

  # Test 88: H.9.12 — _PRINCIPLES.md enforcement extension to validate-kb-doc.js
  # Verifies Components A (HARD-block frontmatter) + B (SOFT-advisory sections)
  # via 5 synthetic stdin payloads (NEVER-real paths under /tmp/h912-fixture/).
  #
  # Per H.9.11 Test 86 + H.9.10 Test 87 precedent: lowercase passed/failed
  # counters (Test 85 L557/560); Node JSON.stringify for event payloads
  # (avoid sed/tr/printf brittleness); trap-EXIT-reset; synthetic-fixture-only.
  #
  # 5 fixtures per H.9.12 gate architect MEDIUM-1 + code-reviewer MEDIUM-CR6:
  #   F1: missing version: → block (Component A)
  #   F2: tags only 2 entries → block (Component A)
  #   F3: sources_consulted only 1 entry → block (Component A)
  #   F4: valid frontmatter but missing "When NOT to use" → approve + advisory (Component B)
  #   F5: out-of-scope path → approve no advisory (regex scope guard)
  echo -n "  Test 88 (H.9.12 validate-kb-doc.js _PRINCIPLES.md enforcement; 5 fixtures: HARD-block + SOFT-advisory + out-of-scope): "
  T88_RESULT=$(node -e "
    const { spawnSync } = require('child_process');
    const validator = '$SCRIPT_DIR/hooks/scripts/validators/validate-kb-doc.js';
    const fixtures = [
      {
        name: 'F1_missing_version',
        payload: {
          tool_name: 'Write',
          tool_input: {
            file_path: '/tmp/h912-fixture/skills/agent-team/kb/architecture/test/no-version.md',
            content: '---\nkb_id: architecture/test/no-version\ntags:\n  - a\n  - b\n  - c\nsources_consulted:\n  - x\n  - y\n---\n## Summary\nf\n## Quick Reference\nb\n## Intent\nz\n## When NOT to use\nf\n## Failure modes\nb\n## Substrate applications\nz'
          }
        },
        expectDecision: 'block',
        expectReasonContains: 'version'
      },
      {
        name: 'F2_tags_too_few',
        payload: {
          tool_name: 'Write',
          tool_input: {
            file_path: '/tmp/h912-fixture/skills/agent-team/kb/architecture/test/tags-2.md',
            content: '---\nkb_id: architecture/test/tags-2\nversion: 1\ntags:\n  - a\n  - b\nsources_consulted:\n  - x\n  - y\n---\n## Summary\nf\n## Quick Reference\nb'
          }
        },
        expectDecision: 'block',
        expectReasonContains: 'tags'
      },
      {
        name: 'F3_sources_too_few',
        payload: {
          tool_name: 'Write',
          tool_input: {
            file_path: '/tmp/h912-fixture/skills/agent-team/kb/architecture/test/sources-1.md',
            content: '---\nkb_id: architecture/test/sources-1\nversion: 1\ntags:\n  - a\n  - b\n  - c\nsources_consulted:\n  - x\n---\n## Summary\nf'
          }
        },
        expectDecision: 'block',
        expectReasonContains: 'sources_consulted'
      },
      {
        name: 'F4_missing_when_not_section',
        payload: {
          tool_name: 'Write',
          tool_input: {
            file_path: '/tmp/h912-fixture/skills/agent-team/kb/architecture/test/no-when-not.md',
            content: '---\nkb_id: architecture/test/no-when-not\nversion: 1\ntags:\n  - a\n  - b\n  - c\nsources_consulted:\n  - x\n  - y\nrelated:\n  - architecture/other/foo\n---\n## Summary\nf\n## Quick Reference\nb\n## Intent\nz\n## Failure modes\nb\n## Substrate applications\nz'
          }
        },
        expectDecision: 'approve',
        expectReasonContains: 'KB-DOC-INCOMPLETE'
      },
      {
        name: 'F5_out_of_scope',
        payload: {
          tool_name: 'Write',
          tool_input: {
            file_path: '/tmp/h912-fixture/some-other-dir/test.md',
            content: 'foo bar baz'
          }
        },
        expectDecision: 'approve',
        expectReasonAbsent: true
      }
    ];
    const results = [];
    for (const f of fixtures) {
      const r = spawnSync('node', [validator], { input: JSON.stringify(f.payload), encoding: 'utf8' });
      if (r.status !== 0) {
        results.push({ name: f.name, ok: false, why: 'non-zero exit: ' + r.status, stderr: r.stderr });
        continue;
      }
      let out;
      try { out = JSON.parse(r.stdout); }
      catch (e) {
        results.push({ name: f.name, ok: false, why: 'json-parse-fail: ' + e.message, stdout: r.stdout.slice(0, 100) });
        continue;
      }
      if (out.decision !== f.expectDecision) {
        results.push({ name: f.name, ok: false, why: 'decision-mismatch: got ' + out.decision + ' want ' + f.expectDecision });
        continue;
      }
      if (f.expectReasonAbsent && out.reason) {
        results.push({ name: f.name, ok: false, why: 'reason-present-but-should-be-absent' });
        continue;
      }
      if (f.expectReasonContains && (!out.reason || !out.reason.includes(f.expectReasonContains))) {
        results.push({ name: f.name, ok: false, why: 'reason-missing-content: want ' + f.expectReasonContains });
        continue;
      }
      results.push({ name: f.name, ok: true });
    }
    const passes = results.filter(r => r.ok).length;
    const fails = results.filter(r => !r.ok);
    console.log(JSON.stringify({ passes, total: fixtures.length, fails }));
  " 2>&1)
  T88_PASSES=$(echo "$T88_RESULT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('passes'))" 2>/dev/null)
  T88_TOTAL=$(echo "$T88_RESULT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('total'))" 2>/dev/null)
  T88_FAILS=$(echo "$T88_RESULT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(json.dumps(d.get('fails', [])))" 2>/dev/null)
  if [ "$T88_PASSES" = "5" ] && [ "$T88_TOTAL" = "5" ]; then
    echo "OK (5/5 fixtures: HARD-block ×3 + SOFT-advisory ×1 + out-of-scope ×1 all match expected decisions)"
    passed=$((passed + 1))
  else
    echo "FAIL: $T88_PASSES/$T88_TOTAL passes; fails=$T88_FAILS [raw: ${T88_RESULT:0:200}]"
    failed=$((failed + 1))
  fi
