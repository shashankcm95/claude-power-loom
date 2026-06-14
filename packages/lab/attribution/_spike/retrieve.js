#!/usr/bin/env node

// @loom-layer: lab
//
// v3.9.x #78 spike -- the MINIMAL lexical retriever for the recall-graph retrieval test.
// PURE. Given a query {repo, title} and stored worked-example nodes, rank by a repo HARD-gate
// + Jaccard over slug tokens (the query title vs the node's issue_id title-slug).
//
// LEXICAL, NOT SEMANTIC (YAGNI, VERIFY F8): the spike MEASURES whether lexical retrieval can
// discriminate the true sibling from distractors; it does NOT build the embedding retriever.
//
// THE MATCHABLE SURFACE IS THIN BY FINDING (VERIFY F1/F7): a worked-example node stores only an
// OPAQUE sha256 `problem_statement_digest` (no problem text) + a few coarse enums. So
// problem-similarity rides the `issue_id` slug + `repo` ONLY. To keep the match non-gamed
// (VERIFY F2), BOTH the query title and every node's issue_id title-slug must be produced by the
// SAME `slugifyTitle()` from the REAL upstream commit titles.

'use strict';

// Generic title words that carry no topic signal (every "Fix X" / "Add Y" shares them) -- dropped
// so the Jaccard rides the TOPIC tokens, not the verb.
const STOPWORDS = new Set([
  'fix', 'fixes', 'fixed', 'add', 'adds', 'added', 'the', 'an', 'in', 'on', 'with', 'to', 'of',
  'for', 'and', 'or', 'is', 'be', 'when', 'should', 'returning', 'returns', 'return', 'support',
  'use', 'using', 'via', 'from', 'into', 'that', 'this', 'by', 'not', 'but', 'its',
]);

// Light singularization so range/ranges and set/sets match.
function stem(t) { return t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t; }

/** Tokenize free text to a topic-token Set (lowercase, non-alnum split, drop short + stopwords, stem). */
function slugTokens(text) {
  return new Set(
    String(text == null ? '' : text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
      .map(stem)
  );
}

/** Deterministic dash-slug of a real title, for building a node's issue_id title-slug (F2). */
function slugifyTitle(title) { return [...slugTokens(title)].join('-'); }

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/** Normalize a repo string (strip a github URL prefix / .git / trailing slash) for the gate. */
function normRepo(r) {
  return String(r == null ? '' : r)
    .toLowerCase()
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
}

/** The title-slug portion of an issue_id (`<repo>__<title-slug>` convention); the whole id if no `__`. */
function issueTitleSlug(issueId) {
  const s = String(issueId == null ? '' : issueId);
  return s.includes('__') ? s.slice(s.lastIndexOf('__') + 2) : s;
}

/**
 * Score one node vs the query. `repo` is a HARD gate (different repo -> score 0); within the same
 * repo the score is Jaccard(query.title tokens, node issue_id title-slug tokens).
 * @returns {{node:object, score:number, repoMatch:boolean, shared:string[]}}
 */
function scoreNode(query, node) {
  const ref = (node && node.worked_example_ref) || {};
  const repoMatch = normRepo(query.repo) !== '' && normRepo(ref.repo) === normRepo(query.repo);
  if (!repoMatch) return { node, score: 0, repoMatch: false, shared: [] };
  const q = slugTokens(query.title);
  const n = slugTokens(issueTitleSlug(ref.issue_id));
  const shared = [...q].filter((t) => n.has(t));
  return { node, score: jaccard(q, n), repoMatch: true, shared };
}

/**
 * Rank all nodes for a query. Returns the full ranked vector (so the discrimination margin is
 * inspectable, VERIFY F3) + the top scoring (>0) node, or null if nothing in-repo overlaps.
 */
function retrieve(query, nodes) {
  const ranked = (nodes || []).map((n) => scoreNode(query, n)).sort((a, b) => b.score - a.score);
  const top = ranked.find((r) => r.score > 0) || null;
  return { top, ranked };
}

module.exports = { slugTokens, slugifyTitle, jaccard, normRepo, issueTitleSlug, scoreNode, retrieve, STOPWORDS };
