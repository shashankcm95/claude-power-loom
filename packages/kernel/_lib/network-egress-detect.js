#!/usr/bin/env node

'use strict';

// Pure network-egress detection helpers for the PostToolUse:Bash audit
// (packages/kernel/observability/network-egress-audit.js). NO I/O — every
// function is a pure transform, unit-testable in isolation, so the live audit
// hook depends on THIS module rather than on the dead/unregistered
// pre-spawn-tool-mask (DIP; the tool-mask's NETWORK_BASH_PATTERNS are
// reference-only since ADR-0012 unregistered it).
//
// HONEST SCOPE (mirrors spawn-record.scrubSecrets' "coarse net, not a primary
// control"): regex host-extraction is defense-in-depth, NOT airtight — it is
// evadable via base64 / `python -c` sockets / indirected URLs. It powers an
// ADVISORY audit (observability), never a gate. Real egress *prevention* is
// ContainerAdapter-tier (network namespace / egress policy), deliberately
// out of scope per the network-egress-audit plan + ADR-0012.
//
// Known coarse-net edges (acceptable for a non-gating advisory):
//   - FALSE POSITIVES: an echo'd URL string (`echo "curl.example.com"`) or a
//     scheme-less file arg in a curl segment (`curl -o out.txt`) can be reported
//     as a host. Advisory noise, not a correctness bug.
//   - FALSE NEGATIVES: bare-host ssh without `@` (`ssh host`), and any obfuscated
//     egress (base64 / sockets / shell indirection) are not detected.

// Egress-capable command verbs (word-boundary anchored). Intentionally
// CONSERVATIVE — classic transfer/shell tools only. `gh`/`aws` are omitted on
// purpose (they egress to their own first-party APIs constantly → pure noise
// for an undeclared-host audit).
const NETWORK_EGRESS_VERBS = [
  /\bcurl\b/,
  /\bwget\b/,
  /\bnc\b/,
  /\bnetcat\b/,
  /\bssh\b/,
  /\bscp\b/,
  /\bsftp\b/,
  /\btelnet\b/,
];

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

function hasEgressVerb(command) {
  if (!command || typeof command !== 'string') return false;
  return NETWORK_EGRESS_VERBS.some((re) => re.test(command));
}

function isLoopback(host) {
  if (!host) return false;
  const h = String(host).toLowerCase();
  return LOOPBACK_HOSTS.has(h) || h === '::1' || h.endsWith('.localhost');
}

/**
 * Strip scheme + userinfo + port + path; lowercase. Returns '' if the result
 * is not a plausible host token. Pure.
 */
function normalizeHost(raw) {
  if (!raw) return '';
  let h = String(raw).trim();
  h = h.replace(/^[a-z0-9+.-]+:\/\//i, '');   // scheme:// (usually pre-stripped)
  const at = h.lastIndexOf('@');
  if (at >= 0) h = h.slice(at + 1);            // user:pass@
  h = h.split('/')[0].split('?')[0].split('#')[0];  // path / query / fragment
  h = h.replace(/^\[|\]$/g, '');               // ipv6 brackets
  h = h.replace(/:\d{1,5}$/, '');              // :port
  h = h.replace(/\.$/, '');                    // trailing FQDN dot (RFC 1123)
  h = h.toLowerCase();
  if (!h || !/^[a-z0-9._:-]+$/.test(h)) return '';
  return h;
}

/**
 * Best-effort extraction of candidate egress hosts from a command string.
 * Coarse net (see file header). Returns a de-duplicated array. Pure.
 */
function extractEgressHosts(command) {
  if (!command || typeof command !== 'string') return [];
  const hosts = new Set();

  // 1. Explicit URLs: http(s)/ftp/ssh/scp/sftp ://host...
  const urlRe = /\b(?:https?|ftp|ssh|scp|sftp):\/\/([^\s'"`|;)>]+)/gi;
  let m;
  while ((m = urlRe.exec(command)) !== null) {
    const h = normalizeHost(m[1]);
    if (h) hosts.add(h);
  }

  // 2. nc/netcat host port  (e.g. `nc evil.com 4444`)
  const ncRe = /\bn(?:c|etcat)\s+(?:-\S+\s+)*([a-z0-9][a-z0-9.-]*\.[a-z0-9.-]+)\s+\d{1,5}\b/gi;
  while ((m = ncRe.exec(command)) !== null) {
    const h = normalizeHost(m[1]);
    if (h) hosts.add(h);
  }

  // 3 + 4. Scheme-less host args, scoped PER command segment. Split on the
  //   command separators first (bounds verb scope) then use O(n) whitespace
  //   tokenization + anchored matches — NO lazy-scan/nested-quantifier
  //   interaction, so no ReDoS (code-review HIGH: the prior combined regex was
  //   O(n^2) on a long non-dotted token).
  for (const seg of command.split(/[\n;&|]/)) {
    const hasCurlWget = /\b(?:curl|wget)\b/i.test(seg);
    const hasSsh = /\b(?:ssh|scp|sftp)\b/i.test(seg);
    if (!hasCurlWget && !hasSsh) continue;

    // ssh/scp/sftp: ONLY the unambiguous `user@host` form. Avoids flagging local
    // file args (`scp report.csv host:`) or flag values (`ssh -i key.pem host`)
    // as hosts (code-review MED). Trade-off: a bare-host `ssh host` (no `@`) is
    // not detected — documented in the honest-scope header.
    if (hasSsh) {
      const atRe = /[a-z0-9_.-]+@([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+)/gi;
      let a;
      while ((a = atRe.exec(seg)) !== null) {
        const h = normalizeHost(a[1]);
        if (h) hosts.add(h);
      }
    }

    // curl/wget: first-class host args (`curl example.com`, `wget host.tld/p`).
    // Tokenize on whitespace, skip flags, anchor the host at the token start.
    if (hasCurlWget) {
      for (const tok of seg.split(/\s+/)) {
        if (!tok || tok.startsWith('-')) continue;
        const cleaned = tok.replace(/^['"]+|['"]+$/g, '');
        const hm = cleaned.match(/^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[:/]|$)/i);
        if (hm) {
          const h = normalizeHost(hm[1]);
          if (h) hosts.add(h);
        }
      }
    }
  }

  return [...hosts];
}

/**
 * Union of every trait's `network[]` from a PARSED registry object. Pure —
 * the hook reads + parses the file and passes the object in.
 */
function loadDeclaredHosts(registry) {
  const out = new Set();
  const traits = registry && registry.traits;
  if (traits && typeof traits === 'object') {
    for (const t of Object.values(traits)) {
      const net = t && t.network;
      if (Array.isArray(net)) {
        for (const host of net) {
          const h = normalizeHost(host);
          if (h) out.add(h);
        }
      }
    }
  }
  return [...out];
}

/**
 * Is `host` covered by `allowlist`? Loopback is always allowed. A host is
 * covered by an exact match OR as a subdomain (`x.api.anthropic.com` ⊆
 * `api.anthropic.com`). The `.`-prefixed endsWith prevents the
 * `evil-api.anthropic.com` / `api.anthropic.com.evil.com` bypasses.
 */
function isAllowlisted(host, allowlist) {
  if (isLoopback(host)) return true;
  if (!host || !Array.isArray(allowlist)) return false;
  const h = String(host).toLowerCase();
  return allowlist.some((a) => {
    const al = String(a).toLowerCase();
    return h === al || h.endsWith('.' + al);
  });
}

/**
 * The verdict the audit hook acts on. Pure.
 *   undeclaredHosts   — named hosts NOT covered by the allowlist (the finding)
 *   egressVerbNoHost  — an egress verb is present but no host parsed (low-confidence; log-only)
 *   allHosts          — every host parsed (diagnostics)
 */
function auditCommand(command, allowlist) {
  const allHosts = extractEgressHosts(command);
  const undeclaredHosts = allHosts.filter((h) => !isAllowlisted(h, allowlist));
  const egressVerbNoHost = hasEgressVerb(command) && allHosts.length === 0;
  return { undeclaredHosts, egressVerbNoHost, allHosts };
}

module.exports = {
  NETWORK_EGRESS_VERBS,
  hasEgressVerb,
  isLoopback,
  normalizeHost,
  extractEgressHosts,
  loadDeclaredHosts,
  isAllowlisted,
  auditCommand,
};
