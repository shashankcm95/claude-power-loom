// Shared file-path extraction primitive for hook scripts that scan response
// or context text for file mentions. Closes CS-3 code-reviewer.blair H-4:
// the prior duplicated regex `/(?:\/[\w.-]+){2,}\.\w{1,10}/g` lived in two
// hooks (auto-store-enrichment.js + pre-compact-save.js); was Unix-only;
// produced phantom captures on paths-with-spaces; silent drift between
// copies on any future change.
//
// Usage:
//   const { extractFilePaths } = require('../_lib/file-path-pattern');
//   const paths = extractFilePaths(text); // returns Set<string>
//
// Coverage:
//   - Unix-style: /Users/x/foo.ts, /etc/passwd
//   - Windows-style: C:\Users\X\foo.ts (drive + backslash separators)
//   - Quoted paths with spaces: "C:\Program Files\App\file.ts" or
//     '/Users/x/My Project/file.ts' — only when surrounded by single/double quotes
//   - Skips: version strings (`1.2.3`), URL fragments (`/oauth/token.json`
//     after `https://`), repeat-char path segments
//   - **NEW (substrate hygiene 2026-05-27)**: filters substrate-internal
//     paths via `isSubstrateInternalPath()` — see below for the deny list.
//     Closes the "instrument observing itself" bug class: the auto-loop
//     was bumping signals on its own state files (session jsonl transcripts,
//     self-improve counters, checkpoint logs, library volumes) which
//     polluted the queue with substrate-state observations rather than
//     project workflow signals — the auto-loop's actual intent.
//
// What we INTENTIONALLY don't try to catch:
//   - Unquoted paths-with-spaces — ambiguous in plain prose; would produce
//     more false positives than true positives
//   - Network paths (`\\server\share`) — not relevant to current usage
//   - Paths shorter than 2 segments (e.g., bare `./foo.ts`) — too noisy
//
// Tested against the file-path shapes that appear in actual hook input
// streams; not a general-purpose path parser.

const UNIX_PATH = /(?:\/[\w.-]+){2,}\.\w{1,10}/g;
const WINDOWS_PATH = /[A-Za-z]:\\(?:[\w.-]+\\)+[\w.-]+\.\w{1,10}/g;
// Quoted: ["'] capture-target ["'] — only matches the path between matched quotes
// Path inside quotes can contain spaces.
const QUOTED_PATH = /(?<=["'])(?:[/]|[A-Za-z]:[\\/])(?:[\w .-]+(?:[/\\][\w .-]+)+)\.\w{1,10}(?=["'])/g;

// Substrate-internal path patterns — these are toolkit-managed state files,
// NOT project workflow signals. The auto-loop's intent (per
// `packages/specs/architecture-substrate/auto-loop-infrastructure.md`)
// is to detect project-workflow patterns: files the user keeps editing,
// commands they keep running. Substrate-state files fail that test by
// definition — they're the substrate observing its own bookkeeping.
//
// Each pattern matches a path-tail (anchored to substring); the leading
// `~/.claude/` or absolute equivalent is implicit since these patterns
// only match substrings that contain `.claude/`.
//
// Curation discipline: only patterns where >90% of mentions are
// substrate-state, not user-edited content. KEEP TRACKING:
//   - `~/.claude/rules/**/*.md` (user-authored rules)
//   - `~/.claude/skills/**/*` (user-authored skills)
//   - `~/.claude/agents/**/*` (user-authored agents)
//   - `~/.claude/MEMORY.md`, `~/.claude/settings.json` (user state)
//   - `~/Documents/**`, `~/projects/**`, etc. (project source)
const SUBSTRATE_INTERNAL_PATTERNS = [
  /\.claude\/projects\/[^/]+\/[^/]+\.jsonl$/, // Claude Code session transcripts
  /\.claude\/checkpoints\//,                  // Auto-loop state logs + observations.log
  /\.claude\/self-improve-counters\.json$/,   // The counter file itself
  /\.claude\/agent-identities\.json$/,        // HETS identity state
  /\.claude\/agent-patterns\.json$/,          // Pattern-recorder state
  /\.claude\/run-state\//,                    // Substrate run state
  /\.claude\/session-state\//,                // Session state
  /\.claude\/[^/]*-log\.jsonl?$/,             // Various hook logs at .claude/ root
  /\.claude\/library\/sections\/.*\/volumes\//, // Library volumes (substrate-managed)
  /\.claude\/library\/library\.json$/,        // Library catalog
  /\.claude\/library\/_backups\//,            // Library backup directories
  /\.claude\/library\/reader-profile\.md$/,   // Library profile (substrate-managed)
];

/**
 * Return true if the given path is a substrate-internal state file that
 * should be filtered out of auto-loop signal extraction. See
 * `SUBSTRATE_INTERNAL_PATTERNS` for the curated deny list.
 *
 * @param {string} path Absolute or home-relative file path
 * @returns {boolean} true if path matches any substrate-internal pattern
 */
function isSubstrateInternalPath(path) {
  if (!path || typeof path !== 'string') return false;
  for (const pattern of SUBSTRATE_INTERNAL_PATTERNS) {
    if (pattern.test(path)) return true;
  }
  return false;
}

/**
 * Extract file paths from arbitrary text. Returns a deduplicated Set so
 * the same path mentioned multiple times in the input only counts once.
 * Combines three patterns (Unix, Windows, Quoted-with-spaces) — see the
 * header comment for what each catches and what's intentionally skipped.
 *
 * Substrate-internal paths (session transcripts, auto-loop state, library
 * volumes, etc.) are filtered via `isSubstrateInternalPath()` — see the
 * `SUBSTRATE_INTERNAL_PATTERNS` deny list for rationale.
 *
 * @example
 *   extractFilePaths('See /Users/x/foo.ts and "C:\\My Files\\bar.js"')
 *   // → Set { '/Users/x/foo.ts', 'C:\\My Files\\bar.js' }
 *
 * @example
 *   // Substrate-internal paths get filtered:
 *   extractFilePaths('See /Users/x/.claude/projects/p1/abc.jsonl and /Users/x/src/foo.ts')
 *   // → Set { '/Users/x/src/foo.ts' }   // session transcript excluded
 *
 * @param {string} text Arbitrary text (typically conversation or hook input)
 * @returns {Set<string>} Deduplicated set of detected file paths (empty Set on falsy/non-string input)
 */
function extractFilePaths(text) {
  if (!text || typeof text !== 'string') return new Set();
  const paths = new Set();
  const addIfRelevant = (m) => {
    if (!isSubstrateInternalPath(m)) paths.add(m);
  };
  for (const m of text.match(UNIX_PATH) || []) addIfRelevant(m);
  for (const m of text.match(WINDOWS_PATH) || []) addIfRelevant(m);
  for (const m of text.match(QUOTED_PATH) || []) addIfRelevant(m);
  return paths;
}

// HT.1.9: pruned speculative regex constants (UNIX_PATH, WINDOWS_PATH,
// QUOTED_PATH) from module.exports — verified 0 external consumers; used
// internally only by extractFilePaths (lines 51-53). Constants remain as
// module-scope `const` for internal use; only `extractFilePaths` is the
// public API.
//
// 2026-05-27 substrate-hygiene: `isSubstrateInternalPath` exported so tests
// can verify the deny list independently; substrate-meta callers (e.g.,
// future telemetry validators) can also reuse it without re-deriving.
module.exports = { extractFilePaths, isSubstrateInternalPath };
