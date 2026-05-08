#!/usr/bin/env bash
# migrate-to-plugin.sh — H.7.22 — clear legacy hooks block in ~/.claude/settings.json
# so the power-loom plugin (installed via /plugin install) becomes the sole source
# of hook configuration. Used as a fallback for users running outside Claude Code
# (e.g., shell-only setup). Inside Claude Code, the [PLUGIN-NOT-LOADED] forcing
# instruction asks Claude to perform this migration directly via Edit (which fires
# the self-modification gate for explicit user confirmation).
#
# Bash-bug fixes applied per H.7.22 code-reviewer review (do NOT regress these):
#   - H1: `read -p ... ans || true` (set -e + read interaction; EOF exits silently)
#   - H2: `$SETTINGS` passed as `process.argv[1]`, NOT inside `node -e '...'` (single
#         quotes prevent bash variable expansion — would write to literal `$SETTINGS`)
#   - H3: explicit no-hooks-window WARNING printed before confirmation prompt
set -e

SETTINGS="$HOME/.claude/settings.json"
BACKUP="$SETTINGS.h722-pre-migration-$(date +%s).bak"

if [ ! -f "$SETTINGS" ]; then
  echo "ERROR: $SETTINGS not found. Run install.sh first or check your Claude Code install."
  exit 1
fi

cp "$SETTINGS" "$BACKUP"
echo "Backup: $BACKUP"
echo ""
echo "=== Diff: current 'hooks' block → after migration ('hooks: {}') ==="
diff <(node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).hooks,null,2))" "$SETTINGS") <(echo '{}') || true
echo ""
echo "WARNING: clearing 'hooks' to {} removes ALL hooks until /plugin install completes."
echo "         This means a brief no-hooks window — no fact-force gate, no config-guard,"
echo "         no secrets validator — between migration apply and plugin load."
echo "         Backup is at: $BACKUP"
echo ""
read -p "Apply (clear hooks block)? [y/N]: " ans || true
if [ "$ans" != "y" ] && [ "$ans" != "Y" ]; then
  echo "Aborted. Settings unchanged."
  exit 0
fi

node -e "const fs=require('fs');const p=process.argv[1];const d=JSON.parse(fs.readFileSync(p,'utf8'));d.hooks={};fs.writeFileSync(p,JSON.stringify(d,null,2)+'\n');" "$SETTINGS"

echo ""
echo "Done. Hooks block cleared in $SETTINGS."
echo ""
echo "Next steps:"
echo "  1. Run: /plugin install power-loom@power-loom-marketplace"
echo "  2. Restart your Claude Code session."
echo "  3. Verify: tail -1 ~/.claude/logs/session-reset.log"
echo "             Expected: pluginRoot set + looksLikePluginInstall:true"
echo ""
echo "Rollback (if needed): cp $BACKUP $SETTINGS"
