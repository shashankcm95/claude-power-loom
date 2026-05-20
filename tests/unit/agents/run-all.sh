#!/usr/bin/env bash
# tests/unit/agents/run-all.sh — run all agent unit tests.
#
# Usage:
#   bash tests/unit/agents/run-all.sh          # static tests only
#   BEHAVIORAL=1 bash tests/unit/agents/run-all.sh  # + behavioral spawns (~$1-3 in tokens)

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOTAL_PASS=0
TOTAL_FAIL=0
FAILED_FILES=()

for test_file in "$SCRIPT_DIR"/*.test.js; do
  [ -f "$test_file" ] || continue
  test_name=$(basename "$test_file" .test.js)
  printf "\n>>> %s\n" "$test_name"
  if node "$test_file"; then
    TOTAL_PASS=$((TOTAL_PASS + 1))
  else
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
    FAILED_FILES+=("$test_name")
  fi
done

echo ""
echo "========================================"
echo "Unit test files: ${TOTAL_PASS} passed, ${TOTAL_FAIL} failed"
if [ ${#FAILED_FILES[@]} -gt 0 ]; then
  echo "Failed files:"
  for f in "${FAILED_FILES[@]}"; do echo "  - $f"; done
fi
echo "========================================"

[ "$TOTAL_FAIL" -eq 0 ]
