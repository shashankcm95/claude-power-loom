// identity/lifecycle-spawn.js — cmdAssign + cmdAssignChallenger + cmdAssignPair
// + cmdBreed (identity creation + spawn-counter mutators) extracted from
// agent-identity.js per HT.1.3 (5-module split + ADR-0002 bridge-script
// entrypoint criterion).
//
// Module characteristics:
//   - 4 cmd functions (cmdAssign, cmdAssignChallenger, cmdAssignPair, cmdBreed)
//     plus 2 supporting helpers (_readPersonaContract, _scanSkillGaps)
//   - All 4 cmds mutate identity records via ensureIdentity + spawn-counter
//     mutations and writeStore — true mutators (cmdStats relocated to registry
//     per HT.1.3-verify FLAG-1)
//   - Imports `readStore` + `writeStore` + `withLock` + `ensureIdentity` +
//     `_backfillSchema` from `./registry`
//   - Imports `tierOf` + `aggregateQualityFactors` + `computeWeightedTrustScore`
//     from `./trust-scoring` (cmdBreed parent-ranking)
//
// HT.1.3 pre-extraction fix applied (per HT.1.3-verify FLAG-B): inline
// `require('fs')` + `require('path')` removed from `_readPersonaContract`;
// fs + path are available from this module's top-level requires.

'use strict';

const fs = require('fs');
const path = require('path');
const {
  readStore,
  writeStore,
  withLock,
  ensureIdentity,
  _backfillSchema,
} = require('./registry');
const {
  tierOf,
  aggregateQualityFactors,
  computeWeightedTrustScore,
} = require('./trust-scoring');
// v2.8.0 — HETS-SynthId content-hash. computed at assign time + persisted
// to identity.synthid_history for drift detection across sessions.
const { computeContentHash, formatSynthId } = require('../../../kernel/_lib/synthid');

// v2.8.0 — read plugin version once at module load. Falls back to '0.0.0'
// if plugin.json is unreadable (e.g., dev-without-install); the SynthId
// system still works, just the version-component of the hash becomes
// stable-zero (which is acceptable for in-repo work).
function _readPluginVersion() {
  try {
    const { findToolkitRoot } = require('../../../kernel/_lib/toolkit-root');
    const fp = path.join(findToolkitRoot(), '.claude-plugin', 'plugin.json');
    const pkg = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}
const _PLUGIN_VERSION = _readPluginVersion();

// H.6.3 — scan persona contract at assign-time; surface not-yet-authored
// skills as forgeNeeded on the assign output.
function _readPersonaContract(persona) {
  // H.7.14 — second fallback now uses shared `findToolkitRoot()` helper.
  const { findToolkitRoot } = require('../../../kernel/_lib/toolkit-root');
  const contractsBase = process.env.HETS_CONTRACTS_DIR ||
    path.join(findToolkitRoot(), 'swarm', 'personas-contracts');
  const fp = path.join(contractsBase, `${persona}.contract.json`);
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
}

// v2.8.0.x — persona .md reader (post-pair-run MEDIUM-1 fix). The
// SynthId design (per synthid.js header) includes `agent_md_hash` in
// the content-hash input. Previously every callsite passed
// `agentMd: undefined`, leaving the .md hash branch dead. This helper
// loads `swarm/personas/<persona>.md` so persona behavior changes
// trigger drift detection. Returns null gracefully if file absent
// (the hash falls back to `agent_md_hash: null`, preserving existing
// SynthId values for personas without a .md file).
function _readPersonaMd(persona) {
  const { findToolkitRoot } = require('../../../kernel/_lib/toolkit-root');
  const personasBase = process.env.HETS_PERSONAS_DIR ||
    path.join(findToolkitRoot(), 'swarm', 'personas');
  const fp = path.join(personasBase, `${persona}.md`);
  try { return fs.readFileSync(fp, 'utf8'); } catch { return null; }
}

function _scanSkillGaps(contract) {
  if (!contract || !contract.skills) return { required: [], recommended: [] };
  const status = contract.skills.skill_status || {};
  const required = (contract.skills.required || []).map((s) => ({
    skill: s, status: status[s] || 'unknown',
  })).filter((s) => s.status === 'not-yet-authored');
  const recommended = (contract.skills.recommended || []).map((s) => ({
    skill: s, status: status[s] || 'unknown',
  })).filter((s) => s.status === 'not-yet-authored');
  return { required, recommended };
}

function cmdAssign(args) {
  if (!args.persona) {
    console.error('Usage: assign --persona <NN-name> [--task <tag>] [--require-forged]');
    process.exit(1);
  }
  let exitCode = 0;
  let output;
  withLock(() => {
    const store = readStore();
    if (!store.rosters[args.persona]) {
      console.error(`No roster for persona: ${args.persona}. Add one to DEFAULT_ROSTERS or store.rosters.`);
      process.exit(1);
    }
    const fullRoster = store.rosters[args.persona];
    // H.6.6 — filter out retired identities.
    const liveRoster = fullRoster.filter((n) => {
      const id = `${args.persona}.${n}`;
      const existing = store.identities[id];
      return !(existing && existing.retired);
    });
    if (liveRoster.length === 0) {
      console.error(`All identities for persona ${args.persona} are retired. Add new names to roster OR un-retire via 'unretire' subcommand.`);
      process.exit(1);
    }
    if (store.nextIndex[args.persona] === undefined) store.nextIndex[args.persona] = 0;

    // H.7.0 — specialization-aware pick.
    let name;
    let pickReason = 'round-robin';
    if (typeof args.task === 'string' && args.task.length > 0) {
      const scored = liveRoster.map((n) => {
        const id = `${args.persona}.${n}`;
        const existing = store.identities[id];
        const specs = (existing && Array.isArray(existing.specializations)) ? existing.specializations : [];
        let overlap = 0;
        for (const s of specs) {
          if (typeof s !== 'string') continue;
          if (s === args.task) overlap += 2;
          else if (args.task.includes(s) || s.includes(args.task)) overlap += 1;
        }
        return { name: n, overlap };
      });
      const maxOverlap = Math.max(0, ...scored.map((s) => s.overlap));
      if (maxOverlap > 0) {
        const best = scored.filter((s) => s.overlap === maxOverlap);
        const idx2 = store.nextIndex[args.persona] || 0;
        name = best[idx2 % best.length].name;
        pickReason = 'specialization-overlap';
      }
    }
    if (!name) {
      const idx = store.nextIndex[args.persona];
      name = liveRoster[idx % liveRoster.length];
    }
    {
      const idx = store.nextIndex[args.persona];
      store.nextIndex[args.persona] = (idx + 1) % liveRoster.length;
    }

    const identity = _backfillSchema(ensureIdentity(store, args.persona, name));
    identity.lastSpawnedAt = new Date().toISOString();
    identity.totalSpawns += 1;
    identity.assignedCount += 1; // v2.8.4 FIX-B — split counter

    // H.6.3 — scan contract for skill gaps.
    const contract = _readPersonaContract(args.persona);
    const skillGaps = _scanSkillGaps(contract);
    const forgeNeeded = {
      required: skillGaps.required,
      recommended: skillGaps.recommended,
    };
    const blocking = forgeNeeded.required.length > 0;

    // v2.8.0 — compute content-hash SynthId. Drift detection: if the new
    // hash differs from the head of synthid_history, append a new entry.
    // First-spawn-post-upgrade backfills the history naturally.
    let synthIdSuffix = null;
    let synthDrift = false;
    if (contract) {
      try {
        // v2.8.0.x — agentMd now wired through (post-pair-run MEDIUM-1).
        // Persona .md changes now trigger drift detection alongside
        // contract changes.
        const agentMd = _readPersonaMd(args.persona);
        const hash = computeContentHash({
          persona: args.persona,
          contract,
          agentMd,
          pluginVersion: _PLUGIN_VERSION,
        });
        synthIdSuffix = hash;
        const last = identity.synthid_history && identity.synthid_history.length > 0
          ? identity.synthid_history[identity.synthid_history.length - 1]
          : null;
        if (!last || last.hash !== hash) {
          identity.synthid_history.push({
            hash,
            observedAt: identity.lastSpawnedAt,
            note: last ? 'persona-contract-drift' : 'first-observed',
          });
          synthDrift = !!last; // first-observed is NOT a drift
          // v2.8.0.x — set pending-drift flag so the next
          // recommend-verification call forces full-verify (priority 2.5).
          // Cleared by verdict-recording.js on FULL_EQUIVALENT_DEPTHS.
          if (synthDrift) {
            identity.pendingSynthIdDrift = true;
          }
        }
      } catch (err) {
        // Hash computation failures are non-fatal — identity assignment
        // proceeds without SynthId suffix. Logged for observability.
        process.stderr.write(`[lifecycle-spawn] synthid skipped: ${err.message}\n`);
      }
    }

    writeStore(store);

    const fullId = `${args.persona}.${name}`;
    const synthId = synthIdSuffix
      ? formatSynthId({ persona: args.persona, name, contentHash: synthIdSuffix })
      : fullId;
    output = {
      action: 'assign',
      persona: args.persona,
      name,
      identity: fullId,
      synthid: synthId,
      synthid_drift: synthDrift,
      tier: tierOf(identity),
      totalSpawns: identity.totalSpawns,
      task: args.task || null,
      pickReason,
      forgeNeeded,
    };
    if (blocking) {
      output.warning = `${forgeNeeded.required.length} required skill(s) marked not-yet-authored: ${forgeNeeded.required.map((s) => s.skill).join(', ')}. Forge before spawning OR proceed with KB+contract only.`;
      if (args['require-forged']) {
        output.error = 'assign blocked: --require-forged + missing required skill(s)';
        exitCode = 2;
      }
    }
  });
  console.log(JSON.stringify(output, null, 2));
  if (exitCode) process.exit(exitCode);
}

function cmdAssignChallenger(args) {
  // H.2.3 — asymmetric challenger pattern.
  if (!args['exclude-persona'] && !args['exclude-identity']) {
    console.error('Usage: assign-challenger --exclude-persona <NN-name> [--exclude-identity <persona.name>] [--task <tag>]');
    process.exit(1);
  }
  withLock(() => {
    const store = readStore();
    const excludePersona = args['exclude-persona'];
    const excludeIdentity = args['exclude-identity'];

    const candidates = [];
    for (const [persona, names] of Object.entries(store.rosters)) {
      for (const name of names) {
        const id = `${persona}.${name}`;
        if (id === excludeIdentity) continue;
        candidates.push({
          persona, name, id,
          differentPersona: persona !== excludePersona,
        });
      }
    }
    if (candidates.length === 0) {
      console.error('No challenger candidates available (all identities excluded).');
      process.exit(1);
    }

    const differentPersonaPool = candidates.filter((c) => c.differentPersona);
    const pool = differentPersonaPool.length > 0 ? differentPersonaPool : candidates;
    const poolType = differentPersonaPool.length > 0 ? 'different-persona' : 'same-persona-different-identity';

    if (!store.nextChallengerIndex) store.nextChallengerIndex = {};
    const key = excludePersona || '_default_';
    if (store.nextChallengerIndex[key] === undefined) store.nextChallengerIndex[key] = 0;
    const idx = store.nextChallengerIndex[key];
    const pick = pool[idx % pool.length];
    store.nextChallengerIndex[key] = (idx + 1) % pool.length;

    const identity = _backfillSchema(ensureIdentity(store, pick.persona, pick.name));
    identity.lastSpawnedAt = new Date().toISOString();
    identity.totalSpawns += 1;
    identity.assignedCount += 1; // v2.8.4 FIX-B — split counter

    writeStore(store);

    console.log(JSON.stringify({
      action: 'assign-challenger',
      challenger: { persona: pick.persona, name: pick.name, identity: pick.id, tier: tierOf(identity) },
      excludedPersona: excludePersona || null,
      excludedIdentity: excludeIdentity || null,
      poolType,
      task: args.task || null,
    }, null, 2));
  });
}

// H.7.1 — assign-pair subcommand.
function cmdAssignPair(args) {
  if (!args.persona) {
    console.error('Usage: assign-pair --persona <NN-name> [--count N] [--task <tag>]');
    process.exit(1);
  }
  const count = parseInt(args.count || '2', 10);
  if (!Number.isFinite(count) || count < 2) {
    console.error(`Invalid --count: ${args.count}. Must be >= 2. For count=1, use assign-challenger.`);
    process.exit(1);
  }

  const pair = [];
  let poolType = null;
  const exclusions = [];

  withLock(() => {
    const store = readStore();
    const excludePersona = args.persona;

    const candidates = [];
    for (const [persona, names] of Object.entries(store.rosters)) {
      for (const name of names) {
        const id = `${persona}.${name}`;
        const existing = store.identities[id];
        if (existing && existing.retired) continue;
        candidates.push({
          persona, name, id,
          differentPersona: persona !== excludePersona,
        });
      }
    }
    if (candidates.length < count) {
      console.error(`Not enough candidates: requested ${count}, available ${candidates.length} (after retiring filter). Add roster entries OR reduce --count.`);
      process.exit(1);
    }

    for (let i = 0; i < count; i++) {
      const remainingPool = candidates.filter((c) => !exclusions.includes(c.id));
      if (remainingPool.length === 0) {
        console.error(`Roster exhausted after ${pair.length} picks; need ${count}. Add new identities to roster ${excludePersona}.`);
        process.exit(1);
      }
      const differentPersonaPool = remainingPool.filter((c) => c.differentPersona);
      const pool = differentPersonaPool.length > 0 ? differentPersonaPool : remainingPool;
      const thisIterationPoolType = differentPersonaPool.length > 0
        ? 'different-persona'
        : 'same-persona-different-identity';

      if (poolType === null) poolType = thisIterationPoolType;
      else if (poolType !== thisIterationPoolType) poolType = 'mixed';

      if (!store.nextChallengerIndex) store.nextChallengerIndex = {};
      const key = excludePersona;
      if (store.nextChallengerIndex[key] === undefined) store.nextChallengerIndex[key] = 0;
      const idx = store.nextChallengerIndex[key];
      const pick = pool[idx % pool.length];
      store.nextChallengerIndex[key] = (idx + 1) % pool.length;

      const identity = _backfillSchema(ensureIdentity(store, pick.persona, pick.name));
      identity.lastSpawnedAt = new Date().toISOString();
      identity.totalSpawns += 1;
      identity.assignedCount += 1; // v2.8.4 FIX-B — split counter

      pair.push(pick.id);
      exclusions.push(pick.id);
    }

    writeStore(store);
  });

  console.log(JSON.stringify({
    action: 'assign-pair',
    pair,
    poolType,
    count: pair.length,
    excludedPersona: args.persona,
    task: args.task || null,
  }, null, 2));
}

// H.7.0 — agent-identity breed subcommand.
function cmdBreed(args) {
  if (!args.persona) {
    console.error('Usage: breed --persona <NN-name> [--parent <id>] [--name <kid>] [--auto]');
    process.exit(1);
  }
  let exitCode = 0;
  let output;
  withLock(() => {
    const store = readStore();
    if (!store.rosters[args.persona]) {
      console.error(`No roster for persona: ${args.persona}. Add one to DEFAULT_ROSTERS or store.rosters.`);
      process.exit(1);
    }
    for (const id of Object.keys(store.identities)) {
      _backfillSchema(store.identities[id]);
    }

    const liveOfPersona = Object.values(store.identities).filter(
      (i) => i.persona === args.persona && !i.retired
    );

    // (3) Diversity-guard
    const gen0Live = liveOfPersona.filter((i) => (i.generation || 0) === 0);
    if (gen0Live.length <= 1) {
      output = {
        action: 'breed',
        applied: false,
        error: `diversity-guard: only ${gen0Live.length} generation-0 live identity for ${args.persona}; refusing to breed (would leave 0 generalists).`,
        suggestions: [
          `Add a new generation-0 name to DEFAULT_ROSTERS['${args.persona}']`,
          `Un-retire a previously-retired generation-0 identity via 'unretire --identity ${args.persona}.<name>'`,
        ],
      };
      exitCode = 1;
      return;
    }

    // (4) Population-cap
    const rosterSize = store.rosters[args.persona].length;
    if (liveOfPersona.length >= rosterSize) {
      output = {
        action: 'breed',
        applied: false,
        error: `population-cap: ${args.persona} at ${liveOfPersona.length}/${rosterSize} live identities; no slot available.`,
        suggestions: [
          `Retire an underperforming identity first (run 'prune --auto')`,
          `Extend the roster: add a name to DEFAULT_ROSTERS['${args.persona}']`,
        ],
      };
      exitCode = 1;
      return;
    }

    // (5) Pick parent
    let parent;
    if (args.parent) {
      parent = store.identities[args.parent];
      if (!parent || parent.persona !== args.persona || parent.retired) {
        output = {
          action: 'breed',
          applied: false,
          error: `--parent ${args.parent} invalid: must be a live identity belonging to persona ${args.persona}.`,
        };
        exitCode = 1;
        return;
      }
    } else {
      const ranked = liveOfPersona.map((i) => {
        const total = (i.verdicts.pass || 0) + (i.verdicts.partial || 0) + (i.verdicts.fail || 0);
        const pr = total === 0 ? 0 : (i.verdicts.pass || 0) / total;
        const aggregateQF = aggregateQualityFactors(i.quality_factors_history);
        const wts = computeWeightedTrustScore(i, aggregateQF);
        return {
          identity: i,
          score: wts ? wts.score : pr,
          passRate: pr,
        };
      });
      ranked.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.passRate !== a.passRate) return b.passRate - a.passRate;
        return (a.identity.createdAt || '').localeCompare(b.identity.createdAt || '');
      });
      parent = ranked[0].identity;
    }

    // (6) Pick kid name
    let kidName = args.name;
    if (!kidName) {
      const usedNames = new Set(
        Object.values(store.identities)
          .filter((i) => i.persona === args.persona)
          .map((i) => i.name)
      );
      const free = store.rosters[args.persona].filter((n) => !usedNames.has(n));
      if (free.length === 0) {
        output = {
          action: 'breed',
          applied: false,
          error: `no free roster name for ${args.persona}; all roster names already in use (live or retired).`,
          suggestions: [
            `Pass --name <new-name> to introduce a name outside the roster`,
            `Extend the roster: add a name to DEFAULT_ROSTERS['${args.persona}']`,
          ],
        };
        exitCode = 1;
        return;
      }
      kidName = free[0];
    }
    const kidId = `${args.persona}.${kidName}`;
    if (store.identities[kidId]) {
      output = {
        action: 'breed',
        applied: false,
        error: `kid identity ${kidId} already exists; pass --name <fresh-name> or retire the existing first.`,
      };
      exitCode = 1;
      return;
    }

    // (7) User-gate
    if (!store.breedFirstPromptedFor) store.breedFirstPromptedFor = {};
    const firstBreedForPersona = !store.breedFirstPromptedFor[args.persona];
    if (firstBreedForPersona && !args.auto) {
      store.breedFirstPromptedFor[args.persona] = true;
      writeStore(store);
      output = {
        action: 'breed',
        applied: false,
        requires_confirmation: true,
        message: `First breed for persona ${args.persona}. Re-invoke with --auto to confirm or pass --auto on this call to bypass.`,
        plannedKid: kidId,
        plannedParent: `${parent.persona}.${parent.name}`,
        plannedGeneration: (parent.generation || 0) + 1,
        plannedTraitsInherited: parent.traits ? { ...parent.traits } : {},
      };
      return;
    }

    // (8) Create kid
    const parentId = `${parent.persona}.${parent.name}`;
    const traitsInherited = parent.traits ? { ...parent.traits } : { skillFocus: null, kbFocus: [], taskDomain: null };
    if (Array.isArray(traitsInherited.kbFocus)) {
      traitsInherited.kbFocus = [...traitsInherited.kbFocus];
    }
    const newGeneration = (parent.generation || 0) + 1;
    store.identities[kidId] = {
      persona: args.persona,
      name: kidName,
      createdAt: new Date().toISOString(),
      lastSpawnedAt: null,
      totalSpawns: 0,
      verdicts: { pass: 0, partial: 0, fail: 0 },
      specializations: [],
      skillInvocations: {},
      retired: false,
      retiredAt: null,
      retiredReason: null,
      parent: parentId,
      generation: newGeneration,
      traits: traitsInherited,
      quality_factors_history: [],
      spawnsSinceFullVerify: 0,
      lastFullVerifyAt: null,
    };
    writeStore(store);

    // (9) Output
    output = {
      action: 'breed',
      applied: true,
      kid: kidId,
      parent: parentId,
      generation: newGeneration,
      traits_inherited: traitsInherited,
    };
    process.stderr.write(`bred: ${parentId} -> ${kidId} (gen ${newGeneration}; traits: ${JSON.stringify(traitsInherited)})\n`);
  });
  console.log(JSON.stringify(output, null, 2));
  if (exitCode) process.exit(exitCode);
}

module.exports = {
  // Helpers
  _readPersonaContract,
  _readPersonaMd,
  _scanSkillGaps,
  // Subcommand handlers
  cmdAssign,
  cmdAssignChallenger,
  cmdAssignPair,
  cmdBreed,
};
