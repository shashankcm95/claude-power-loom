---
pattern: content-addressed-refs
status: active
intent: Reference docs by content-addressed pointer; same content always produces same hash; cross-project reuse is free.
related: [shared-knowledge-base, prompt-distillation, kb-scope-enforcement]
---

## Summary

Refs are `kb:<id>` (current version) or `kb:<id>@<short-hash>` (snapshot-pinned). Hash = SHA-256 of doc body. Same content always produces the same hash, so two projects with the same `swift-development` doc share storage and reasoning automatically. Hash mismatch on resolve = the doc has changed since the ref was written; the resolver rejects loudly.

## Intent

Filesystem paths are unstable references — files move, get renamed, get edited in-place. Content-addressed refs are stable: the hash IS the content's identity. Borrowed wholesale from git's object database. The user-facing benefit: spawn prompts carry 8-char hashes, not 1000-token doc bodies.

## Components

- **Hash computation**: `crypto.createHash('sha256').update(body, 'utf8').digest('hex')` over the doc body (frontmatter excluded so metadata edits don't perturb the hash).
- **Ref syntax**: `kb:<topic>/<doc>` (current) or `kb:<topic>/<doc>@<8-char-hash>` (pinned). The 8-char prefix is enough collision resistance for human-scale KBs (<10^9 docs).
- **Resolution**: `kb-resolver resolve kb:web-dev/react@a3f1` → JSON header (`status`, `hash`, `bodyBytes`) followed by `---BODY---` separator and the body. Status values: `ok`, `not_found`, `hash_mismatch`.
- **Snapshot semantics**: refs in spawn prompts come from the run-state snapshot (`run-state/<run-id>/kb-snapshot.json`), which is the manifest at run start. Mid-run KB edits don't change what the snapshot says.

## Failure Modes

1. **Hash collisions** — astronomically unlikely at SHA-256 + 8-char prefix, but possible. Counter: collisions are detectable at `scan` time; if two distinct docs map to the same shortHash, extend prefix to 12 chars for affected entries.
2. **Off-toolkit refs** — agent constructs a ref like `kb:foo/bar` without checking the catalog. Counter: `resolve` returns `not_found` cleanly; agents must handle this rather than pretending the resolution succeeded.
3. **Body-only hashing means version-bumps don't change the hash** — if you edit only the `version:` frontmatter, hash stays the same. By design (metadata is not the content), but worth documenting.
4. **Resolver invocation overhead** — `node kb-resolver.js resolve ...` per doc is ~30ms. Mitigate by batching: agent loads the snapshot once, resolves all needed refs at the start of its turn.

## Validation Strategy

Stress-test scenarios:
- Compute hash of doc, edit one character, verify hash changes
- Compute hash of doc, change only frontmatter `version`, verify hash unchanged
- Plant two docs with deliberately-identical bodies under different `kb_id`s; verify their hashes match (proving content-addressing works)
- Construct a `kb:nonexistent/doc` ref; verify resolver returns `not_found`, not crash
- Pin a ref to current hash, edit doc, retry resolve; verify `hash_mismatch` status

## When to Use

- All KB references in spawn prompts (refs by default; inline content is the exception)
- Cross-run analysis where you need to verify "this agent saw the same docs as that agent"
- Any time you want reproducibility — the run-state snapshot lets you replay an old run with the exact same KB

## When Not to Use

- Pre-resolution caching is unsafe across long time windows (KB drift). Always re-validate hashes when reads happen >24h after the snapshot was taken.
- Unstructured user-facing content (the resolver is for engineering KB, not for user-visible documentation).

## Related Patterns

- [Shared Knowledge Base](shared-knowledge-base.md) — what gets addressed
- [Prompt Distillation](prompt-distillation.md) — refs are the smallest possible distillation: 8 hex chars instead of full doc
