#!/usr/bin/env node

// Stop hook: warns about console.log statements in recently edited files.
// Uses git repo root for absolute path resolution (works in monorepos).

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { log } = require('./_log.js');
const logger = log('console-log-check');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    // Get the git repo root for absolute path resolution
    // REVIEWED-SAFE H.8.4: fixed-string args; no shell-injection vector. Do not migrate to execFileSync without re-review.
    const repoRoot = execSync('git rev-parse --show-toplevel 2>/dev/null || true', {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();

    if (!repoRoot) {
      process.stdout.write(input);
      return;
    }

    // Include both committed changes and new untracked files
    // REVIEWED-SAFE H.8.4: fixed-string args; no shell-injection vector. Do not migrate to execFileSync without re-review.
    const committed = execSync('git diff --name-only HEAD 2>/dev/null || true', {
      encoding: 'utf8',
      timeout: 5000,
    }).trim().split('\n');

    // REVIEWED-SAFE H.8.4: fixed-string args; no shell-injection vector. Do not migrate to execFileSync without re-review.
    const untracked = execSync('git ls-files --others --exclude-standard 2>/dev/null || true', {
      encoding: 'utf8',
      timeout: 5000,
    }).trim().split('\n');

    const changedFiles = [...committed, ...untracked]
      .filter(Boolean)
      .map((f) => path.resolve(repoRoot, f))
      .filter((f) => /\.(ts|tsx|js|jsx)$/.test(f) && fs.existsSync(f));

    const filesWithConsoleLog = [];

    for (const file of changedFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      // Phase-E1: Removed `break` — collect ALL violations per file so
      // developers don't fix only the first reported line and miss others.
      // Phase-F8: Added \b word boundary to avoid false positives on
      // identifiers like `foo.console.log(`.
      for (let i = 0; i < lines.length; i++) {
        if (/\bconsole\.log\(/.test(lines[i]) &&
            !/\/\/\s*eslint-disable/.test(lines[i]) &&
            !/\/\*.*eslint-disable.*\*\//.test(lines[i]) &&
            !(i > 0 && /eslint-disable-next-line/.test(lines[i - 1]))) {
          const relPath = path.relative(repoRoot, file);
          filesWithConsoleLog.push(`  ${relPath}:${i + 1}`);
        }
      }
    }

    if (filesWithConsoleLog.length > 0) {
      logger('warned', { count: filesWithConsoleLog.length, files: filesWithConsoleLog });
      const warning = `\n\n⚠ console.log detected in edited files:\n${filesWithConsoleLog.join('\n')}\nRemove before committing.`;
      process.stdout.write(input + warning);
    } else {
      logger('clean', { scanned: changedFiles.length });
      process.stdout.write(input);
    }
  } catch (err) {
    logger('error', { error: err.message });
    process.stdout.write(input);
  }
});
