// bench/scenarios/04-hets-routed-plan/validate.js

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

function validate(workdir, streamMetrics /* , hookBumps */) {
  const checks = {};

  const cachePath = path.join(workdir, 'cache.js');
  const cacheContent = fs.existsSync(cachePath) ? fs.readFileSync(cachePath, 'utf8') : '';

  // TTL support: look for ttlMs reference + expiry check (Date.now / setTimeout / etc.)
  const hasTtlArg = /ttlMs|ttl\s*:\s*\w+|expires|expiresAt|expiry/i.test(cacheContent);
  const hasTimeCheck = /Date\.now|Date\.now\(\)|performance\.now|setTimeout/.test(cacheContent);
  checks.cache_has_ttl = {
    pass: hasTtlArg && hasTimeCheck,
    detail: `ttl-arg=${hasTtlArg ? 'yes' : 'no'} time-check=${hasTimeCheck ? 'yes' : 'no'}`,
  };

  // True LRU: look for access-order tracking beyond Map insertion order
  // (a separate access list, recency timestamp, doubly-linked list, or
  // explicit "move to end on access" pattern)
  const lruPatterns = [
    /accessOrder|access_order|accessList|accesses\s*\[/,
    /move[\s_]?to[\s_]?(end|front|head|tail)/i,
    /\.delete\([^)]+\).*\.set\(/,            // delete-then-set re-promotion idiom
    /lastAccessed|lastUsed/i,
    /recency|recently/i,
    /\bDLL\b|doubly[\s_-]?linked/i,
  ];
  checks.cache_has_lru = {
    pass: lruPatterns.some(re => re.test(cacheContent)),
    detail: lruPatterns.some(re => re.test(cacheContent))
      ? 'LRU tracking pattern present'
      : 'no LRU access-order tracking observed',
  };

  // Stats: getStats() method or stats getter
  checks.cache_has_stats = {
    pass: /getStats|get\s+stats\s*\(\)|stats\s*=\s*\{|hits\s*:\s*\d|misses\s*:\s*\d/.test(cacheContent),
    detail: /getStats|get stats/.test(cacheContent) ? 'stats accessor present' : 'no stats accessor',
  };

  // Tests added (fixture starts with 3)
  const testPath = path.join(workdir, 'cache.test.js');
  const testContent = fs.existsSync(testPath) ? fs.readFileSync(testPath, 'utf8') : '';
  const testCount = (testContent.match(/^\s*test\s*\(/gm) || []).length;
  checks.test_added = {
    pass: testCount > 3,
    detail: `${testCount} test(s); fixture started with 3`,
  };

  // Smoke pass
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

  // Plan artifact: a plan file under .claude/plans/ in cwd OR a TodoWrite with ≥3 items
  let planFileExists = false, planFilePath = null;
  const planDirs = [
    path.join(workdir, '.claude/plans'),
    path.join(os.homedir(), '.claude/plans'),
  ];
  for (const d of planDirs) {
    if (fs.existsSync(d)) {
      try {
        const md = fs.readdirSync(d).filter(f => f.endsWith('.md'));
        if (md.length > 0) {
          // We can't filter by "this session" easily — accept any recent plan file
          planFileExists = true;
          planFilePath = path.join(d, md[md.length - 1]);
          break;
        }
      } catch { /* skip */ }
    }
  }
  const todoMax = (streamMetrics && streamMetrics.todo_write_max_items) || 0;
  checks.plan_artifact_present = {
    pass: planFileExists || todoMax >= 3,
    detail: planFileExists
      ? `plan-file at ${planFilePath}`
      : `TodoWrite max-items=${todoMax} (need ≥3)`,
  };

  return checks;
}

module.exports = { validate };
