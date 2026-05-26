// bench/scenarios/01-multi-feature-export/validate.js
//
// Scenario-specific deterministic PASS criteria for the original boot-test
// scenario. Returns an object keyed by check-name with { pass, detail } values.
//
// Signature: validate(workdir, streamMetrics, hookBumps) → { [check]: { pass, detail } }
//
// Universal checks (claude_exit_zero, subagent_spawned, no_ask_user_question_errors,
// stop_hook_fired) live in collect.js and are merged automatically.

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function validate(workdir /* , streamMetrics, hookBumps */) {
  const checks = {};

  const cliPath = path.join(workdir, 'cli.js');
  const cliContent = fs.existsSync(cliPath) ? fs.readFileSync(cliPath, 'utf8') : '';

  checks.cli_has_export = {
    pass: /['"]export['"]|cmdExport|function\s+\w*[Ee]xport|export.*=>/.test(cliContent),
    detail: /['"]export['"]|cmdExport/.test(cliContent) ? 'export reference found' : 'no export handler',
  };

  const hasJsonHandling = /\.json|JSON\.stringify|application\/json/i.test(cliContent);
  const hasCsvHandling = /\.csv|csv/i.test(cliContent);
  checks.cli_has_both_formats = {
    pass: hasJsonHandling && hasCsvHandling,
    detail: `json=${hasJsonHandling ? 'yes' : 'no'} csv=${hasCsvHandling ? 'yes' : 'no'}`,
  };

  const testPath = path.join(workdir, 'cli.test.js');
  const testContent = fs.existsSync(testPath) ? fs.readFileSync(testPath, 'utf8') : '';
  const testCount = (testContent.match(/^\s*test\s*\(/gm) || []).length;
  checks.test_added = {
    pass: testCount > 3,
    detail: `${testCount} test(s); fixture started with 3`,
  };

  let testExit = -1, testOutput = '';
  try {
    testOutput = execSync(`node "${testPath}"`, { encoding: 'utf8', cwd: workdir, timeout: 30000 });
    testExit = 0;
  } catch (err) {
    testExit = err.status || 1;
    testOutput = (err.stdout || '') + (err.stderr || '');
  }
  checks.smoke_tests_pass = {
    pass: testExit === 0,
    detail: `exit=${testExit}; ${(testOutput.match(/(\d+) passed/) || ['?'])[0]}`,
  };

  const readmePath = path.join(workdir, 'README.md');
  const readmeContent = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8') : '';
  const readmeHasExport = /\bexport\b/i.test(readmeContent);
  const readmeHasFormat = /\b(csv|json)\b/i.test(readmeContent);
  checks.readme_mentions_export = {
    pass: readmeHasExport && readmeHasFormat,
    detail: `export=${readmeHasExport ? 'yes' : 'no'} format-named=${readmeHasFormat ? 'yes' : 'no'}`,
  };

  const validationPatterns = [
    /path\.isAbsolute/,
    /path\.normalize/,
    /path\.resolve/,
    /\.\.\//,
    /['"]\.\.['"]/,
    /throw new Error.*path/i,
    /invalid path/i,
    /traversal/i,
  ];
  const hasValidation = validationPatterns.some(re => re.test(cliContent));
  checks.cli_has_path_validation = {
    pass: hasValidation,
    detail: hasValidation ? 'validation pattern present' : 'no obvious path-validation pattern',
  };

  return checks;
}

module.exports = { validate };
