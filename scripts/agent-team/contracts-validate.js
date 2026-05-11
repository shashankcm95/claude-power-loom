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
const { findToolkitRoot } = require('./_lib/toolkit-root');
// HT.1.2 — `parseFrontmatter` consolidated to canonical helper (was 1 of 4
// inline copies post-H.8.7 chaos-H4 extraction; the inline version here
// returned `{ fm: {}, body: text }` (note `fm` field name) while canonical
// returns `{ frontmatter, body }`. Caller destructuring updated via rename
// `const { frontmatter: fm } = ...` to keep downstream `fm` usages stable.
// HT.0.9-verify code-reviewer enumerated the 4 sites.
const { parseFrontmatter } = require('./_lib/frontmatter');

const TOOLKIT = findToolkitRoot();
const PATTERNS_DIR = path.join(TOOLKIT, 'skills', 'agent-team', 'patterns');
const CONTRACTS_DIR = path.join(TOOLKIT, 'swarm', 'personas-contracts');
const SKILL_MD = path.join(TOOLKIT, 'skills', 'agent-team', 'SKILL.md');
const PATTERNS_README = path.join(PATTERNS_DIR, 'README.md');
const KB_MANIFEST = path.join(TOOLKIT, 'skills', 'agent-team', 'kb', 'manifest.json');
// H.9.12 Component C + D: kb/architecture/ root for cap-check + bidirectional
// `related:` validator. Mirror of `skills/agent-team/kb/architecture/` layout
// validated by validate-kb-doc.js (PreToolUse path scope).
const KB_ARCHITECTURE_BASE = path.join(TOOLKIT, 'skills', 'agent-team', 'kb', 'architecture');
// H.9.12 Component C: KB size cap thresholds per _PRINCIPLES.md L36
// "If we hit 50, audit before adding 51". WARN at 90% capacity; ERROR at L36 cap.
const KB_ARCHITECTURE_CAP_WARN = 45;
const KB_ARCHITECTURE_CAP_ERROR = 51;
const SKILLS_BASE = path.join(TOOLKIT, 'skills');
const MARKETPLACE_BASE = path.join(process.env.HOME, '.claude', 'plugins', 'marketplaces');
const HOOKS_JSON = path.join(TOOLKIT, 'hooks', 'hooks.json');
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

// H.9.12 Component D: bidirectional `related:` validation extended to
// kb/architecture/ tree. WARN-ONLY MODE for initial wire-in: surfaces known
// asymmetric links via stderr but does NOT increment totalViolations
// (preserves contracts-validate.js 17-baseline monotonic-non-decreasing
// invariant). Drift-note 82 captures the cohort for H.9.13 mass-fix; once
// closed, this validator flips from warn-only to hard-violation.
//
// Key-name normalization (gate code-reviewer HIGH-CR1 LIVE BUG absorption):
// listKbArchitectureFiles() returns `kbId: architecture/<subdir>/<basename>`
// matching the `related:` value format used in kb/architecture frontmatter.
// Without this, the `if (!relatedMap.has(target)) continue` guard would
// silently skip every cross-reference, making the validator a no-op.
//
// Separate function from pattern-related-bidirectional (gate architect
// HIGH-3 absorption — validator-per-concern convention per
// kb/architecture/discipline/single-responsibility.md; clean violation
// attribution; matches L188 + L214 separation pattern).
validators['kb-architecture-related-bidirectional'] = function () {
  // WARN-ONLY: violations array intentionally always empty for H.9.12.
  // H.9.13 closure flips this to hard-violation mode.
  const violations = [];
  const relatedMap = new Map();
  for (const { kbId, path: fp } of listKbArchitectureFiles()) {
    try {
      const { frontmatter: fm } = parseFrontmatter(fs.readFileSync(fp, 'utf8'));
      const related = Array.isArray(fm.related) ? fm.related : (fm.related ? [fm.related] : []);
      relatedMap.set(kbId, new Set(related));
    } catch { /* corrupt frontmatter or read error; skip — fail-soft */ }
  }
  const asymmetricLinks = [];
  for (const [kbId, related] of relatedMap.entries()) {
    for (const target of related) {
      // Skip references outside kb/architecture tree (cross-tree refs allowed)
      if (!relatedMap.has(target)) continue;
      const reverse = relatedMap.get(target);
      if (!reverse.has(kbId)) {
        asymmetricLinks.push({ from: kbId, to: target });
      }
    }
  }
  // Emit stderr warnings for visibility (institutional discipline encoding);
  // drift-note 82 cohort captured for H.9.13 mass-fix.
  if (asymmetricLinks.length > 0) {
    process.stderr.write(`  ⚠ kb-architecture-related-bidirectional (WARN-ONLY MODE per H.9.12; drift-note 82 cohort): ${asymmetricLinks.length} asymmetric link(s) — cohort for H.9.13 mass-fix\n`);
    for (const link of asymmetricLinks.slice(0, 10)) {
      process.stderr.write(`      ${link.from} → ${link.to} (no back-link)\n`);
    }
    if (asymmetricLinks.length > 10) {
      process.stderr.write(`      ... and ${asymmetricLinks.length - 10} more (see drift-note 82 for full cohort)\n`);
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
          const skillPath = path.join(SKILLS_BASE, skill, 'SKILL.md');
          if (!fs.existsSync(skillPath)) {
            violations.push({
              kind: 'available-but-missing',
              contract: name,
              skill,
              expectedPath: skillPath,
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

  // Enumerate plugin triples: (event, matcher, command-suffix)
  // Command-suffix = path after `${CLAUDE_PLUGIN_ROOT}` or after `~/.claude/`
  // (whichever comes first), to compare regardless of install location.
  const pluginTriples = [];
  for (const [event, entries] of Object.entries(pluginHooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const matcher = entry.matcher || '';
      const hooks = Array.isArray(entry.hooks) ? entry.hooks : [];
      for (const h of hooks) {
        if (h.type !== 'command' || !h.command) continue;
        const suffix = extractCommandSuffix(h.command);
        pluginTriples.push({ event, matcher, command: h.command, suffix });
      }
    }
  }

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
          `plugin should be active; full verification requires running from inside ` +
          `a Claude Code session. The deployment check below is conservative.\n`
        );
        // Continue — don't auto-pass. Settings.json verification still runs below
        // since enabledPlugins alone could mask a corrupted cache or failed install.
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
// occurrence of `hooks/scripts/`. Falls back to the full command if not
// found (still allows comparison, just less robust).
function extractCommandSuffix(command) {
  const m = command.match(/hooks\/scripts\/(.+)$/);
  return m ? m[1] : command;
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
const SCHEMAS_DIR = path.join(TOOLKIT, 'swarm', 'schemas');
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
      '(this is normal on fresh checkout / minimal install; run scripts/agent-team/refresh-plugin-schema.sh to vendor)\n'
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
      'Run scripts/agent-team/refresh-plugin-schema.sh to refetch.\n'
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
