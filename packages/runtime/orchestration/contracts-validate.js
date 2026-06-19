#!/usr/bin/env node

// Contracts validator — cross-checks the 4 sources of truth that drift
// independently in the HETS toolkit:
//   (1) per-pattern frontmatter `status:` field
//   (2) skills/agent-team/patterns/README.md catalog table
//   (3) skills/agent-team/SKILL.md catalog table
//   (4) per-contract skill_status entries vs filesystem (local skills + marketplace)
//
// Plus integrity checks the architect persona kept flagging:
//   - skill_status keys ⊇ required + recommended skill names (no orphans either way)
//   - kb_scope refs resolve via kb-resolver manifest
//   - status values are in the allowed enum
//   - pattern Related links are bidirectional
//
// Closes the architect's #1 top-leverage change from chaos-20260502-060039
// (still unshipped after CS-1 confirmed +9-sub-phases of drift).
//
// Usage:
//   node contracts-validate.js                  — run all validators, exit 1 on any violation
//   node contracts-validate.js --json           — machine-readable output
//   node contracts-validate.js --scope X,Y,Z    — only run named validators
//   node contracts-validate.js --list-validators

const fs = require('fs');
const path = require('path');

// H.7.14 — `findToolkitRoot()` extracted to `_lib/toolkit-root.js` (was
// inline here as of H.7.10). The helper now serves the broader substrate
// family (kb-resolver, budget-tracker, pattern-runner, agent-identity,
// _lib/runState) instead of being duplicated. Same priority chain:
// env var → cwd → walk-up → hardcoded LAST.
const { findToolkitRoot } = require('../../kernel/_lib/toolkit-root');
// HT.1.2 — `parseFrontmatter` consolidated to canonical helper (was 1 of 4
// inline copies post-H.8.7 chaos-H4 extraction; the inline version here
// returned `{ fm: {}, body: text }` (note `fm` field name) while canonical
// returns `{ frontmatter, body }`. Caller destructuring updated via rename
// `const { frontmatter: fm } = ...` to keep downstream `fm` usages stable.
// HT.0.9-verify code-reviewer enumerated the 4 sites.
const { parseFrontmatter } = require('../../kernel/_lib/frontmatter');
// v3.2 Wave 0 (K11) — the A4-binding gate's pure audit fn lives in the kernel;
// this runtime validator is a thin adapter over it (runtime→kernel = legal).
const { auditAlgorithmLibrary } = require('../../kernel/_lib/kernel-algorithms-audit');
// v3.2 Wave 1 (R8) — the FROZEN decomposition-discipline vocabulary + the pure
// per-block check; `decomposition-discipline-valid` is a thin adapter over it.
const { DECOMPOSITION_DISCIPLINES, disciplineBlockViolations } = require('./_lib/decomposition-disciplines');

const TOOLKIT = findToolkitRoot();
// Phase 0: paths anticipate Step 6 (contracts) + Step 8 (skills) target locations.
const PATTERNS_DIR = path.join(TOOLKIT, 'packages', 'skills', 'library', 'agent-team', 'patterns');
const CONTRACTS_DIR = path.join(TOOLKIT, 'packages', 'runtime', 'contracts');
// Persona role-briefs — the AUTHORITATIVE source for an archetype's named
// instincts. The `persona-instinct-reconcile` validator (below) binds each
// numbered contract's interface.instincts[] back to the numbered `## Mindset`
// headings here (NN-name.contract.json <-> NN-name.md, 1:1).
const PERSONAS_DIR = path.join(TOOLKIT, 'packages', 'runtime', 'personas');
// Slug computation extracted to _lib (SRP — distinct concern from validation,
// shared by the contract-population step + slug unit tests). The validator +
// every consumer derive instinct slugs HERE so they agree exactly; never
// re-implement the normalization.
const { mindsetInstinctSlugs, duplicateSlugs } = require('./_lib/instinct-slug');
// v3.1 PR-1: capability-trait registry (CONTRACTS_DIR sibling). Consumed by
// the two-tier-contract validators (traits-resolve-clean et al.) added below.
// The trait-resolve primitive itself ships in packages/runtime/contracts/_lib/.
const TRAITS_REGISTRY = path.join(CONTRACTS_DIR, 'traits', '_registry.json');
const { resolveTraits } = require('../contracts/_lib/trait-resolve');
// v3.1 PR-2a: agents/<name>.md is the AUTHORITATIVE capability source (per the
// traits registry _doc). The reconciliation validator below binds each numbered
// contract's traits back to its agent.md `tools:` frontmatter floor.
const AGENTS_DIR = path.join(TOOLKIT, 'agents');
const SKILL_MD = path.join(TOOLKIT, 'packages', 'skills', 'library', 'agent-team', 'SKILL.md');
const PATTERNS_README = path.join(PATTERNS_DIR, 'README.md');
const KB_MANIFEST = path.join(TOOLKIT, 'packages', 'skills', 'library', 'agent-team', 'kb', 'manifest.json');
// H.9.12 Component C + D: kb/architecture/ root for cap-check + bidirectional
// `related:` validator. Mirror of `packages/skills/library/agent-team/kb/architecture/` layout
// validated by validate-kb-doc.js (PreToolUse path scope).
const KB_ARCHITECTURE_BASE = path.join(TOOLKIT, 'packages', 'skills', 'library', 'agent-team', 'kb', 'architecture');
// H.9.12 Component C: KB size cap thresholds per _PRINCIPLES.md L36
// "If we hit 50, audit before adding 51". WARN at 90% capacity; ERROR at L36 cap.
const KB_ARCHITECTURE_CAP_WARN = 45;
const KB_ARCHITECTURE_CAP_ERROR = 51;
// Phase 0: skills + commands moved into the skills package; hooks.json moved into kernel package.
const SKILLS_BASE = path.join(TOOLKIT, 'packages', 'skills', 'library');
// v2.8.4 FIX-C support: contracts may reference slash-command skills
// (plan, review, prune, security-audit, etc.) which live in commands/<name>.md
// — not skills/<name>/SKILL.md. Both paths count as "available" for contract
// purposes (the persona can invoke them via the Skill tool either way).
const COMMANDS_BASE = path.join(TOOLKIT, 'packages', 'skills', 'commands');
const MARKETPLACE_BASE = path.join(process.env.HOME, '.claude', 'plugins', 'marketplaces');
const HOOKS_JSON = path.join(TOOLKIT, 'packages', 'kernel', 'hooks.json');
// HT.2.4 (drift-note 68): removed dead SETTINGS_READER constant that anticipated
// a substrate-internal consumer never wired up — the contract-plugin-hook-deployment
// validator that did ship (test 36 in install.sh) uses its own settings.json
// read path, not settings-reader.js's exports.

// H.7.1 — `active+enforced` is the same as `active` but additionally indicates
// the pattern has a wired callsite (data flows through it). Added to close the
// "substrate-rich, call-site-poor" architect finding (CS-1/CS-2/CS-3).
const VALID_STATUSES = new Set(['proposed', 'implementing', 'observed', 'active', 'active+enforced', 'deprecated']);
const VALID_SKILL_STATUSES_LITERAL = new Set(['available', 'not-yet-authored']);

// ---------- helpers ----------

function listPatternFiles() {
  if (!fs.existsSync(PATTERNS_DIR)) return [];
  return fs.readdirSync(PATTERNS_DIR)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => ({ name: f.replace(/\.md$/, ''), path: path.join(PATTERNS_DIR, f) }));
}

function listContractFiles() {
  if (!fs.existsSync(CONTRACTS_DIR)) return [];
  return fs.readdirSync(CONTRACTS_DIR)
    .filter((f) => f.endsWith('.contract.json'))
    .map((f) => ({ name: f.replace(/\.contract\.json$/, ''), path: path.join(CONTRACTS_DIR, f) }));
}

// H.9.12 Component C + D: walk kb/architecture/<subdir>/*.md tree. Returns
// entries with `kbId` derived from path (architecture/<subdir>/<basename>)
// to match the value format used in `related:` arrays (gate code-reviewer
// HIGH-CR1 absorption — key-name normalization required else validator
// silently no-ops on all cross-references).
function listKbArchitectureFiles() {
  if (!fs.existsSync(KB_ARCHITECTURE_BASE)) return [];
  const entries = [];
  for (const sub of fs.readdirSync(KB_ARCHITECTURE_BASE)) {
    const dir = path.join(KB_ARCHITECTURE_BASE, sub);
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
    } catch { continue; }
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const basename = f.replace(/\.md$/, '');
      entries.push({
        kbId: `architecture/${sub}/${basename}`,
        path: path.join(dir, f),
      });
    }
  }
  return entries;
}

function loadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

// Parse a markdown table column matching `[Pattern Name](path)` and a status column.
// Returns Map(patternName → status string) where patternName is extracted from link target basename.
function parseStatusTable(markdown) {
  const result = new Map();
  // Match table rows: | ... | [Title](file.md) | status text |
  const rowRe = /\|\s*[^|]*\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*([^|]+?)\s*\|/g;
  let m;
  while ((m = rowRe.exec(markdown)) !== null) {
    const linkTarget = m[2];
    // Extract pattern file basename without extension; skip if it's not a .md file in patterns/
    const base = path.basename(linkTarget).replace(/\.md$/, '').replace(/\?.*$/, '');
    // Status text may have parenthetical phase notes like "implementing (H.2.5)"
    const statusRaw = m[3].trim();
    // H.7.1 — match `active+enforced` BEFORE bare `active` so the longer form wins.
    const statusMatch = statusRaw.match(/^(active\+enforced|proposed|implementing|observed|active|deprecated)\b/i);
    if (statusMatch && base) {
      result.set(base, statusMatch[1].toLowerCase());
    }
  }
  return result;
}

// ---------- validators ----------

const validators = {};

validators['pattern-status-frontmatter'] = function () {
  const violations = [];
  for (const { name, path: fp } of listPatternFiles()) {
    const text = fs.readFileSync(fp, 'utf8');
    const { frontmatter: fm } = parseFrontmatter(text);
    if (!fm.status) {
      violations.push({ kind: 'missing-status', file: fp, pattern: name });
      continue;
    }
    if (!VALID_STATUSES.has(fm.status)) {
      violations.push({
        kind: 'invalid-status',
        file: fp,
        pattern: name,
        actual: fm.status,
        expected: Array.from(VALID_STATUSES),
      });
    }
  }
  return violations;
};

validators['pattern-status-readme-consistency'] = function () {
  const violations = [];
  if (!fs.existsSync(PATTERNS_README)) {
    return [{ kind: 'missing-readme', file: PATTERNS_README }];
  }
  const readmeStatuses = parseStatusTable(fs.readFileSync(PATTERNS_README, 'utf8'));
  for (const { name, path: fp } of listPatternFiles()) {
    const { frontmatter: fm } = parseFrontmatter(fs.readFileSync(fp, 'utf8'));
    if (!fm.status) continue;
    const readmeStatus = readmeStatuses.get(name);
    if (readmeStatus === undefined) {
      violations.push({
        kind: 'missing-from-readme',
        pattern: name,
        frontmatterStatus: fm.status,
        readmeStatus: null,
      });
      continue;
    }
    if (readmeStatus !== fm.status) {
      violations.push({
        kind: 'status-drift',
        pattern: name,
        frontmatterStatus: fm.status,
        readmeStatus,
      });
    }
  }
  return violations;
};

validators['pattern-status-skill-md-consistency'] = function () {
  const violations = [];
  if (!fs.existsSync(SKILL_MD)) {
    return [{ kind: 'missing-skill-md', file: SKILL_MD }];
  }
  const skillStatuses = parseStatusTable(fs.readFileSync(SKILL_MD, 'utf8'));
  for (const { name, path: fp } of listPatternFiles()) {
    const { frontmatter: fm } = parseFrontmatter(fs.readFileSync(fp, 'utf8'));
    if (!fm.status) continue;
    const skillStatus = skillStatuses.get(name);
    if (skillStatus === undefined) {
      // Not in SKILL.md table — silent (the catalog may be selective)
      continue;
    }
    if (skillStatus !== fm.status) {
      violations.push({
        kind: 'status-drift',
        pattern: name,
        frontmatterStatus: fm.status,
        skillMdStatus: skillStatus,
      });
    }
  }
  return violations;
};

validators['pattern-related-bidirectional'] = function () {
  const violations = [];
  const relatedMap = new Map();
  for (const { name, path: fp } of listPatternFiles()) {
    const { frontmatter: fm } = parseFrontmatter(fs.readFileSync(fp, 'utf8'));
    const related = Array.isArray(fm.related) ? fm.related : (fm.related ? [fm.related] : []);
    relatedMap.set(name, new Set(related));
  }
  for (const [name, related] of relatedMap.entries()) {
    for (const target of related) {
      // Skip cross-skill references (e.g., "hets" points outside patterns/)
      if (!relatedMap.has(target)) continue;
      const reverse = relatedMap.get(target);
      if (!reverse.has(name)) {
        violations.push({
          kind: 'asymmetric-related-link',
          from: name,
          to: target,
          fix: `Add "${name}" to ${target}.md frontmatter "related" array`,
        });
      }
    }
  }
  return violations;
};

// H.9.12 Component C: KB architecture doc count cap per _PRINCIPLES.md L36
// "If we hit 50, audit before adding 51". HARD-error at N≥51 (counts toward
// totalViolations + non-zero exit); WARN at N≥45 (90% capacity; stderr only).
// Validator-per-concern convention (separate from kb-architecture-related-
// bidirectional per architect HIGH-3 + code-reviewer HIGH-CR1 absorption).
validators['kb-architecture-doc-count'] = function () {
  const violations = [];
  const entries = listKbArchitectureFiles();
  const count = entries.length;
  if (count >= KB_ARCHITECTURE_CAP_ERROR) {
    violations.push({
      kind: 'kb-architecture-doc-count-exceeded',
      count,
      cap: KB_ARCHITECTURE_CAP_ERROR,
      fix: `kb/architecture/ contains ${count} docs; per _PRINCIPLES.md L36 audit before exceeding 50. Either consolidate existing docs or document the cap increase in a new _PRINCIPLES.md decision.`,
    });
  } else if (count >= KB_ARCHITECTURE_CAP_WARN) {
    // Warn-mode: stderr only; does NOT contribute to totalViolations.
    process.stderr.write(`  ⚠ kb-architecture-doc-count: ${count}/${KB_ARCHITECTURE_CAP_ERROR} docs (≥${KB_ARCHITECTURE_CAP_WARN} warn threshold reached; cap audit per _PRINCIPLES.md L36)\n`);
  }
  return violations;
};

// H.9.12/13/14 Component D: bidirectional `related:` validation in
// kb/architecture/ tree. History:
//   - H.9.12: Introduced in WARN-ONLY mode (asymmetric links surfaced via
//     stderr without incrementing totalViolations; preserved 17-baseline
//     monotonic-non-decreasing invariant; drift-note 82 captured 23-link
//     cohort for H.9.13 mass-fix).
//   - H.9.13: Mass-fix closed cohort (23 asymmetric → 0 via reciprocal
//     back-link insertions across 9 destination docs).
//   - H.9.14: FLIP to HARD-violation mode (this revision). Baseline=0
//     means flip adds 0 new violations at current state; provides
//     regression protection against re-introduction. Completes the
//     warn-only-then-fix-then-flip pattern codified at H.9.13 close.
//
// Key-name normalization (H.9.12 gate code-reviewer HIGH-CR1 LIVE BUG
// absorption): listKbArchitectureFiles() returns `kbId:
// architecture/<subdir>/<basename>` matching the `related:` value format
// used in kb/architecture frontmatter. Without this, the
// `if (!relatedMap.has(target)) continue` guard would silently skip
// every cross-reference, making the validator a no-op.
//
// Separate function from pattern-related-bidirectional (H.9.12 architect
// HIGH-3 absorption — validator-per-concern convention per
// kb/architecture/discipline/single-responsibility.md; clean violation
// attribution; matches L188 + L214 separation pattern). Both validators
// now share identical {kind, from, to, fix} violation entry shape.
validators['kb-architecture-related-bidirectional'] = function () {
  const violations = [];
  const relatedMap = new Map();
  for (const { kbId, path: fp } of listKbArchitectureFiles()) {
    try {
      const { frontmatter: fm } = parseFrontmatter(fs.readFileSync(fp, 'utf8'));
      const related = Array.isArray(fm.related) ? fm.related : (fm.related ? [fm.related] : []);
      relatedMap.set(kbId, new Set(related));
    } catch { /* corrupt frontmatter or read error; skip — fail-soft */ }
  }
  for (const [kbId, related] of relatedMap.entries()) {
    for (const target of related) {
      // Skip references outside kb/architecture tree (cross-tree refs allowed)
      if (!relatedMap.has(target)) continue;
      const reverse = relatedMap.get(target);
      if (!reverse.has(kbId)) {
        violations.push({
          kind: 'asymmetric-related-link',
          from: kbId,
          to: target,
          fix: `Add "${kbId}" to ${target}.md frontmatter "related" array`,
        });
      }
    }
  }
  return violations;
};

validators['contract-skills-status-keys'] = function () {
  // Every name in required + recommended must have a skill_status entry; no orphans either way.
  const violations = [];
  for (const { name, path: fp } of listContractFiles()) {
    const c = loadJson(fp);
    if (!c || !c.skills) continue;
    const required = c.skills.required || [];
    const recommended = c.skills.recommended || [];
    const declared = new Set([...required, ...recommended]);
    const status = c.skills.skill_status || {};
    const statusKeys = new Set(Object.keys(status));
    for (const skill of declared) {
      if (!statusKeys.has(skill)) {
        violations.push({
          kind: 'missing-skill-status',
          contract: name,
          skill,
          fix: `Add "${skill}": "<status>" to skill_status map`,
        });
      }
    }
    for (const key of statusKeys) {
      if (!declared.has(key)) {
        violations.push({
          kind: 'orphan-skill-status',
          contract: name,
          skill: key,
          fix: `Remove "${key}" from skill_status (not declared in required or recommended)`,
        });
      }
    }
  }
  return violations;
};

validators['contract-skill-status-values'] = function () {
  // Each skill_status value must be: 'available', 'not-yet-authored', or 'marketplace:<plugin>/<skill>'.
  // For 'available', the local skill must exist at skills/<name>/SKILL.md.
  // For 'marketplace:<x>/<y>', the file at marketplaces/<x>/<plugin>/skills/<y>/SKILL.md (or the
  // bare marketplace/<x>/skills/<y>/SKILL.md if y is a fully namespaced ref) must exist.
  //
  // H.7.10 — marketplace check is conditional on MARKETPLACE_BASE being
  // populated. CI runners (and minimal user installs) don't have the
  // knowledge-work-plugins marketplace installed; skipping the existence
  // check there preserves repo-internal validation while not failing on
  // an external-dependency gap. Syntax validation of `marketplace:X/Y`
  // format ALWAYS runs — only the file-existence check is gated.
  const marketplaceCheckEnabled = (() => {
    try {
      if (!fs.existsSync(MARKETPLACE_BASE)) return false;
      // Has at least one marketplace subdir installed?
      return fs.readdirSync(MARKETPLACE_BASE).some((d) => {
        try {
          return fs.statSync(path.join(MARKETPLACE_BASE, d)).isDirectory();
        } catch { return false; }
      });
    } catch { return false; }
  })();
  if (!marketplaceCheckEnabled) {
    // marketplace: declarations are informational soft dependencies (see
    // contract-format.md). When no marketplaces are installed (CI, minimal
    // user install), file-existence enforcement would produce false-positive
    // "missing" violations for skills that aren't required for power-loom
    // to function. Syntax validation of `marketplace:X/Y` format still runs.
    process.stderr.write(`  ℹ contract-skill-status-values: marketplace declarations treated as informational; no marketplaces installed at ${MARKETPLACE_BASE} (this is normal in CI / minimal installs)\n`);
  }
  const violations = [];
  for (const { name, path: fp } of listContractFiles()) {
    const c = loadJson(fp);
    if (!c || !c.skills || !c.skills.skill_status) continue;
    for (const [skill, status] of Object.entries(c.skills.skill_status)) {
      if (VALID_SKILL_STATUSES_LITERAL.has(status)) {
        if (status === 'available') {
          // Strip namespace for local path lookup: `engineering:debug` → not local
          // Local skills are bare names — no colon.
          if (skill.includes(':')) {
            violations.push({
              kind: 'available-but-namespaced',
              contract: name,
              skill,
              status,
              fix: `Skill "${skill}" has a colon — should be marketplace, not "available"`,
            });
            continue;
          }
          // v2.8.4 FIX-C: "available" matches either skills/<name>/SKILL.md
          // OR commands/<name>.md (slash-command skills like plan, review,
          // prune, security-audit are valid "available" referents).
          const skillPath = path.join(SKILLS_BASE, skill, 'SKILL.md');
          const commandPath = path.join(COMMANDS_BASE, skill + '.md');
          if (!fs.existsSync(skillPath) && !fs.existsSync(commandPath)) {
            violations.push({
              kind: 'available-but-missing',
              contract: name,
              skill,
              expectedPath: skillPath,
              alsoChecked: commandPath,
            });
          }
        }
        continue;
      }
      const mp = status.match(/^marketplace:([^/]+)\/(.+)$/);
      if (!mp) {
        violations.push({
          kind: 'invalid-skill-status',
          contract: name,
          skill,
          status,
          fix: 'Status must be "available" | "not-yet-authored" | "marketplace:<marketplace>/<plugin>"',
        });
        continue;
      }
      const [_, marketplace, plugin] = mp;
      // Skill name in spawn prompt = `<plugin>:<skill>`; we need to extract the skill name from `skill` (e.g., "engineering:debug" → "debug")
      const skillBase = skill.includes(':') ? skill.split(':')[1] : skill;
      const expectedPath = path.join(MARKETPLACE_BASE, marketplace, plugin, 'skills', skillBase, 'SKILL.md');
      // H.7.10 — skip file-existence check when no marketplaces installed
      // (CI / minimal-install case). Syntax was validated above.
      if (marketplaceCheckEnabled && !fs.existsSync(expectedPath)) {
        violations.push({
          kind: 'marketplace-skill-missing',
          contract: name,
          skill,
          status,
          expectedPath,
        });
      }
    }
  }
  return violations;
};

validators['contract-kb-scope-resolves'] = function () {
  // Every kb: ref in kb_scope.default should resolve via kb-resolver manifest.
  const violations = [];
  const manifest = fs.existsSync(KB_MANIFEST) ? loadJson(KB_MANIFEST) : null;
  if (!manifest) {
    return [{ kind: 'missing-manifest', file: KB_MANIFEST, fix: 'Run `kb-resolver scan` to generate manifest' }];
  }
  const knownIds = new Set(Object.keys(manifest.entries || {}));
  for (const { name, path: fp } of listContractFiles()) {
    const c = loadJson(fp);
    if (!c || !c.kb_scope) continue;
    const refs = (c.kb_scope.default || []).concat(c.kb_scope.optional || []);
    for (const ref of refs) {
      if (typeof ref !== 'string') continue;
      // Strip "kb:" prefix and optional "@<hash>"
      const m = ref.match(/^kb:([^@]+)(?:@.+)?$/);
      if (!m) {
        violations.push({
          kind: 'malformed-kb-ref',
          contract: name,
          ref,
        });
        continue;
      }
      const kbId = m[1];
      if (!knownIds.has(kbId)) {
        violations.push({
          kind: 'unknown-kb-ref',
          contract: name,
          ref,
          kbId,
          fix: `Add ${kbId}.md to skills/agent-team/kb/ + run kb-resolver scan`,
        });
      }
    }
  }
  return violations;
};

// H.7.22 — contract-plugin-hook-deployment: verify every hook in hooks/hooks.json
// is deployed somewhere callable. Closes drift-note 34 (install.sh smoke ≠ real
// wiring). For each (event, matcher, command) triple in plugin's hooks.json:
//   - If CLAUDE_PLUGIN_ROOT is set AND points to the marketplace clone AND the
//     plugin's own hooks.json contains the triple → passes (plugin loaded properly)
//   - Else: settings.json must contain a matching hook entry
// Also flags matcher-string drift between plugin's hooks.json and settings.json
// (e.g., H.7.20's Write→Edit|Write change that didn't propagate to settings.json).
//
// Per code-reviewer code-review feedback M1: NOT a blanket auto-pass on
// CLAUDE_PLUGIN_ROOT presence. Env var alone could mask partial-migration state.
validators['contract-plugin-hook-deployment'] = function () {
  const violations = [];

  // Load plugin's hooks.json
  if (!fs.existsSync(HOOKS_JSON)) {
    return [{ kind: 'missing-hooks-json', file: HOOKS_JSON, fix: 'hooks/hooks.json is the plugin source-of-truth; create it' }];
  }
  const pluginHooksRaw = loadJson(HOOKS_JSON);
  if (!pluginHooksRaw) {
    return [{ kind: 'malformed-hooks-json', file: HOOKS_JSON, fix: 'JSON parse failed; restore from git' }];
  }
  // Per code-reviewer code-review: hooks.json has top-level `_comment`; access `.hooks`, NOT root.
  const pluginHooks = pluginHooksRaw.hooks;
  if (!pluginHooks || typeof pluginHooks !== 'object') {
    return [{ kind: 'malformed-hooks-json', file: HOOKS_JSON, fix: 'hooks.json must have top-level `hooks` object' }];
  }

  // Enumerate plugin triples: (event, matcher, command-suffix). Command-suffix
  // is compared regardless of install location (see extractCommandSuffix). The
  // same enumerator runs over the INSTALLED cache hooks below for drift compare.
  const pluginTriples = enumerateTriples(pluginHooks);

  // Try the loaded-plugin path first
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || '';
  const isPluginLoaded = pluginRoot && pluginRoot.includes('power-loom-marketplace');
  if (isPluginLoaded) {
    // Plugin loaded — every triple should already be served by the plugin loader.
    // No settings.json check needed; auto-pass with verification log.
    return []; // no violations
  }

  // H.7.24 — drift-note 50: when plugin appears enabled per settings.json
  // (enabledPlugins truthy) but CLAUDE_PLUGIN_ROOT is unset (running outside
  // session context), emit informational stderr noting state-suggests-active
  // without claiming verified-deployed. Per H.7.24 plan code-reviewer FLAG #1:
  // settings-side `enabledPlugins` truthy is a WEAKER signal than a plugin
  // loader injecting CLAUDE_PLUGIN_ROOT — could mask a broken cache / failed
  // install. So we DO NOT auto-pass here, just surface noise reduction.
  const settingsPath = path.join(process.env.HOME, '.claude', 'settings.json');
  let settings = null;
  try {
    if (fs.existsSync(settingsPath)) {
      const settingsForEnabledCheck = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const enabled = settingsForEnabledCheck && settingsForEnabledCheck.enabledPlugins
        && Boolean(settingsForEnabledCheck.enabledPlugins['power-loom@power-loom-marketplace']);
      if (enabled) {
        process.stderr.write(
          `ℹ contract-plugin-hook-deployment: enabledPlugins shows ` +
          `power-loom@power-loom-marketplace enabled; CLAUDE_PLUGIN_ROOT unset ` +
          `(running outside plugin-loaded session). Settings-side state suggests ` +
          `plugin should be active; verifying the installed plugin cache.\n`
        );
        // H.7.24 completion (NOT reversal): enabledPlugins truthy is a weak
        // signal alone, so VERIFY the installed cache actually carries the repo
        // hooks before passing. Compare the installed cache's triples against the
        // repo triples: full coverage => deployed (pass); a present-but-STALE
        // cache (missing repo hooks) => flag exactly the missing hooks (the
        // drift the validator exists to catch); no confirmable install => fall
        // through to the settings.json check (broken/absent install).
        const installed = readInstalledPluginHooks('power-loom@power-loom-marketplace');
        if (installed) {
          const cachedSuffixes = new Set(enumerateTriples(installed.hooks).map((t) => t.suffix));
          const missing = pluginTriples.filter((t) => !cachedSuffixes.has(t.suffix));
          if (missing.length === 0) {
            process.stderr.write(
              `ℹ contract-plugin-hook-deployment: verified power-loom installed at ` +
              `${installed.installPath}; its cache hooks.json covers all ${pluginTriples.length} ` +
              `repo hooks — the plugin loader deploys them at session start (deployed).\n`
            );
            return []; // confirmed install whose cache covers every repo hook
          }
          process.stderr.write(
            `ℹ contract-plugin-hook-deployment: power-loom installed at ${installed.installPath} ` +
            `but its cache is STALE — ${missing.length}/${pluginTriples.length} repo hooks are ` +
            `absent from the installed cache. Run /plugin update.\n`
          );
          return missing.map((t) => ({
            kind: 'hook-not-in-installed-cache',
            event: t.event,
            matcher: t.matcher,
            commandSuffix: t.suffix,
            installPath: installed.installPath,
            fix: `Hook ${t.suffix} is in the repo hooks.json but NOT in the installed plugin `
              + `cache at ${installed.installPath}. Run /plugin update power-loom@power-loom-marketplace.`,
          }));
        }
        // else: enabled but NO confirmable install record / cache hooks.json —
        // fall through to the settings.json check below (the broken/absent-install
        // case H.7.24 deliberately preserved; now detected, not always-counted).
      }
    }
  } catch {
    // Defensive: fall through to the existing settings-not-found / malformed branches
  }

  // Plugin not loaded → fall back to settings.json verification
  // Two cases for "no settings.json":
  //   (a) CI / fresh checkout / no Claude Code installed → treat as informational; auto-pass
  //   (b) settings.json exists but is malformed → real violation
  // The fs.existsSync check distinguishes them.
  if (!fs.existsSync(settingsPath)) {
    // Informational: CI runner or fresh user. Surface a hint to stderr but pass.
    process.stderr.write(
      `ℹ contract-plugin-hook-deployment: settings.json absent (likely CI or fresh install); ` +
      `deployment check skipped. Run /plugin install power-loom@power-loom-marketplace AND/OR ` +
      `./install.sh --all on a real install to wire hooks.\n`
    );
    return [];
  }
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (err) {
    return [{
      kind: 'settings-malformed',
      file: settingsPath,
      error: err.message,
      fix: 'settings.json present but unreadable; check JSON syntax or restore from backup.',
    }];
  }

  const userHooks = (settings && settings.hooks) || {};
  for (const t of pluginTriples) {
    const userEntries = userHooks[t.event];
    if (!Array.isArray(userEntries) || userEntries.length === 0) {
      violations.push({
        kind: 'hook-not-deployed',
        event: t.event,
        matcher: t.matcher,
        commandSuffix: t.suffix,
        fix: `Hook missing in user settings.json. Run /plugin install power-loom@power-loom-marketplace, OR add to ~/.claude/settings.json hooks.${t.event}`,
      });
      continue;
    }
    // Look for a user hook with matching command-suffix
    const userMatch = userEntries
      .flatMap((e) => Array.isArray(e.hooks) ? e.hooks.map((h) => ({ ...h, _matcher: e.matcher })) : [])
      .find((h) => h.type === 'command' && extractCommandSuffix(h.command || '') === t.suffix);
    if (!userMatch) {
      violations.push({
        kind: 'hook-not-deployed',
        event: t.event,
        matcher: t.matcher,
        commandSuffix: t.suffix,
        fix: `Hook ${t.suffix} not in settings.json under ${t.event}. Plugin install will resolve.`,
      });
      continue;
    }
    // Matcher drift check (H.7.20 surface)
    if ((userMatch._matcher || '') !== t.matcher) {
      violations.push({
        kind: 'matcher-drift',
        event: t.event,
        commandSuffix: t.suffix,
        pluginMatcher: t.matcher,
        userMatcher: userMatch._matcher || '(none)',
        fix: `Plugin's hooks.json declares matcher '${t.matcher}'; settings.json has '${userMatch._matcher || '(none)'}'. Update settings.json or run /plugin install to resync.`,
      });
    }
  }
  return violations;
};

// Extract a stable suffix from a hook command string. Used to compare
// triples across plugin (with `${CLAUDE_PLUGIN_ROOT}` placeholders) vs
// settings.json (with absolute paths). Returns the path after the FIRST
// occurrence of `packages/kernel/` — the v4 layout root that every deployed
// hook/validator/observability/spawn-state command shares identically in both
// the placeholder and absolute-path forms (the pre-migration `hooks/scripts/`
// anchor no longer matches any command, which silently broke the cross-source
// comparison). Falls back to the full command if not found (still allows
// comparison, just less robust).
function extractCommandSuffix(command) {
  const m = command.match(/packages\/kernel\/(.+)$/);
  return m ? m[1] : command;
}

// Enumerate a hooks.json `hooks` object into (event, matcher, command, suffix)
// triples. Shared by the repo-side enumeration and the installed-cache drift
// comparison so both triple sets are derived identically.
function enumerateTriples(hooksObj) {
  const triples = [];
  for (const [event, entries] of Object.entries(hooksObj || {})) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const matcher = entry.matcher || '';
      const hooks = Array.isArray(entry.hooks) ? entry.hooks : [];
      for (const h of hooks) {
        if (h.type !== 'command' || !h.command) continue;
        triples.push({ event, matcher, command: h.command, suffix: extractCommandSuffix(h.command) });
      }
    }
  }
  return triples;
}

// Read the INSTALLED plugin's cached hooks (out-of-session, CLAUDE_PLUGIN_ROOT
// unset). Resolves ~/.claude/plugins/installed_plugins.json -> the plugin's
// installPath -> the cached packages/kernel/hooks.json the plugin loader uses.
// Returns { installPath, hooks } (the parsed `hooks` object) when the install
// record + cache hooks.json are present and parse, else null. Fail-soft: a
// missing HOME / field / read / parse error returns null, so the caller falls
// through to the conservative settings.json check (never a false PASS).
//
// The CALLER compares these cached triples against the repo triples — a present
// install whose cache is STALE (missing repo hooks) is flagged per-missing-hook,
// NOT auto-passed. This COMPLETES H.7.24 (verify the cache actually carries the
// hooks) instead of reversing its don't-blindly-trust-enabledPlugins intent.
function readInstalledPluginHooks(pluginId) {
  if (!process.env.HOME) return null;
  try {
    const registry = path.join(process.env.HOME, '.claude', 'plugins', 'installed_plugins.json');
    if (!fs.existsSync(registry)) return null;
    const data = JSON.parse(fs.readFileSync(registry, 'utf8'));
    const entries = data && data.plugins && data.plugins[pluginId];
    if (!Array.isArray(entries)) return null;
    for (const entry of entries) {
      if (!entry || typeof entry.installPath !== 'string') continue;
      const hooksJson = path.join(entry.installPath, 'packages', 'kernel', 'hooks.json');
      if (!fs.existsSync(hooksJson)) continue;
      const parsed = JSON.parse(fs.readFileSync(hooksJson, 'utf8'));
      if (parsed && parsed.hooks && typeof parsed.hooks === 'object') {
        return { installPath: entry.installPath, hooks: parsed.hooks };
      }
    }
    return null;
  } catch {
    return null; // unreadable / malformed registry -> conservative fall-through
  }
}

// H.7.23 — contract-marketplace-schema: validate .claude-plugin/plugin.json
// + marketplace.json against vendored schemas. Closes drift-note 42 (would
// have caught all 3 H.7.22 hotfixes pre-ship: source format, path-prefix,
// redundant fields).
//
// Per H.7.23 code-reviewer FAIL #1: NOT a general JSON Schema validator
// (ajv unavailable; minimal subset understates work). Targets 3 specific
// H.7.22 failure patterns:
//   (1) marketplace.json source field must match ^\./.* (catches H.7.22.1)
//   (2) plugin.json component-path fields if present must match ^\./.* (H.7.22.2)
//   (3) plugin.json component-path fields are optional; flag when present
//       but pointing at default locations — auto-discovery would handle them
//       (catches H.7.22.3 redundancy; matches official anthropic plugin convention)
//
// Auto-pass conditions (CI fresh-checkout safety):
//   - Vendored schemas absent (informational stderr; not a violation)
//   - Schema files corrupt (try/catch around JSON.parse; fail-open with error)
//   - Plugin/marketplace manifest absent (informational stderr; expected on
//     a fresh checkout that hasn't fully bootstrapped yet)
//
// Convention A declared (repo-internal correctness — schemas vendored).
const SCHEMAS_DIR = path.join(TOOLKIT, 'packages', 'kernel', 'schema');
const PLUGIN_MANIFEST_PATH = path.join(TOOLKIT, '.claude-plugin', 'plugin.json');
const MARKETPLACE_MANIFEST_PATH = path.join(TOOLKIT, '.claude-plugin', 'marketplace.json');

const RELATIVE_PATH_PATTERN = /^\.\/.*/;
const COMPONENT_PATH_FIELDS = ['hooks', 'agents', 'commands', 'skills'];

validators['contract-marketplace-schema'] = function () {
  const violations = [];
  let schemasValidated = 0;

  // Stderr informational on missing schemas — auto-pass (fresh-checkout safety)
  const pluginSchemaPath = path.join(SCHEMAS_DIR, 'plugin-manifest.schema.json');
  const marketSchemaPath = path.join(SCHEMAS_DIR, 'marketplace.schema.json');

  const pluginSchemaExists = fs.existsSync(pluginSchemaPath);
  const marketSchemaExists = fs.existsSync(marketSchemaPath);

  if (!pluginSchemaExists || !marketSchemaExists) {
    process.stderr.write(
      `ℹ contract-marketplace-schema: vendored schemas missing in ${SCHEMAS_DIR}/ ` +
      '(this is normal on fresh checkout / minimal install; run packages/runtime/orchestration/refresh-plugin-schema.sh to vendor)\n'
    );
    return [];
  }

  // Validate the schemas themselves are parseable (defense-in-depth)
  try {
    JSON.parse(fs.readFileSync(pluginSchemaPath, 'utf8'));
    JSON.parse(fs.readFileSync(marketSchemaPath, 'utf8'));
  } catch (err) {
    process.stderr.write(
      `⚠ contract-marketplace-schema: vendored schema unparseable: ${err.message}. ` +
      'Run packages/runtime/orchestration/refresh-plugin-schema.sh to refetch.\n'
    );
    return [];
  }

  // Validate plugin.json
  if (fs.existsSync(PLUGIN_MANIFEST_PATH)) {
    let pluginManifest;
    try {
      pluginManifest = JSON.parse(fs.readFileSync(PLUGIN_MANIFEST_PATH, 'utf8'));
    } catch (err) {
      violations.push({
        kind: 'plugin-manifest-malformed',
        file: PLUGIN_MANIFEST_PATH,
        error: err.message,
        fix: 'plugin.json is not valid JSON — restore from git or fix syntax',
      });
      pluginManifest = null;
    }

    if (pluginManifest) {
      // Pattern (2): component-path fields if present must match ^\./.*
      // Pattern (3): redundancy — flag if fields present but pointing at defaults
      for (const field of COMPONENT_PATH_FIELDS) {
        if (pluginManifest[field] === undefined) continue;
        const value = pluginManifest[field];

        if (typeof value === 'string') {
          if (!RELATIVE_PATH_PATTERN.test(value)) {
            violations.push({
              kind: 'plugin-component-path-format',
              field,
              value,
              fix: `Plugin manifest '${field}' must match ^\\./.* per Claude Code schema. Got "${value}". Drop the field entirely if it points at the default location (claude auto-discovers).`,
              ref: 'H.7.22.2 hotfix root cause',
            });
          }
          // Pattern (3): redundancy detection
          // Default discovery locations: hooks/hooks.json, agents/, commands/, skills/
          const defaultPaths = {
            hooks: ['./hooks/hooks.json'],
            agents: ['./agents', './agents/'],
            commands: ['./commands', './commands/'],
            skills: ['./skills', './skills/'],
          };
          if ((defaultPaths[field] || []).some((d) => d === value)) {
            violations.push({
              kind: 'plugin-component-path-redundant',
              field,
              value,
              severity: 'info',
              fix: `Plugin manifest '${field}: "${value}"' matches the default auto-discovery location. Consider dropping the field — official anthropic plugins (code-review, feature-dev) declare zero component-path fields and rely on auto-discovery.`,
              ref: 'H.7.22.3 hotfix root cause',
            });
          }
        } else if (Array.isArray(value)) {
          // Array form — each entry must match ^\./.*
          value.forEach((entry, idx) => {
            if (typeof entry !== 'string' || !RELATIVE_PATH_PATTERN.test(entry)) {
              violations.push({
                kind: 'plugin-component-path-format',
                field,
                value: entry,
                index: idx,
                fix: `Plugin manifest '${field}[${idx}]' must be a string matching ^\\./.*. Got: ${JSON.stringify(entry)}.`,
              });
            }
          });
        }
      }
      schemasValidated++;
    }
  } else {
    process.stderr.write(`ℹ contract-marketplace-schema: ${PLUGIN_MANIFEST_PATH} not found (skipped)\n`);
  }

  // Validate marketplace.json
  if (fs.existsSync(MARKETPLACE_MANIFEST_PATH)) {
    let marketManifest;
    try {
      marketManifest = JSON.parse(fs.readFileSync(MARKETPLACE_MANIFEST_PATH, 'utf8'));
    } catch (err) {
      violations.push({
        kind: 'marketplace-manifest-malformed',
        file: MARKETPLACE_MANIFEST_PATH,
        error: err.message,
        fix: 'marketplace.json is not valid JSON',
      });
      marketManifest = null;
    }

    if (marketManifest) {
      // Pattern (1): plugin entries' source field if string must match ^\./.*
      const plugins = Array.isArray(marketManifest.plugins) ? marketManifest.plugins : [];
      plugins.forEach((p, idx) => {
        if (typeof p.source === 'string' && !RELATIVE_PATH_PATTERN.test(p.source)) {
          violations.push({
            kind: 'marketplace-source-format',
            pluginIndex: idx,
            pluginName: p.name || '(unnamed)',
            value: p.source,
            fix: `marketplace.json plugins[${idx}].source must match ^\\./.* per Claude Code schema. Got "${p.source}". Use "./" if plugin root is marketplace root.`,
            ref: 'H.7.22.1 hotfix root cause',
          });
        }
      });
      schemasValidated++;
    }
  } else {
    process.stderr.write(`ℹ contract-marketplace-schema: ${MARKETPLACE_MANIFEST_PATH} not found (skipped)\n`);
  }

  // Confirmation marker for tests (per H.7.23 code-reviewer FLAG #7)
  if (schemasValidated > 0) {
    process.stderr.write(`ℹ contract-marketplace-schema: schemas: ${schemasValidated} validated\n`);
  }

  return violations;
};

// ---------- v3.1 PR-1: two-tier-contract validators ----------
//
// Five validators wired into the existing `validators` dictionary (no new CI
// job — `Object.keys(validators)` at the main loop enumerates them and the
// non-empty-result → process.exit(1) wiring is inherited). They validate the
// v3.1 two-tier contract shape (`interface` + `defaults`) + the capability
// trait composition (declared_capabilities == resolveTraits(interface.traits)).
//
// The 18 real contracts were migrated to the two-tier shape in THIS PR (PR-1),
// so these validators report ZERO violations against them — the regression
// guard (tests/unit/runtime/contracts/contracts-validate.test.js test 10)
// asserts totalViolations === 0 over listContractFiles(). The synthetic-fixture
// unit tests in that file exercise the NEGATIVE paths (each validator FAILs on
// malformed input) against a tmp toolkit root.

// Canonical comparison: stable-key JSON. Sufficient for the value shapes here
// (budgets, capability arrays) — no functions/undefined/Date to worry about.
function deepEqual(a, b) {
  return canonicalJson(a) === canonicalJson(b);
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

validators['two-tier-shape-present'] = function () {
  // Every contract must declare BOTH `interface` and `defaults` top-level keys.
  const violations = [];
  for (const { name, path: fp } of listContractFiles()) {
    const c = loadJson(fp);
    if (!c) {
      violations.push({ kind: 'unparseable-contract', contract: name, file: fp });
      continue;
    }
    if (!c.interface || typeof c.interface !== 'object') {
      violations.push({
        kind: 'missing-interface',
        contract: name,
        fix: `Add an "interface" block (traits[] + declared_capabilities) to ${name}.contract.json`,
      });
    }
    if (!c.defaults || typeof c.defaults !== 'object') {
      violations.push({
        kind: 'missing-defaults',
        contract: name,
        fix: `Add a "defaults" block (mirroring legacy top-level fields) to ${name}.contract.json`,
      });
    }
  }
  return violations;
};

validators['defaults-mirror-legacy'] = function () {
  // When a legacy top-level `budget` is present, defaults.budget must deep-equal
  // it (the two-tier shape mirrors legacy fields to stay backward compatible).
  const violations = [];
  for (const { name, path: fp } of listContractFiles()) {
    const c = loadJson(fp);
    if (!c) continue;
    if (c.budget === undefined) continue; // nothing to mirror
    const mirrored = c.defaults && c.defaults.budget;
    if (mirrored === undefined) {
      violations.push({
        kind: 'defaults-budget-missing',
        contract: name,
        fix: `Add defaults.budget mirroring the legacy top-level budget in ${name}.contract.json`,
      });
      continue;
    }
    if (!deepEqual(mirrored, c.budget)) {
      violations.push({
        kind: 'defaults-budget-drift',
        contract: name,
        legacy: c.budget,
        defaults: mirrored,
        fix: `defaults.budget must deep-equal the legacy top-level budget in ${name}.contract.json`,
      });
    }
  }
  return violations;
};

validators['traits-resolve-clean'] = function () {
  // interface.traits[] must all be known registry traits AND
  // interface.declared_capabilities must deep-equal resolveTraits(traits).
  const violations = [];
  const reg = loadJson(TRAITS_REGISTRY);
  if (!reg) {
    return [{
      kind: 'missing-traits-registry',
      file: TRAITS_REGISTRY,
      fix: 'create packages/runtime/contracts/traits/_registry.json',
    }];
  }
  for (const { name, path: fp } of listContractFiles()) {
    const c = loadJson(fp);
    if (!c || !c.interface) continue;
    const traits = Array.isArray(c.interface.traits) ? c.interface.traits : [];
    let resolved;
    try {
      resolved = resolveTraits(traits, reg);
    } catch (err) {
      violations.push({
        kind: 'trait-resolution-error',
        contract: name,
        error: err.message,
        fix: `Fix interface.traits in ${name}.contract.json (unknown trait or narrowing-axis conflict)`,
      });
      continue;
    }
    const declared = c.interface.declared_capabilities || {};
    if (!deepEqual(declared, resolved)) {
      violations.push({
        kind: 'declared-capabilities-drift',
        contract: name,
        declared,
        resolved,
        fix: `Set interface.declared_capabilities to resolveTraits(traits) in ${name}.contract.json`,
      });
    }
  }
  return violations;
};

validators['decomposition-discipline-valid'] = function () {
  // decomposition_discipline must (a) be present, (b) declare a non-empty `primary`,
  // and (c) — v3.2 Wave 1 R8 — every present discipline value (`primary` and
  // `fallback_when_code_producing`) must be in the FROZEN vocabulary
  // (`_lib/decomposition-disciplines.js`; USER-ratified Option A = {spec-driven, tdd}).
  // Canonical home is interface.decomposition_discipline (RFC v3.3 §3.3); a legacy
  // top-level placement is tolerated for backward compatibility, interface first.
  // Thin adapter over the pure `disciplineBlockViolations` (unit-tested separately).
  const fixes = {
    missing: (name) =>
      `Add a decomposition_discipline block with a "primary" concern to ${name}.contract.json`,
    'no-primary': (name) =>
      `decomposition_discipline must declare a non-empty string "primary" in ${name}.contract.json`,
    unknown: (name, v) =>
      `decomposition_discipline.${v.field} "${v.value}" is not in the frozen vocabulary ` +
      `[${DECOMPOSITION_DISCIPLINES.join(', ')}] — see _lib/decomposition-disciplines.js ` +
      `(${name}.contract.json)`,
  };
  const violations = [];
  for (const { name, path: fp } of listContractFiles()) {
    const c = loadJson(fp);
    if (!c) continue;
    // Optional-chaining so a malformed contract with `interface: null` falls back to
    // the legacy top-level placement instead of throwing (code-review MEDIUM) — the
    // ternary's true branch is reachable only when interface is a non-null object.
    const dd = c.interface?.decomposition_discipline !== undefined
      ? c.interface.decomposition_discipline
      : c.decomposition_discipline;
    for (const v of disciplineBlockViolations(dd)) {
      // Default the fix-builder so a FUTURE disciplineBlockViolations kind can't crash
      // the validator with "fixes[kind] is not a function" (code-review LOW).
      const buildFix = fixes[v.kind] || (() => `decomposition_discipline issue (${v.kind}) in ${name}.contract.json`);
      violations.push({
        kind: `decomposition-discipline-${v.kind}`,
        contract: name,
        fix: buildFix(name, v),
      });
    }
  }
  return violations;
};

validators['registry-schema-valid'] = function () {
  // The traits registry must parse, declare schemaVersion 1.0.0, carry the
  // canonical _axis_direction map, and every trait axis must be a known axis.
  const violations = [];
  const reg = loadJson(TRAITS_REGISTRY);
  if (!reg) {
    return [{
      kind: 'missing-traits-registry',
      file: TRAITS_REGISTRY,
      fix: 'create packages/runtime/contracts/traits/_registry.json',
    }];
  }
  if (reg.schemaVersion !== '1.0.0') {
    violations.push({
      kind: 'registry-schema-version',
      actual: reg.schemaVersion,
      expected: '1.0.0',
      fix: 'Set traits/_registry.json schemaVersion to "1.0.0"',
    });
  }
  const directions = reg._axis_direction || {};
  if (Object.keys(directions).length === 0) {
    violations.push({
      kind: 'registry-axis-direction-missing',
      fix: 'traits/_registry.json must declare _axis_direction (narrowing/broadening per axis)',
    });
  }
  const knownAxes = new Set(Object.keys(directions));
  for (const [traitName, trait] of Object.entries(reg.traits || {})) {
    for (const axis of Object.keys(trait)) {
      if (axis.startsWith('_')) continue;
      if (!knownAxes.has(axis)) {
        violations.push({
          kind: 'registry-unknown-axis',
          trait: traitName,
          axis,
          fix: `Declare axis '${axis}' in traits/_registry.json _axis_direction or remove it from trait '${traitName}'`,
        });
      }
    }
  }
  return violations;
};

// ---------- v3.1 PR-2a: agent.md <-> contract reconciliation ----------
//
// Closes the PR-1 board's source-of-truth carry-forward: the traits registry
// _doc NAMES `agents/<name>.md tools:` as the AUTHORITATIVE capability source
// ([Read,Grep,Glob]=read-only; +Bash=subprocess; +Edit/Write=writes), but until
// now NOTHING bound a contract's declared traits back to that floor. This
// validator does — for each numbered persona contract with a corresponding
// agents/<name>.md (NN- prefix stripped):
//   - tools: contains Edit|Write  => contract MUST carry worktree_writable
//                                    (else write-floor-missing).
//   - tools: WITHOUT Edit/Write   => contract MUST NOT carry worktree_writable
//                                    (read-only over-grant => write-overgrant).
//   - tools: WITHOUT Bash but the contract HAS bash_test_runner
//                                  => subprocess over-grant (subprocess-overgrant).
//   (Bash present + bash_test_runner present is PERMITTED, not required — a
//   Bash-capable persona may legitimately omit the test-runner subprocess trait.)
//
// SKIP rule: contracts with no single agents/<name>.md are skipped (they have
// no single frontmatter floor to bind):
//   - challenger / engineering-task   — persona '<set-at-spawn>' templates.
//   - 12-security-engineer            — maps to agents/security-AUDITOR.md, not
//                                       security-engineer.md, so the strict
//                                       strip-rule finds no single floor. Noted,
//                                       not bound (parallels the templates).
//
// Numbered-only: the NN- prefix is the contract's persona-slot marker. A
// contract WITHOUT a leading NN- (challenger, engineering-task) is a template
// and is skipped by this gate regardless of agent.md existence.
//
// AXES BOUND vs INTENTIONALLY UN-RECONCILED (coverage boundary — not an omission):
//   - write  (Edit|Write -> worktree_writable) : bound BOTH directions
//     (floor-missing AND over-grant).
//   - subprocess (Bash -> bash_test_runner)    : bound the over-grant direction
//     only (Bash present + runner absent is a legitimate narrower grant).
//   - network (network_anthropic)              : DELIBERATELY un-reconciled.
//     `network` is NOT a Claude Code tool, so agents/<name>.md `tools:` carries
//     no network referent to bind it to; the traits-registry _doc maps `tools:`
//     to read/subprocess/write only, and network_anthropic is advisory-audit
//     (NOT blockable mid-spawn, per ADR-0011 §3.2). There is therefore no
//     tools: floor to reconcile against — the absence here is correct-by-design,
//     not a missing edge. (Resolves PR-2a review FLAG: network-axis coverage.)
//     RUNTIME COMPANION (2026-05-31): Bash-subprocess egress to undeclared hosts
//     IS audited post-hoc (advisory) by
//     packages/kernel/observability/network-egress-audit.js (PostToolUse:Bash);
//     tool-mediated egress (WebFetch/WebSearch/MCP) is enforced by the harness
//     via `tools:`. Real egress PREVENTION is ContainerAdapter-tier. So "network
//     un-reconciled here" is correct AND complete — not an unhandled gap.
//   - security-engineer: 12-security-engineer is the ONE write-capable persona
//     whose strict-stripped name (security-engineer) has no agents/<name>.md
//     (the floor lives in agents/security-AUDITOR.md). It is SKIPPED today (see
//     SKIP rule). A future {'security-engineer':'security-auditor'} alias map
//     would floor-bind it — deferred to PR-2b polish, tracked, not a PR-2a gap.

const NUMBERED_CONTRACT_RE = /^(\d+)-(.+)$/;

// v3.2 Wave 0 — close the 12-security-engineer write-floor gap. The strict
// strip-rule maps `12-security-engineer` -> `security-engineer`, which has no
// `agents/security-engineer.md`; the AUTHORITATIVE floor lives in
// `agents/security-auditor.md`. This alias binds the contract to that floor so
// the one write-capable persona is reconciled, not silently skipped. Add an
// entry here for any future contract whose persona-slot name diverges from its
// agent.md basename.
const AGENT_NAME_ALIASES = { 'security-engineer': 'security-auditor' };

// Read agent.md tools[] frontmatter. Small fixed set (~16 numbered contracts);
// no memoization needed at this scale (each validator run reads from disk once
// per numbered contract; the three axis checks below reuse the returned Set).
function readAgentTools(agentName) {
  const fp = path.join(AGENTS_DIR, `${agentName}.md`);
  if (!fs.existsSync(fp)) return null;
  try {
    const { frontmatter: fm } = parseFrontmatter(fs.readFileSync(fp, 'utf8'));
    const tools = Array.isArray(fm.tools) ? fm.tools : [];
    return new Set(tools.map((t) => String(t)));
  } catch {
    return null; // unreadable frontmatter — treat as no-floor (skip)
  }
}

function contractHasTrait(contract, traitName) {
  const traits = (contract.interface && Array.isArray(contract.interface.traits))
    ? contract.interface.traits
    : [];
  return traits.includes(traitName);
}

validators['agent-contract-capability-reconcile'] = function () {
  const violations = [];
  for (const { name, path: fp } of listContractFiles()) {
    const m = name.match(NUMBERED_CONTRACT_RE);
    if (!m) continue; // un-numbered template (challenger / engineering-task) — skip
    const agentName = AGENT_NAME_ALIASES[m[2]] || m[2];
    const tools = readAgentTools(agentName);
    if (tools === null) {
      // No agents/<name>.md floor even after alias resolution. Cannot bind;
      // skip silently (genuine template / floor-less persona).
      continue;
    }
    const c = loadJson(fp);
    if (!c) continue;
    const toolsWrite = tools.has('Edit') || tools.has('Write');
    const toolsBash = tools.has('Bash');
    const hasWritable = contractHasTrait(c, 'worktree_writable');
    const hasBashRunner = contractHasTrait(c, 'bash_test_runner');

    if (toolsWrite && !hasWritable) {
      violations.push({
        kind: 'write-floor-missing',
        contract: name,
        agent: `agents/${agentName}.md`,
        fix: `agents/${agentName}.md tools include Edit/Write but ${name}.contract.json lacks the worktree_writable trait — add it to interface.traits.`,
      });
    }
    if (!toolsWrite && hasWritable) {
      violations.push({
        kind: 'write-overgrant',
        contract: name,
        agent: `agents/${agentName}.md`,
        fix: `${name}.contract.json declares worktree_writable but agents/${agentName}.md tools are read-only (no Edit/Write) — remove the over-granted write trait.`,
      });
    }
    if (!toolsBash && hasBashRunner) {
      violations.push({
        kind: 'subprocess-overgrant',
        contract: name,
        agent: `agents/${agentName}.md`,
        fix: `${name}.contract.json declares bash_test_runner but agents/${agentName}.md tools omit Bash — remove the over-granted subprocess trait.`,
      });
    }
  }
  return violations;
};

// ---------- persona-instinct binding: role-brief <-> contract reconciliation ----------
//
// PR #205 added a named-instinct `## Mindset` set to all 16 HETS archetype
// role-briefs (descriptive prose). This validator makes that depth ENFORCED:
// each numbered persona contract must carry an `interface.instincts[]` array
// that mirrors the brief's instinct set, so the two cannot drift.
//
// SOURCE OF TRUTH = the numbered `## Mindset` headings in the role-brief
// (packages/runtime/personas/NN-name.md). The canonical slug is a DETERMINISTIC
// normalization of the heading — the hand-written `Instinct -> KB referral`
// slugs are NOT machine-parseable (they over-split on `/`/`+` and group slugs;
// proven by /tmp/extract-instincts.js during design). The validator recomputes
// the slug set from the brief and compares it to the contract; comparison is by
// SET (order-independent), since reordering instincts is not a drift worth
// failing CI over — only add / remove / rename is.
//
// Rules (mirrors agent-contract-capability-reconcile's skip semantics):
//   - brief has >=1 numbered instinct but contract lacks interface.instincts
//       => instinct-binding-missing.
//   - slug in brief, absent from contract => instinct-missing-from-contract.
//   - slug in contract, absent from brief => instinct-not-in-brief.
//   - contract with no NN-name.md brief (challenger / engineering-task
//     <set-at-spawn> templates) => SKIPPED (no instinct floor to bind).

// Read the ordered role-brief instinct slugs for a persona contract name (e.g.
// "04-architect"). Returns null ONLY when the brief is genuinely absent (template
// contracts) so the caller can skip. A brief that EXISTS but cannot be read is
// NOT skipped — the read error propagates so the validator surfaces it as a
// distinct `brief-unreadable` violation (fail-closed, not silent-clean).
function readBriefInstinctSlugs(contractName) {
  const fp = path.join(PERSONAS_DIR, `${contractName}.md`);
  if (!fs.existsSync(fp)) return null;
  return mindsetInstinctSlugs(fs.readFileSync(fp, 'utf8'));
}

validators['persona-instinct-reconcile'] = function () {
  const violations = [];
  for (const { name, path: fp } of listContractFiles()) {
    const m = name.match(NUMBERED_CONTRACT_RE);
    if (!m) continue; // un-numbered template (challenger / engineering-task) — skip

    let briefSlugs;
    try {
      briefSlugs = readBriefInstinctSlugs(name);
    } catch (err) {
      violations.push({
        kind: 'brief-unreadable',
        contract: name,
        brief: `packages/runtime/personas/${name}.md`,
        error: err.message,
        fix: `${name}.md exists but could not be read — restore it so instinct parity can be checked (NOT skipped: a numbered persona must have a readable brief).`,
      });
      continue;
    }
    if (briefSlugs === null || briefSlugs.length === 0) continue; // no Mindset floor — skip

    // Two distinct `## Mindset` headings that normalize to the same slug cannot
    // be faithfully mirrored by a contract (which carries a SET) — surface it
    // rather than let the set-comparison below silently absorb the collision.
    const dupes = duplicateSlugs(briefSlugs);
    if (dupes.length) {
      violations.push({
        kind: 'instinct-duplicate-slug',
        contract: name,
        brief: `packages/runtime/personas/${name}.md`,
        duplicates: dupes,
        fix: `Two ## Mindset headings in ${name}.md normalize to the same slug(s) [${dupes.join(', ')}] — rename one so each instinct is distinct.`,
      });
    }

    const c = loadJson(fp);
    if (!c) continue; // unparseable contract surfaced by two-tier-shape-present

    const rawInstincts = c.interface && c.interface.instincts;
    const briefSet = new Set(briefSlugs);
    if (rawInstincts === undefined) {
      violations.push({
        kind: 'instinct-binding-missing',
        contract: name,
        brief: `packages/runtime/personas/${name}.md`,
        expected: [...briefSet],
        fix: `Add interface.instincts (${briefSet.size} slugs) to ${name}.contract.json mirroring the role-brief's ## Mindset headings: [${[...briefSet].join(', ')}].`,
      });
      continue;
    }
    if (!Array.isArray(rawInstincts)) {
      violations.push({
        kind: 'instinct-binding-malformed',
        contract: name,
        actualType: typeof rawInstincts,
        fix: `interface.instincts in ${name}.contract.json must be an array of slug strings.`,
      });
      continue;
    }

    const contractSet = new Set(rawInstincts.map(String));
    for (const slug of briefSet) {
      if (!contractSet.has(slug)) {
        violations.push({
          kind: 'instinct-missing-from-contract',
          contract: name,
          instinct: slug,
          fix: `${name}.md defines the "${slug}" instinct but ${name}.contract.json's interface.instincts omits it — add it.`,
        });
      }
    }
    for (const slug of contractSet) {
      if (!briefSet.has(slug)) {
        violations.push({
          kind: 'instinct-not-in-brief',
          contract: name,
          instinct: slug,
          fix: `${name}.contract.json declares the "${slug}" instinct but ${name}.md's ## Mindset has no matching heading — remove it or add the heading.`,
        });
      }
    }
  }
  return violations;
};

// v3.2 Wave 0 (K11) — A4-binding SCAFFOLD (not full enforcement yet; structural
// integrity is a hard error now, the planned[] watchlist is WARN-only until the
// Wave-3 flip). Thin adapter over the kernel audit fn
// (packages/kernel/_lib/kernel-algorithms-audit.js). A4 (v6:387): "deterministic
// logic = a tested kernel algorithm, NOT prose/pseudocode for LLM execution." The
// gate binds on the packages/kernel/algorithms/manifest.json ledger +
// structural integrity (file/export/test resolve; no unregistered *.js) — NOT
// prose-scanning (the false-positive trap, rejected at design time). WARN-FIRST
// (manifest.enforcement="warn"): planned[] watchlist entries print one consolidated
// stderr ⚠ line and do NOT fail CI; structural-integrity violations on realized
// algorithms[] ARE hard errors from day one (false-positive-free; ledger authored
// clean). The Wave-3 flip is a one-line manifest data change (enforcement="error"),
// routing the watchlist into hard errors. Warnings go to stderr (not the returned
// array) so --json stdout stays clean and they never count toward totalViolations.
validators['kernel-algorithm-a4-binding'] = function () {
  const { errors, warnings } = auditAlgorithmLibrary({ rootDir: TOOLKIT });
  for (const w of warnings) {
    process.stderr.write(`  ⚠ kernel-algorithm-a4-binding: ${w.message}\n`);
  }
  return errors;
};

// ---------- main ----------

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    } else args._.push(argv[i]);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (args['list-validators']) {
  // H.3.6 (CS-2 confused-user-alex MEDIUM): respect --json flag for parity with
  // the main report path. Default human-readable; --json emits machine output.
  const names = Object.keys(validators);
  if (args.json) {
    console.log(JSON.stringify({ validators: names }, null, 2));
  } else {
    console.log(`Available validators (${names.length}):`);
    for (const name of names) console.log(`  • ${name}`);
    console.log('');
    console.log('Usage: contracts-validate [--scope name1,name2] [--json]');
  }
  process.exit(0);
}

const scope = args.scope ? args.scope.split(',').map((s) => s.trim()) : Object.keys(validators);
const unknown = scope.filter((s) => !validators[s]);
if (unknown.length) {
  console.error(`Unknown validators: ${unknown.join(', ')}`);
  console.error(`Available: ${Object.keys(validators).join(', ')}`);
  process.exit(2);
}

const results = {};
let totalViolations = 0;
for (const name of scope) {
  const v = validators[name]();
  results[name] = { count: v.length, violations: v };
  totalViolations += v.length;
}

if (args.json) {
  console.log(JSON.stringify({
    toolkit: TOOLKIT,
    totalViolations,
    perValidator: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.count])),
    violations: results,
  }, null, 2));
} else {
  // Human-readable
  console.log(`Contracts validation report — toolkit: ${TOOLKIT}`);
  console.log('');
  for (const [name, { count, violations }] of Object.entries(results)) {
    const marker = count === 0 ? '✓' : '✗';
    console.log(`${marker} ${name}: ${count} violation(s)`);
    for (const v of violations.slice(0, 10)) {
      console.log(`  • ${v.kind}: ${JSON.stringify({ ...v, kind: undefined })}`);
    }
    if (violations.length > 10) console.log(`  ... and ${violations.length - 10} more`);
  }
  console.log('');
  console.log(`Total violations: ${totalViolations}`);
}

process.exit(totalViolations === 0 ? 0 : 1);
