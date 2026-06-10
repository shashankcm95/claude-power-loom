#!/usr/bin/env bash
# tests/smoke-drift-gates.sh
#
# CAND-5 (self-improve 2026-06-10): the three drift gates that were enforced ONLY in
# CI, never in the local `install.sh --hooks --test` pre-push smoke —
#   (1) generate-signpost --check  (docs/SIGNPOST.md vs the .js tree)
#   (2) validate-doc-paths         (no skill/command/kb doc cites a non-existent path)
#   (3) contracts-validate         (KB architecture `related:` links are bidirectional)
# A new .js (signpost drift), a stale doc path, or a one-directional `related:` link
# therefore passed the local gate and failed minutes later in CI. This recurred 5x
# (#276 / #281 / #283 / #285 + the 2026-06-10 deep-freeze.js chip). These tests close
# the local-vs-CI gap: the same drift CI catches is now caught pre-push.
#
# Sourced by install.sh run_smoke_tests() — mutates the parent-scope passed/failed
# counters via bash lexical scope (the HT.1.4 sourced-file convention). Uses the
# H.9.6.2 errexit-safe `TNN_EXIT=0 + || TNN_EXIT=$?` pattern (install.sh runs under
# `set -euo pipefail`; a bare `$(failing_cmd)` would abort before the if/else could
# report FAIL).

# Test 121: generate-signpost --check — SIGNPOST.md is in sync with the .js tree.
echo -n "  Test 121 (drift-gate: generate-signpost --check — SIGNPOST.md in sync with the .js tree): "
T121_EXIT=0
T121_OUT=$(cd "$SCRIPT_DIR" && node scripts/generate-signpost.js --check 2>&1) || T121_EXIT=$?
if [ "$T121_EXIT" -eq 0 ]; then
  echo "OK (signpost up to date)"
  passed=$((passed + 1))
else
  echo "FAIL: SIGNPOST drift — run 'node scripts/generate-signpost.js' to regenerate (exit $T121_EXIT)"
  failed=$((failed + 1))
fi

# Test 122: validate-doc-paths — no skill/command/kb doc cites a non-existent path.
echo -n "  Test 122 (drift-gate: validate-doc-paths — no doc cites a non-existent path): "
T122_EXIT=0
T122_OUT=$(cd "$SCRIPT_DIR" && node scripts/validate-doc-paths.js 2>&1) || T122_EXIT=$?
if [ "$T122_EXIT" -eq 0 ]; then
  echo "OK (doc-path clean)"
  passed=$((passed + 1))
else
  echo "FAIL: stale doc-path ref(s) — see 'node scripts/validate-doc-paths.js' (exit $T122_EXIT)"
  failed=$((failed + 1))
fi

# Test 123: contracts-validate — KB architecture `related:` links are bidirectional
# (a one-directional link is the H.7-era CI-only failure class; markdownlint does NOT
# cover it). A bare run validates all scopes and exits non-zero on any violation.
echo -n "  Test 123 (drift-gate: contracts-validate — 0 violations incl. asymmetric related-link): "
T123_EXIT=0
T123_OUT=$(cd "$SCRIPT_DIR" && node packages/runtime/orchestration/contracts-validate.js 2>&1) || T123_EXIT=$?
if [ "$T123_EXIT" -eq 0 ]; then
  echo "OK (contracts clean; 0 violations)"
  passed=$((passed + 1))
else
  echo "FAIL: contracts-validate reported violations — see output (exit $T123_EXIT)"
  failed=$((failed + 1))
fi
