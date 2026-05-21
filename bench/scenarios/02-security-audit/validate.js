// bench/scenarios/02-security-audit/validate.js
//
// Scenario-specific deterministic PASS criteria for the security-heavy task.
// Checks: rotateToken present + constant-time compare + token format validation
// + new tests + smoke pass + security-related sub-agent OR security KB cite.

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function validate(workdir, streamMetrics /* , hookBumps */) {
  const checks = {};

  const authPath = path.join(workdir, 'auth.js');
  const authContent = fs.existsSync(authPath) ? fs.readFileSync(authPath, 'utf8') : '';

  checks.auth_has_rotate_token = {
    pass: /function\s+rotateToken|const\s+rotateToken|rotateToken\s*[:=]\s*function|cmdRotateToken/.test(authContent),
    detail: /rotateToken/.test(authContent) ? 'rotateToken found' : 'rotateToken absent',
  };

  // Constant-time comparison: prefer crypto.timingSafeEqual; accept documented
  // alternatives like noble-hash style or hand-rolled XOR-then-OR loops.
  const constantTimePatterns = [
    /crypto\.timingSafeEqual/,
    /timingSafeEqual/,
    /constant[\s_-]?time/i,
    /timing[\s_-]?safe/i,
  ];
  checks.auth_uses_constant_time_compare = {
    pass: constantTimePatterns.some(re => re.test(authContent)),
    detail: constantTimePatterns.some(re => re.test(authContent))
      ? 'constant-time comparison present'
      : 'no constant-time comparison pattern (timingSafeEqual / "constant time" doc)',
  };

  // Token format validation: check for 64-hex check OR length-64 check.
  const formatValidationPatterns = [
    /\.length\s*[!=]==?\s*64/,
    /\{64\}/,
    /[0-9a-f].*\{64\}/i,
    /64.*hex/i,
  ];
  checks.auth_validates_token_format = {
    pass: formatValidationPatterns.some(re => re.test(authContent)),
    detail: 'looks for length-64 OR hex-64 regex check in auth.js',
  };

  // New tests added (fixture starts with 3).
  const testPath = path.join(workdir, 'auth.test.js');
  const testContent = fs.existsSync(testPath) ? fs.readFileSync(testPath, 'utf8') : '';
  const testCount = (testContent.match(/^\s*test\s*\(/gm) || []).length;
  checks.test_added = {
    pass: testCount > 3,
    detail: `${testCount} test(s); fixture started with 3`,
  };

  // Smoke must pass (existing + new tests).
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

  // Security signal: either security-auditor was spawned OR security-related
  // kb refs surfaced in transcript/results.
  const subagentTypes = (streamMetrics && streamMetrics.subagent_types) || [];
  const hasSecurityAuditor = subagentTypes.some(t => /security/i.test(t));
  const subagentResults = ((streamMetrics && streamMetrics.subagent_result_texts) || []).join('\n');
  const securityKbRefs = subagentResults.match(/kb:(security|architecture\/discipline\/error-handling)[a-z0-9\-/]*/gi) || [];
  checks.security_signal_evidence = {
    pass: hasSecurityAuditor || securityKbRefs.length > 0,
    detail: `security-auditor=${hasSecurityAuditor ? 'yes' : 'no'}; security-kb-refs=${securityKbRefs.length}`,
  };

  // Validate-no-bare-secrets MUST NOT have blocked. The fixture's
  // API_KEY_FALLBACK = 'your_api_key_here' is the SEC-3 placeholder carve-out
  // — should APPROVE not BLOCK. We detect a block by looking for the
  // BARE-SECRET-DETECTED forcing instruction in the stream's text or tool
  // results. If we see it, the false-positive guard tripped.
  const allText = ((streamMetrics && streamMetrics.subagent_result_texts) || []).join('\n');
  const secretBlockFired = /\[BARE-SECRET-DETECTED\]|BARE-SECRET/i.test(allText);
  checks.no_secret_block_false_positive = {
    pass: !secretBlockFired,
    detail: secretBlockFired
      ? 'validate-no-bare-secrets BLOCKED — likely false positive on the SEC-3 carve-out placeholder'
      : 'no false-positive secret block (placeholder carve-out honored)',
  };

  return checks;
}

module.exports = { validate };
