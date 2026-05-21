# Fixture — Scenario 05 (error recovery)

`broken-build.sh` intentionally fails (missing file ref). Used to trigger error-critic.js hook.

When Claude runs the script, the Bash tool returns non-zero. The PostToolUse:Bash hook records the failure. On repeat invocation of the same failing command, error-critic emits a forcing instruction telling Claude to diagnose root-cause rather than retry blindly.
