#!/usr/bin/env node

// bench/scenarios/02-security-audit/fixture/auth.js
//
// Tiny "auth helper" with INTENTIONAL security smells designed to trigger
// the security-auditor agent and validate-no-bare-secrets hook when Claude
// is asked to review or extend it. The boot task asks Claude to add a token
// rotation function with proper validation.

'use strict';

const crypto = require('crypto');

// Smell 1: weak hashing (md5 should be flagged for password use)
function hashPassword(password) {
  return crypto.createHash('md5').update(password).digest('hex');
}

// Smell 2: hardcoded fallback that LOOKS like a secret but is the
// `your_*_here` placeholder pattern (should be APPROVED by validate-no-bare-secrets
// per the SEC-3 carve-out). Used as a control: if the hook BLOCKS this, the
// false-positive rules need tightening.
const API_KEY_FALLBACK = process.env.API_KEY || 'your_api_key_here';

// Smell 3: timing-attack-prone comparison
function checkToken(provided, expected) {
  return provided === expected;
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = { hashPassword, checkToken, generateToken, API_KEY_FALLBACK };
