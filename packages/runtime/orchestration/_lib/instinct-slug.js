'use strict';

// Instinct-slug computation — the deterministic mapping from a persona
// role-brief's numbered `## Mindset` heading to its canonical machine slug.
//
// Extracted from contracts-validate.js (SRP: slug computation is a distinct
// concern from contract validation, and is shared by the validator + any
// contract-population step + its unit tests). The slug is the SAME string the
// `persona-instinct-reconcile` validator compares against `interface.instincts`,
// so every consumer MUST derive it here — never re-implement it.

// Canonical instinct slug from a `## Mindset` heading. Lowercase; strip
// apostrophes (so "didn't" -> "didnt", not "didn-t"); any run of remaining
// non-alphanumerics -> a single hyphen; trim leading/trailing hyphens. Pure +
// idempotent so the validator and the contract-population step agree exactly.
function slugifyInstinct(heading) {
  return String(heading)
    .toLowerCase()
    .replace(/['‘’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Extract the ordered instinct slugs from a role-brief's `## Mindset` section.
// Section-scoped: reads numbered `N. **Heading**` lines between the `## Mindset`
// heading and the next `## ` heading (so numbered lists in other sections — e.g.
// "Focus area" — are NOT counted). Returns [] when there is no Mindset section.
// Duplicates are PRESERVED in the returned order so a caller can detect a
// heading-collision (two distinct headings normalizing to the same slug).
function mindsetInstinctSlugs(briefText) {
  const lines = String(briefText).split('\n');
  const start = lines.findIndex((l) => /^##\s+Mindset\s*$/.test(l));
  if (start === -1) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) { end = i; break; }
  }
  const section = lines.slice(start + 1, end).join('\n');
  const slugs = [];
  const re = /^\d+\.\s+\*\*([^*]+)\*\*/gm;
  let m;
  while ((m = re.exec(section)) !== null) {
    const slug = slugifyInstinct(m[1].trim());
    if (slug) slugs.push(slug);
  }
  return slugs;
}

// Slugs that appear more than once in `slugs` (insertion order, de-duplicated).
// Non-empty => a heading-collision the brief cannot be faithfully mirrored by a
// contract (the contract carries a SET, so a self-colliding brief is ambiguous).
function duplicateSlugs(slugs) {
  const seen = new Set();
  const dupes = new Set();
  for (const s of slugs) {
    if (seen.has(s)) dupes.add(s);
    seen.add(s);
  }
  return [...dupes];
}

module.exports = { slugifyInstinct, mindsetInstinctSlugs, duplicateSlugs };
