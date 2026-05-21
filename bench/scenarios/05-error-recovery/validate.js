// bench/scenarios/05-error-recovery/validate.js

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function validate(workdir, streamMetrics /* , hookBumps */) {
  const checks = {};

  const bashCmds = (streamMetrics && streamMetrics.bash_commands) || [];

  // Initial failure: Claude ran the script at least once (we infer this from any
  // bash command referencing broken-build.sh). The "and failed" part is inferred
  // post-hoc by checking the script's final state — if the script still has
  // its bug, the initial run would have failed.
  const ranScript = bashCmds.some(cmd => /broken-build\.sh/.test(cmd));
  checks.broken_build_initial_failure = {
    pass: ranScript,
    detail: ranScript ? 'broken-build.sh invoked via Bash' : 'broken-build.sh never invoked',
  };

  // After-fix: the script should now run successfully. Try it.
  const scriptPath = path.join(workdir, 'broken-build.sh');
  let scriptExit = -1;
  let scriptOut = '';
  if (fs.existsSync(scriptPath)) {
    try {
      const result = spawnSync('bash', [scriptPath], { encoding: 'utf8', cwd: workdir, timeout: 10000 });
      scriptExit = result.status === null ? -1 : result.status;
      scriptOut = (result.stdout || '') + (result.stderr || '');
    } catch (err) {
      scriptExit = -2;
      scriptOut = err.message;
    }
  }
  checks.broken_build_eventually_succeeds = {
    pass: scriptExit === 0,
    detail: scriptExit === 0
      ? 'broken-build.sh now exits 0 (fixed)'
      : `broken-build.sh still failing (exit=${scriptExit}; output=${scriptOut.slice(0, 100)})`,
  };

  // Loop-detection forcing instruction MUST NOT have fired (proxy for
  // Claude behaving well — didn't blindly retry).
  // Look in subagent results + transcript content for the [BASH-COMMAND-FAILING-REPEATEDLY]
  // marker.
  const subagentResults = ((streamMetrics && streamMetrics.subagent_result_texts) || []).join('\n');
  // We don't have direct access to the parent transcript text here without
  // the transcript_path. The collector does write transcript_path to metrics,
  // but validate.js only sees streamMetrics. As a proxy, check the
  // error-critic log file in ~/.claude/logs/ for any "escalation-emitted"
  // events near this session's timeline.
  // For now, just check subagent results.
  const repeatedFailureFiringSpotted = /\[BASH-COMMAND-FAILING-REPEATEDLY\]|BASH-COMMAND-FAILING/i.test(subagentResults);
  checks.no_repeat_failure_forcing_instruction = {
    pass: !repeatedFailureFiringSpotted,
    detail: repeatedFailureFiringSpotted
      ? 'error-critic emitted loop-detection forcing instruction — Claude retried without diagnosis'
      : 'no loop-detection forcing instruction (clean diagnose-then-fix)',
  };

  return checks;
}

module.exports = { validate };
