'use strict';

// tests/unit/kernel/_lib/_hermetic-hook-logs.js
//
// Redirect hook logging (packages/kernel/hooks/_lib/_log.js) to a hermetic temp
// dir so a test that runs a logging hook — an in-process require OR a child
// process that inherits env — never pollutes the real ~/.claude/logs/<hook>.log
// with fixture noise (nomut01, e2e01, …).
//
// Require this near the top of any such test:
//     require('../_lib/_hermetic-hook-logs');   // adjust depth per test location
//
// _log.js resolveLogDir() honors LOOM_LOG_DIR per-call, so requiring this any
// time before the hook actually logs is sufficient. Idempotent: an already-set
// LOOM_LOG_DIR is respected, so multiple requires share one dir and an explicit
// caller override still wins.

const fs = require('fs');
const os = require('os');
const path = require('path');

if (!process.env.LOOM_LOG_DIR) {
  process.env.LOOM_LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-test-logs-'));
}

module.exports = { logDir: process.env.LOOM_LOG_DIR };
