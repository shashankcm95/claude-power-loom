#!/usr/bin/env node
/**
 * refresh-skill-status.js — v2.8.4 FIX-C
 *
 * Refreshes the `skill_status` map inside each persona contract by reading
 * the actual on-disk skill inventory. Flips `not-yet-authored` → `available`
 * for skills that now have a `SKILL.md`; leaves marketplace and truly-absent
 * skills untouched.
 *
 * Drift motivation (v2.8.3-run1 DRIFT-003):
 *   forgeNeeded:true returns stale + misleading because contracts still
 *   mark plan/review/typescript/etc. as not-yet-authored after they were
 *   authored / forged.
 *
 * Usage:
 *   node scripts/refresh-skill-status.js          # apply
 *   node scripts/refresh-skill-status.js --check  # dry-run (exit 1 if drift)
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
// v4 (ADR-0008) workspace layout — the pre-Phase-0 flat dirs (swarm/personas-contracts,
// skills/, commands/) were moved under packages/* and this script crashed on the dead paths.
const CONTRACTS_DIR = path.join(REPO_ROOT, 'packages', 'runtime', 'contracts');
const SKILLS_DIR = path.join(REPO_ROOT, 'packages', 'skills', 'library');
const COMMANDS_DIR = path.join(REPO_ROOT, 'packages', 'skills', 'commands');

function listAuthoredSkills() {
  const authored = new Set();
  // (a) SKILL.md inside skills/<name>/
  if (fs.existsSync(SKILLS_DIR)) {
    for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillMd = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
      if (fs.existsSync(skillMd)) {
        authored.add(entry.name);
      }
    }
  }
  // (b) Slash commands inside commands/<name>.md — also count as "skills"
  //     from a persona contract's perspective (architect calls `plan`, etc.)
  if (fs.existsSync(COMMANDS_DIR)) {
    for (const entry of fs.readdirSync(COMMANDS_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      authored.add(entry.name.replace(/\.md$/, ''));
    }
  }
  return authored;
}

function refreshContract(contractPath, authored, isCheck) {
  // Read raw text for formatting preservation; parse only to discover changes.
  const raw = fs.readFileSync(contractPath, 'utf8');
  const contract = JSON.parse(raw);
  const status = contract?.skills?.skill_status;
  if (!status || typeof status !== 'object') {
    return { path: contractPath, changes: [] };
  }
  const changes = [];
  let newRaw = raw;
  for (const [skill, currentStatus] of Object.entries(status)) {
    if (currentStatus === 'not-yet-authored' && authored.has(skill)) {
      changes.push({ skill, from: currentStatus, to: 'available' });
      if (!isCheck) {
        // Targeted text replacement preserves the file's original formatting
        // (avoids JSON.stringify reformatting inline arrays into multi-line).
        // Pattern matches the exact "skill": "not-yet-authored" entry; the
        // skill name is JSON-escaped (handled by JSON.stringify on the key).
        const skillEscaped = JSON.stringify(skill); // includes surrounding quotes
        const findRe = new RegExp(
          skillEscaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          + '\\s*:\\s*"not-yet-authored"'
        );
        newRaw = newRaw.replace(findRe, skillEscaped + ': "available"');
      }
    }
  }
  if (changes.length > 0 && !isCheck && newRaw !== raw) {
    fs.writeFileSync(contractPath, newRaw);
  }
  return { path: contractPath, changes };
}

function main() {
  const isCheck = process.argv.includes('--check');
  const authored = listAuthoredSkills();
  if (!fs.existsSync(CONTRACTS_DIR)) {
    console.error(`refresh-skill-status: contracts dir not found: ${CONTRACTS_DIR}`);
    process.exit(isCheck ? 0 : 1);
  }
  const contracts = fs.readdirSync(CONTRACTS_DIR)
    .filter((f) => f.endsWith('.contract.json'))
    .map((f) => path.join(CONTRACTS_DIR, f));

  let totalChanges = 0;
  const report = [];

  for (const contractPath of contracts) {
    const { changes } = refreshContract(contractPath, authored, isCheck);
    if (changes.length > 0) {
      totalChanges += changes.length;
      const name = path.basename(contractPath, '.contract.json');
      report.push(`${name}: ${changes.map((c) => `${c.skill} (${c.from} → ${c.to})`).join(', ')}`);
    }
  }

  if (totalChanges === 0) {
    process.stdout.write(`refresh-skill-status: clean — no drift detected (${authored.size} skills checked)\n`);
    process.exit(0);
  }

  process.stdout.write(`refresh-skill-status: ${isCheck ? 'DRIFT DETECTED' : 'applied'} — ${totalChanges} flip(s) across ${report.length} contract(s):\n`);
  for (const line of report) {
    process.stdout.write(`  ${line}\n`);
  }
  process.exit(isCheck ? 1 : 0);
}

main();
