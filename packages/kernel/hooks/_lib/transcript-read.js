'use strict';

// Shared bounded, FIFO/symlink-safe transcript reader for Stop / PreCompact
// lifecycle hooks.
//
// The Stop and PreCompact hook stdin is a small JSON envelope
// { session_id, transcript_path, hook_event_name, ... } — NOT the conversation
// text. A hook that wants to scan the actual conversation (the produced
// enrichment, the files mentioned) must parse the envelope and read
// transcript_path. This module centralises that so every such hook reads the
// transcript identically: a TOCTOU-safe fd (a name-based stat-then-open leaves a
// swap window where transcript_path becomes a FIFO and readFileSync blocks the
// hook), a byte cap, and a newest-tail read on oversize. Mirrors
// spawn-state/drift-audit.js readTranscriptText.

const fs = require('fs');
const { withRegularFileFd } = require('../../_lib/safe-read');

const DEFAULT_MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024; // 4MB read budget

/**
 * Parse the hook stdin envelope. Never throws.
 * @param {string} rawStdin
 * @returns {object|null} the parsed envelope, or null on empty/non-JSON/non-object
 */
function parseEnvelope(rawStdin) {
  if (typeof rawStdin !== 'string' || rawStdin.length === 0) return null;
  try {
    const o = JSON.parse(rawStdin);
    return (o && typeof o === 'object') ? o : null;
  } catch { return null; }
}

/**
 * Read transcript_path text, bounded + FIFO/symlink-safe. Oversize -> the newest
 * tail within budget (drops the partial leading line). Non-regular / absent /
 * unreadable / empty path -> '' (never throws, never blocks).
 * @param {string} transcriptPath
 * @param {number} [maxBytes]
 * @returns {string}
 */
function readTranscriptText(transcriptPath, maxBytes = DEFAULT_MAX_TRANSCRIPT_BYTES) {
  if (typeof transcriptPath !== 'string' || transcriptPath.length === 0) return '';
  return withRegularFileFd(transcriptPath, (fd, stat) => {
    if (stat.size <= maxBytes) return fs.readFileSync(fd, 'utf8');
    const buf = Buffer.alloc(maxBytes);
    fs.readSync(fd, buf, 0, maxBytes, stat.size - maxBytes);
    const raw = buf.toString('utf8');
    const nl = raw.indexOf('\n');
    return nl === -1 ? '' : raw.slice(nl + 1);
  }, '');
}

/**
 * Extract the concatenated text of the LAST assistant message from transcript
 * JSONL. The produced content (e.g. an enrichment block) lives in the assistant
 * turn that just ended — scanning ONLY the last assistant message excludes the
 * injected instruction attachment (which also carries the marker template) and
 * keeps per-turn capture dedup-safe (no re-scan of prior turns).
 * @param {string} transcriptText
 * @returns {string} '' if no assistant message is found
 */
function lastAssistantText(transcriptText) {
  if (typeof transcriptText !== 'string' || transcriptText.length === 0) return '';
  const lines = transcriptText.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line || line.indexOf('"assistant"') === -1) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || o.type !== 'assistant') continue;
    const content = o.message && o.message.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text)
        .join('\n');
    }
  }
  return '';
}

module.exports = {
  parseEnvelope,
  readTranscriptText,
  lastAssistantText,
  DEFAULT_MAX_TRANSCRIPT_BYTES,
};
