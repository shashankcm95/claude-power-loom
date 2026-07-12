#!/usr/bin/env bash
# Shared per-file test-suite runner — the single owned abstraction behind every
# CI test job (.github/workflows/ci.yml: kernel / runtime / lab / aux / integration)
# AND the per-package pnpm runner (tests/run-pkg-unit.sh). Extracted so the
# null-delimited find + per-file `node "$f"` loop + count==0 vacuous-pass guard
# lives in ONE place instead of the six verbatim copies it had grown into.
#
# Runs each matched file as `node "$f"` — NEVER `node --test`. The suites are
# imperative-assert files (top-level assert(), not node:test test()/describe());
# `node --test` sees zero registered tests and exits 0, false-greening even when
# assertions throw. (See the ci.yml kernel-property-tests comment for the full
# rationale.)
#
# Usage:
#   run-suite.sh --root <dir> [--glob <pattern>] [--exclude <path-glob>]... [--label <text>]
#
#   --root     (required) directory to search (absolute in CI: "$GITHUB_WORKSPACE/...").
#   --glob     -name pattern for find; default "*.test.js" (integration uses "*.integration.js").
#   --exclude  repeatable; each adds a `-not -path <glob>` predicate, in order.
#   --label    human label for the summary / error lines; defaults to --root.
#
# Exit codes: 0 = every matched file passed; 1 = at least one file failed; 2 =
# misuse OR the vacuous-pass guard (zero files matched — a cwd/rename/glob error
# must fail loud, never green).
#
# Deliberately NO `set -e`: a failing `node "$f"` must NOT abort the loop (we
# accumulate into $failed and report every file), matching the CI jobs' `set +e`.
set -uo pipefail

root=""
glob="*.test.js"
label=""
excludes=()

# Each flag REQUIRES a following value. A missing value (flag at end-of-args, or
# immediately followed by another --flag) fails LOUD (exit 2) rather than silently
# no-op'ing — e.g. a valueless `--exclude` must not append an empty (match-nothing)
# predicate and thereby mask a typo'd pattern. The `[ "$#" -lt 2 ]` guard ensures
# the subsequent `shift 2` is always in range (bash-3.2 safe).
while [ "$#" -gt 0 ]; do
  case "$1" in
    --root|--glob|--exclude|--label)
      flag="$1"
      if [ "$#" -lt 2 ]; then
        echo "::error::run-suite.sh: $flag requires a value" 1>&2
        exit 2
      fi
      val="$2"
      case "$val" in
        --*)
          echo "::error::run-suite.sh: $flag requires a value (got flag '$val')" 1>&2
          exit 2 ;;
      esac
      case "$flag" in
        --root)    root="$val" ;;
        --glob)    glob="$val" ;;
        --exclude) excludes+=("$val") ;;
        --label)   label="$val" ;;
      esac
      shift 2 ;;
    *)
      echo "::error::run-suite.sh: unknown argument: $1" 1>&2
      exit 2 ;;
  esac
done

if [ -z "$root" ]; then
  echo "::error::run-suite.sh: --root <dir> is required" 1>&2
  exit 2
fi
[ -n "$label" ] || label="$root"

# Build the find predicate list explicitly so roots/globs with spaces stay safe and
# the predicate ORDER matches the original inlined jobs exactly
# (<root> -name <glob> -type f [-not -path <ex>]... -print0).
find_args=("$root" -name "$glob" -type f)
if [ "${#excludes[@]}" -gt 0 ]; then
  for ex in "${excludes[@]}"; do
    find_args+=(-not -path "$ex")
  done
fi
find_args+=(-print0)

failed=0
count=0
while IFS= read -r -d '' f; do
  count=$((count + 1))
  echo "::group::$f"
  node "$f"
  rc=$?
  echo "::endgroup::"
  if [ "$rc" -ne 0 ]; then
    failed=1
  fi
done < <(find "${find_args[@]}")

echo "Ran $count file(s) under $label; failures: $failed"

# Vacuous-pass guard: zero matches means a cwd mismatch, a path rename, or a bad
# glob — fail loud instead of reporting a misleading green, matching every CI job.
if [ "$count" -eq 0 ]; then
  echo "::error::run-suite.sh: zero files matched '$glob' under $label — vacuous-pass guard failing the run." 1>&2
  exit 2
fi

exit "$failed"
