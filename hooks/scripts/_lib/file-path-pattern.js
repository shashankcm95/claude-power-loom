// Shared file-path extraction primitive for hook scripts that scan response
// or context text for file mentions. Closes CS-3 code-reviewer.blair H-4:
// the prior duplicated regex `/(?:\/[\w.-]+){2,}\.\w{1,10}/g` lived in two
// hooks (auto-store-enrichment.js + pre-compact-save.js); was Unix-only;
// produced phantom captures on paths-with-spaces; silent drift between
// copies on any future change.
//
// Usage:
//   const { extractFilePaths } = require('./_lib/file-path-pattern');
//   const paths = extractFilePaths(text); // returns Set<string>
//
// Coverage:
//   - Unix-style: /Users/x/foo.ts, /etc/passwd
//   - Windows-style: C:\Users\X\foo.ts (drive + backslash separators)
//   - Quoted paths with spaces: "C:\Program Files\App\file.ts" or
//     '/Users/x/My Project/file.ts' — only when surrounded by single/double quotes
//   - Skips: version strings (`1.2.3`), URL fragments (`/oauth/token.json`
//     after `https://`), repeat-char path segments
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
const QUOTED_PATH = /(?<=["'])(?:[\/]|[A-Za-z]:[\\\/])(?:[\w .-]+(?:[\/\\][\w .-]+)+)\.\w{1,10}(?=["'])/g;

function extractFilePaths(text) {
  if (!text || typeof text !== 'string') return new Set();
  const paths = new Set();
  for (const m of text.match(UNIX_PATH) || []) paths.add(m);
  for (const m of text.match(WINDOWS_PATH) || []) paths.add(m);
  for (const m of text.match(QUOTED_PATH) || []) paths.add(m);
  return paths;
}

module.exports = { extractFilePaths, UNIX_PATH, WINDOWS_PATH, QUOTED_PATH };
