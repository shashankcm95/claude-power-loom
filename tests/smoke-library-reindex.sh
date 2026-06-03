# shellcheck shell=bash
# shellcheck disable=SC2168  # H.9.1 — sourced by install.sh run_smoke_tests(); `local` is function-scope at runtime
# tests/smoke-library-reindex.sh — `library reindex` catalog-repair smoke test.
#
# Sourced by install.sh run_smoke_tests(). Mutates parent-scope $passed/$failed.
#
# Tests (1):
#   Test 120 — reindex rebuilds a stale catalog from directly-written volumes.
#              Simulates the pre-compact SAVE_PROMPT failure mode: a snapshot
#              .md is written straight into volumes/ (bypassing `library write`),
#              so `ls` is blind to it. After `reindex`, the catalog lists it and
#              `read` resolves it.
#
# Isolation: HOME-redirect into ephemeral tmpdir (same pattern as smoke-library-init.sh).

  # Test 120: library reindex rebuilds catalog from on-disk volumes
  echo -n "  Test 120 (library reindex rebuilds stale catalog from directly-written volume): "
  T120_TMPROOT=$(mktemp -d)
  mkdir -p "$T120_TMPROOT/.claude/checkpoints"
  printf "# fixture\n" > "$T120_TMPROOT/.claude/checkpoints/mempalace-fallback.md"
  echo '{}' > "$T120_TMPROOT/.claude/prompt-patterns.json"

  HOME="$T120_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" init >/dev/null 2>&1

  # Directly write a snapshot into volumes/ — bypassing `library write`, exactly
  # as the pre-compact SAVE_PROMPT does. The catalog stays unaware of it.
  T120_VOLDIR="$T120_TMPROOT/.claude/library/sections/toolkit/stacks/session-snapshots/volumes"
  mkdir -p "$T120_VOLDIR"
  printf -- "---\ntopic: alpha, beta\n---\n# direct write\n" > "$T120_VOLDIR/2026-06-03-direct-write.md"

  # Pre-reindex: ls must NOT see it (proves the drift the command repairs).
  T120_BEFORE=$(HOME="$T120_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" ls toolkit/session-snapshots 2>&1)

  # Reindex, then ls + read must both resolve the directly-written volume.
  T120_REIDX=0
  HOME="$T120_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" reindex toolkit/session-snapshots >/dev/null 2>&1 || T120_REIDX=$?
  T120_AFTER=$(HOME="$T120_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" ls toolkit/session-snapshots 2>&1)
  T120_READ=0
  HOME="$T120_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" read toolkit/session-snapshots/2026-06-03-direct-write >/dev/null 2>&1 || T120_READ=$?

  if [ "$T120_REIDX" = "0" ] && [ "$T120_READ" = "0" ] && \
     ! echo "$T120_BEFORE" | grep -q "2026-06-03-direct-write" && \
     echo "$T120_AFTER" | grep -q "2026-06-03-direct-write"; then
    echo "PASS (drift before; indexed + readable after reindex)"
    passed=$((passed+1))
  else
    echo "FAIL (reindex=$T120_REIDX read=$T120_READ before='${T120_BEFORE:0:40}' after='${T120_AFTER:0:40}')"
    failed=$((failed+1))
  fi
  rm -rf "$T120_TMPROOT"
