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

const TOOLKIT = findToolkitRoot();
const PATTERNS_DIR = path.join(TOOLKIT, 'skills', 'agent-team', 'patterns');
const CONTRACTS_DIR = path.join(TOOLKIT, 'swarm', 'personas-contracts');
const SKILL_MD = path.join(TOOLKIT, 'skills', 'agent-team', 'SKILL.md');
const PATTERNS_README = path.join(PATTERNS_DIR, 'README.md');
const KB_MANIFEST = path.join(TOOLKIT, 'skills', 'agent-team', 'kb', 'manifest.json');
const SKILLS_BASE = path.join(TOOLKIT, 'skills');
const MARKETPLACE_BASE = path.join(process.env.HOME, '.claude', 'plugins', 'marketplaces');
const HOOKS_JSON = path.join(TOOLKIT, 'hooks', 'hooks.json');
// H.7.22 — settings-reader for the new contract-plugin-hook-deployment validator.
// hooks/scripts/_lib/settings-reader.js owns the canonical settings.json read API.
const SETTINGS_READER = path.join(TOOLKIT, 'hooks', 'scripts', '_lib', 'settings-reader.js');

// H.7.1 — `active+enforced` is the same as `active` but additionally indicates
// the pattern has a wired callsite (data flows through it). Added to close the
// "substrate-rich, call-site-poor" architect finding (CS-1/CS-2/CS-3).
const VALID_STATUSES = new Set(['proposed', 'implementing', 'observed', 'active', 'active+enforced', 'deprecated']);
const VALID_SKILL_STATUSES_LITERAL = new Set(['available', 'not-yet-authored']);

// ---------- helpers ----------

function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { fm: {}, body: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { fm: {}, body: text };
  const fm = {};
  for (const line of text.slice(3, end).split('\n')) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim().replace(/^["']|["']$/g, '');
    if (v.startsWith('[') && v.endsWith(']')) {
      v = v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }
    fm[m[1]] = v;
  }
  return { fm, body: text.slice(end + 4).trim() };
}

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

function loadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return null; }
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
    const { fm } = parseFrontmatter(text);
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
    const { fm } = parseFrontmatter(fs.readFileSync(fp, 'utf8'));
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
    const { fm } = parseFrontmatter(fs.readFileSync(fp, 'utf8'));
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
    const { fm } = parseFrontmatter(fs.readFileSync(fp, 'utf8'));
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

  // Plugin not loaded → fall back to settings.json verification
  const settingsPath = path.join(process.env.HOME, '.claude', 'settings.json');
  let settings = null;
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
