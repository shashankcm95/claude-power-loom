# K14 write-scope violation fixtures (PR-4a)

Behavioral corpus for the K14 write-scope enforcer (`packages/kernel/_lib/k14-write-scope.js` orchestrator + the `k14-snapshot` / `k14-tail-window` / `k14-symlink-guard` leaves). Bound by `tests/unit/kernel/_lib/k14-write-scope.test.js` and the leaf tests.

## Why these fixtures exist

ADR-0010 adopts **post-detection** write-scope enforcement: the substrate does not block out-of-scope writes at write-time; K14 snapshots the filesystem at spawn-close and the resolver compares the snapshot to declared scope. These fixtures are the synthetic out-of-scope-write cases that must produce a populated `write_scope_violations[]` set (the INV-K14-PostDetectionEnforcement contract).

## Taxonomy

`schema_version: k14-violations-v1`. Each fixture declares a `violation_class` × a `snapshot_strategy`.

### Violation classes (4)

| class | meaning | expected `kind` |
|---|---|---|
| `out-of-scope` | write lands OUTSIDE the worktree root | `out-of-scope` |
| `symlink-escape` | a symlink inside the worktree resolves OUTSIDE the root (must be flagged, NOT hashed) | `symlink-escape` |
| `tail-window-late-write` | write lands after spawn-close but within (or past) the tail-window | `out-of-scope` or no-violation |
| `parent-scope-suspected` | a parent-environment process (IDE formatter / file watcher) changed a file not reachable from the spawn worktree | `parent-scope-suspected` (+ `K14_SUSPECTED_FALSE_POSITIVE` flag) |

### Snapshot sub-strategies (3) — all set `element.transport = 'snapshot'`

v3.0-alpha ships ONE transport: `snapshot` (ADR-0010 Decision 2 — no event-stream until v3.1, added behind the same transport-agnostic facade). The three sub-strategies select the within-snapshot hashing path:

| `snapshot_strategy` | path |
|---|---|
| `content-hash` | small file (<1MB): sha256 of bytes |
| `mtime+content-hash` | mtime fast-path + sha256 |
| `large-file-hash-only` | file >1MB: hash-only (no mtime shortcut) |

4 classes × 3 strategies = 12 transport-bearing fixtures; plus the F7 parent-scope false-positive case, the F19 default-empty advisory case, and the symlink-escape security fixture are all represented in the corpus.

## Placeholders

- `<<ROOT>>` → the hermetic tmp worktree root (substituted at load).
- `<<OUTSIDE>>` → a sibling dir OUTSIDE the root (for out-of-scope writes).

## Security invariants pinned

- **symlink-escape is NEVER hashed in-scope**: `expect_sha_pre_null` / `expect_sha_post_null` are `true` and `must_not_hash_target` is `true` — the target bytes must never enter the in-scope hash (CWE-22 / TOCTOU).
- **F23**: tail-window fixtures use an injectable clock (`spawn_close_wall_ms_anchor`), never the wallclock.
- No real-shaped secrets in any fixture (drift:test-instrument-tests-itself discipline).
