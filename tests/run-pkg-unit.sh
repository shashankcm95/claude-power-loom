#!/usr/bin/env bash
# Per-package unit-test runner. Invoked by each packages/*/package.json "test"
# script so that `pnpm -r test` actually executes that package's suite instead
# of echo-and-exit. Mirrors the per-file node loop + vacuous-pass guard used by
# the .github/workflows/ci.yml kernel/runtime/lab jobs, so local `pnpm -r test`
# and CI discover the same set of tests/unit/<pkg>/**/*.test.js files.
#
# Usage: bash tests/run-pkg-unit.sh <pkg>   (e.g. kernel | runtime | lab)
#
# Resolves the repo root from this script's own location so it works regardless
# of the cwd pnpm sets when running a workspace package's script.
set -uo pipefail

pkg="${1:-}"
if [ -z "$pkg" ]; then
  echo "::error::run-pkg-unit.sh: missing package name argument" 1>&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
test_dir="$repo_root/tests/unit/$pkg"

if [ ! -d "$test_dir" ]; then
  echo "::error::run-pkg-unit.sh: no test directory at $test_dir" 1>&2
  exit 2
fi

failed=0
count=0
while IFS= read -r -d '' f; do
  count=$((count + 1))
  echo "::group::$f"
  node "$f" || failed=1
  echo "::endgroup::"
done < <(find "$test_dir" -name '*.test.js' -type f -print0)

echo "Ran $count test file(s) under tests/unit/$pkg; failures: $failed"

# Vacuous-pass guard: an empty match (path rename, cwd mismatch) must fail the
# run rather than report a misleading green, matching the CI jobs.
if [ "$count" -eq 0 ]; then
  echo "::error::run-pkg-unit.sh: zero test files matched at $test_dir" 1>&2
  exit 2
fi

exit "$failed"
