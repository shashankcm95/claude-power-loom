#!/usr/bin/env bash
# refresh-plugin-schema.sh — H.7.23 — manual refresh helper for vendored
# plugin manifest + marketplace schemas in swarm/schemas/.
#
# Per swarm/schemas/README.md, refresh cadence is bi-monthly (every other
# phase that touches .claude-plugin/). Run this, review the diff, commit
# if non-empty.
#
# Bash-bug fixes per H.7.22 code-reviewer review baked in (precedent):
#   - `set -e` paired with explicit error checks; no unguarded `read`
#   - paths via `process.argv` style for `node -e` would apply if used
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCHEMAS_DIR="$REPO_ROOT/swarm/schemas"

PLUGIN_URL="https://www.schemastore.org/claude-code-plugin-manifest.json"
MARKET_URL="https://www.schemastore.org/claude-code-marketplace.json"

PLUGIN_VENDORED="$SCHEMAS_DIR/plugin-manifest.schema.json"
MARKET_VENDORED="$SCHEMAS_DIR/marketplace.schema.json"

if [ ! -d "$SCHEMAS_DIR" ]; then
  echo "ERROR: $SCHEMAS_DIR not found. Run from a checkout of claude-power-loom."
  exit 1
fi

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Fetching upstream schemas..."
curl -fsSL "$PLUGIN_URL" -o "$TMP_DIR/plugin-fetched.json" || { echo "ERROR: fetch plugin manifest schema failed"; exit 1; }
curl -fsSL "$MARKET_URL" -o "$TMP_DIR/market-fetched.json" || { echo "ERROR: fetch marketplace schema failed"; exit 1; }

# Validate fetched JSON before considering them
python3 -m json.tool "$TMP_DIR/plugin-fetched.json" > /dev/null || { echo "ERROR: fetched plugin schema is not valid JSON"; exit 1; }
python3 -m json.tool "$TMP_DIR/market-fetched.json" > /dev/null || { echo "ERROR: fetched marketplace schema is not valid JSON"; exit 1; }

PLUGIN_DIFF=$(diff -u "$PLUGIN_VENDORED" "$TMP_DIR/plugin-fetched.json" || true)
MARKET_DIFF=$(diff -u "$MARKET_VENDORED" "$TMP_DIR/market-fetched.json" || true)

if [ -z "$PLUGIN_DIFF" ] && [ -z "$MARKET_DIFF" ]; then
  echo ""
  echo "Both vendored schemas are up-to-date with upstream. No changes."
  exit 0
fi

echo ""
echo "=== Plugin manifest schema diff ==="
[ -n "$PLUGIN_DIFF" ] && echo "$PLUGIN_DIFF" || echo "(no changes)"
echo ""
echo "=== Marketplace schema diff ==="
[ -n "$MARKET_DIFF" ] && echo "$MARKET_DIFF" || echo "(no changes)"
echo ""

read -p "Apply schema updates? [y/N]: " ans || true
if [ "$ans" != "y" ] && [ "$ans" != "Y" ]; then
  echo "Aborted. Vendored schemas unchanged."
  exit 0
fi

[ -n "$PLUGIN_DIFF" ] && cp "$TMP_DIR/plugin-fetched.json" "$PLUGIN_VENDORED" && echo "Updated: $PLUGIN_VENDORED"
[ -n "$MARKET_DIFF" ] && cp "$TMP_DIR/market-fetched.json" "$MARKET_VENDORED" && echo "Updated: $MARKET_VENDORED"

echo ""
echo "Done. Review changes via: git diff $SCHEMAS_DIR/"
echo "If a regex constraint changed, update contract-marketplace-schema in contracts-validate.js to honor the new pattern."
