'use strict';

// packages/kernel/_lib/env-int.js
//
// Canonical whole-digit env-int reader. Extracted 2026-07-08 (was duplicated: an
// unclamped copy in ghost-heartbeat-stop.js + a clamped copy `envIntClamped` in
// ghost-heartbeat-run.js — the DRY 3rd-copy the ghost-judge fix would have added).
//
// Rejects '', 'garbage', '0x10', '-1', '1e9' -> the default. A whole-string /^\d+$/
// guard (NOT bare parseInt, which SILENTLY truncates those footguns: '0x10'->0 can
// disable a throttle, '1e9'->1, '-1'-> a negative). An optional [min, max] clamp so a
// huge value cannot remove a cap and a tiny one cannot zero it (use a killswitch to
// disable, not a 0 cap).

function envInt(name, def, { min, max } = {}) {
  const s = (process.env[name] || '').trim();
  if (!/^\d+$/.test(s)) return def;
  let n = parseInt(s, 10);
  if (typeof min === 'number') n = Math.max(min, n);
  if (typeof max === 'number') n = Math.min(max, n);
  return n;
}

module.exports = { envInt };
