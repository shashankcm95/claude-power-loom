# shellcheck shell=bash
# shellcheck disable=SC2168  # H.9.1 — sourced by install.sh run_smoke_tests(); `local` is function-scope at runtime
# tests/smoke-library-gc.sh — H.9.21.5 v2.1.6 library gc smoke tests.
#
# Sourced by install.sh run_smoke_tests(). Mutates parent-scope $passed/$failed.
#
# Tests (2):
#   Test 114 — Stale lockfile reclamation: dead-PID lockfile older than max-age
#              is detected in dry-run, removed under --apply, idempotent on
#              re-run. Validates inspectLock() decision matrix (pid-dead branch).
#   Test 115 — Orphaned _backups reclamation + sentinel protection: backup older
#              than soak-days but NOT matching .migrate-complete.run_id is
#              reclaimed; backup matching the live sentinel is NEVER touched
#              (regardless of age). Validates the saga-rollback safety invariant.
#
# Isolation: ephemeral CLAUDE_LIBRARY_ROOT per test (Component O bulkhead pattern).
# H.9.16 drift-note 78(a) safe-pattern: init T_EXIT=0 + || T_EXIT=$?.

  # Test 114: H.9.21.5 — stale lockfile reclamation.
  # Create a lockfile with a guaranteed-dead PID (999999), backdate its mtime to
  # 2h ago (past default 1h max-age), confirm gc dry-run lists it without
  # deleting, gc --apply removes it, second gc shows 0 (idempotent).
  echo -n "  Test 114 (H.9.21.5 gc stale-lockfile reclamation): "
  T114_TMPROOT=$(mktemp -d)
  CLAUDE_LIBRARY_ROOT="$T114_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" init >/dev/null 2>&1
  T114_LOCK="$T114_TMPROOT/sections/toolkit/stacks/self-improve/_catalog.json.lock"
  mkdir -p "$(dirname "$T114_LOCK")"
  echo "999999" > "$T114_LOCK"
  # Backdate to 2h ago — guaranteed > default 1h max-age
  T114_OLD_TS=$(date -r $(( $(date +%s) - 7200 )) +%Y%m%d%H%M 2>/dev/null || date -d "@$(( $(date +%s) - 7200 ))" +%Y%m%d%H%M 2>/dev/null)
  touch -t "$T114_OLD_TS" "$T114_LOCK" 2>/dev/null
  # Dry-run — must list but NOT delete
  T114_DRY=$(CLAUDE_LIBRARY_ROOT="$T114_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" gc 2>&1)
  T114_DRY_KEPT=0
  [ -f "$T114_LOCK" ] && T114_DRY_KEPT=1
  T114_DRY_LISTED=0
  echo "$T114_DRY" | grep -q "WOULD-DELETE.*$T114_LOCK" && T114_DRY_LISTED=1
  # Apply
  T114_APPLY=$(CLAUDE_LIBRARY_ROOT="$T114_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" gc --apply 2>&1)
  T114_APPLY_REMOVED=0
  [ ! -f "$T114_LOCK" ] && T114_APPLY_REMOVED=1
  # Idempotent re-run — must show 0 stale
  T114_RERUN=$(CLAUDE_LIBRARY_ROOT="$T114_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" gc --apply 2>&1)
  T114_RERUN_ZERO=0
  echo "$T114_RERUN" | grep -q "Stale lockfiles: 0" && T114_RERUN_ZERO=1
  if [ "$T114_DRY_KEPT" = "1" ] && [ "$T114_DRY_LISTED" = "1" ] && [ "$T114_APPLY_REMOVED" = "1" ] && [ "$T114_RERUN_ZERO" = "1" ]; then
    echo "PASS (dry=kept+listed; apply=removed; rerun=0)"
    passed=$((passed+1))
  else
    echo "FAIL (dry_kept=$T114_DRY_KEPT dry_listed=$T114_DRY_LISTED apply_removed=$T114_APPLY_REMOVED rerun_zero=$T114_RERUN_ZERO)"
    echo "       dry-run output: $(echo "$T114_DRY" | head -10 | tr '\n' ' ')"
    failed=$((failed+1))
  fi
  rm -rf "$T114_TMPROOT"

  # Test 115: H.9.21.5 — orphaned _backups reclamation + sentinel protection.
  # Create two backup dirs in _backups/: one OLD whose run_id matches the live
  # .migrate-complete (rollback path; must be kept), one OLD orphan run_id
  # (must be reclaimed under --soak-days=0). Tests the safety invariant from
  # the saga contract (CRITICAL #1 of v2.1.0).
  echo -n "  Test 115 (H.9.21.5 gc orphaned-backups + sentinel-protection): "
  T115_TMPROOT=$(mktemp -d)
  CLAUDE_LIBRARY_ROOT="$T115_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" init >/dev/null 2>&1
  # Materialize _backups/ since init doesn't (created on first migrate)
  mkdir -p "$T115_TMPROOT/_backups"
  T115_LIVE_RUNID="2026-01-01T00-00-00-LIVE"
  T115_ORPHAN_RUNID="2026-01-01T00-00-00-ORPHAN"
  mkdir -p "$T115_TMPROOT/_backups/$T115_LIVE_RUNID"
  mkdir -p "$T115_TMPROOT/_backups/$T115_ORPHAN_RUNID"
  echo "live-snapshot" > "$T115_TMPROOT/_backups/$T115_LIVE_RUNID/file.txt"
  echo "orphan-snapshot" > "$T115_TMPROOT/_backups/$T115_ORPHAN_RUNID/file.txt"
  # Backdate both backup dirs by 8 days so they're past the default 7-day soak.
  # The live one will still be kept (sentinel match); the orphan should be reclaimed.
  T115_OLD_TS=$(date -r $(( $(date +%s) - 691200 )) +%Y%m%d%H%M 2>/dev/null || date -d "@$(( $(date +%s) - 691200 ))" +%Y%m%d%H%M 2>/dev/null)
  touch -t "$T115_OLD_TS" "$T115_TMPROOT/_backups/$T115_LIVE_RUNID" "$T115_TMPROOT/_backups/$T115_ORPHAN_RUNID" 2>/dev/null
  # Write the live sentinel
  cat > "$T115_TMPROOT/.migrate-complete" <<EOF
{
  "run_id": "$T115_LIVE_RUNID",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "file_count": 1,
  "schema_version": 1
}
EOF
  # Run gc with default soak-days (7d); backdate above ensures past-threshold
  T115_OUT=$(CLAUDE_LIBRARY_ROOT="$T115_TMPROOT" node "$SCRIPT_DIR/scripts/library.js" gc --apply 2>&1)
  T115_LIVE_KEPT=0
  [ -d "$T115_TMPROOT/_backups/$T115_LIVE_RUNID" ] && T115_LIVE_KEPT=1
  T115_ORPHAN_REMOVED=0
  [ ! -d "$T115_TMPROOT/_backups/$T115_ORPHAN_RUNID" ] && T115_ORPHAN_REMOVED=1
  if [ "$T115_LIVE_KEPT" = "1" ] && [ "$T115_ORPHAN_REMOVED" = "1" ]; then
    echo "PASS (live-sentinel kept; orphan reclaimed)"
    passed=$((passed+1))
  else
    echo "FAIL (live_kept=$T115_LIVE_KEPT orphan_removed=$T115_ORPHAN_REMOVED)"
    echo "       output: $(echo "$T115_OUT" | head -10 | tr '\n' ' ')"
    failed=$((failed+1))
  fi
  rm -rf "$T115_TMPROOT"
