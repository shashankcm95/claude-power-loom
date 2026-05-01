#!/usr/bin/env node

// Stop hook: counts assistant responses (Stop events) per session.
// After NUDGE_THRESHOLD responses, appends a one-line suggestion to the
// next response: "consider running /self-improve to capture patterns
// from this session". Then resets the counter so the nudge fires once
// per session, not on every subsequent response.
//
// This closes the self-improvement loop's session-end-review gap:
// previously the rule said "surface at session-end" but no trigger
// existed, so the loop never fired.
//
// Configuration:
//   CLAUDE_SESSION_NUDGE_THRESHOLD=10  default = 10 responses

const fs = require('fs');
const path = require('path');
const os = require('os');
const { log: makeLogger } = require('./_log.js');
const log = makeLogger('session-end-nudge');

const NUDGE_THRESHOLD = parseInt(process.env.CLAUDE_SESSION_NUDGE_THRESHOLD || '10', 10);
const SESSION_ID = process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_CONVERSATION_ID || String(process.ppid || 'default');
const STATE_DIR = path.join(os.homedir(), '.claude', 'sessions');
const STATE_FILE = path.join(STATE_DIR, `nudge-${SESSION_ID}.json`);

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { count: 0, nudged: false, sessionStart: Date.now() };
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const tmp = STATE_FILE + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) {
    log('state_save_failed', { error: err.message });
  }
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const state = loadState();
  state.count = (state.count || 0) + 1;

  // Once per session: when threshold is hit AND we haven't nudged yet
  if (state.count >= NUDGE_THRESHOLD && !state.nudged) {
    state.nudged = true;
    saveState(state);
    log('nudged', { count: state.count, threshold: NUDGE_THRESHOLD });
    const nudge = `\n\n---\n💡 Session has been productive (${state.count} responses). Consider running \`/self-improve\` to capture recurring patterns from this session into permanent rules.`;
    process.stdout.write(input + nudge);
    return;
  }

  saveState(state);
  log('counted', { count: state.count, nudged: state.nudged });
  process.stdout.write(input);
});
