---
kb_id: security-dev/protocol-and-state-abuse
version: 1
tags:
  - security
  - threat-modeling
  - concurrency
  - parsing
  - state-machine
  - foundational
  - adversarial-input
sources_consulted:
  - "CWE-367: Time-of-check Time-of-use (TOCTOU) Race Condition — MITRE, 2006-onward (current 4.x)"
  - "CWE-362: Concurrent Execution using Shared Resource with Improper Synchronization ('Race Condition') — MITRE (parent of CWE-367)"
  - "CWE-502: Deserialization of Untrusted Data — MITRE; CAPEC-586 Object Injection"
  - "CWE-22: Improper Limitation of a Pathname to a Restricted Directory ('Path Traversal') — MITRE"
  - "CWE-384: Session Fixation — MITRE; CAPEC-60 Session Replay"
  - "Matt Bishop & Michael Dilger, 'Checking for Race Conditions in File Accesses', Computing Systems 9(2):131–152, USENIX, 1996 (canonical TOCTOU paper; dissects a 1993 CERT advisory)"
  - "D. Kaminsky, M. L. Patterson, L. Sassaman, 'PKI Layer Cake: New Collision Attacks Against the Global X.509 Infrastructure', Financial Cryptography and Data Security (FC 2010), LNCS 6052 — coins 'parser differential'"
  - "L. Sassaman, M. L. Patterson, S. Bratus, M. E. Locasto, A. Shubina, 'Security Applications of Formal Language Theory', Dartmouth CS Technical Report TR2011-709, 2011 — LANGSEC; formalizes the 'parse tree differential attack'"
  - "OWASP Deserialization Cheat Sheet + OWASP Path Traversal (www-community/attacks/Path_Traversal) — canonical defenses"
related:
  - security-dev/threat-modeling-essentials
  - security-dev/auth-patterns
  - architecture/crosscut/idempotency
  - architecture/discipline/blast-radius-and-reversibility
  - architecture/discipline/error-handling-discipline
  - design-pushback/_index
status: active
---

## Summary

**Principle**: an attacker who cannot beat your business logic attacks the *layers underneath it* — the timing window between a check and a use, the parser that turns bytes into objects, and the trust you place in state you read back. Three named instincts:
**TOCTOU / race window** (CWE-367, child of CWE-362): the resource you checked is not the resource you use; the binding changed in the gap (symlink swap, filesystem race, shared-state interleave). Bishop & Dilger (1996) is the canonical treatment.
**Abuse the protocol, not the app**: malformed input, parser differentials (two parsers disagree on one byte-stream — Kaminsky/Patterson/Sassaman, "PKI Layer Cake", FC 2010), unsafe deserialization (CWE-502 / CAPEC-586), path traversal (CWE-22), and replay/reorder/fixation (CWE-384 / CAPEC-60) all bypass logic that assumed well-formed input.
**The delta is Byzantine input**: state you read *back* — a stored record, a worktree delta, a merge candidate — is hostile input wearing a trusted costume. A self-asserted idempotency key or an identity-erasing hash is injection *into your kernel*.
**Test**: for every check→use gap, can the resource change underneath you? For every byte-stream, do all consumers parse it identically? For every record you trust, is its key a re-derived content-address or a self-assertion?

## Quick Reference

**Three attack surfaces under the app, with the CWE/source for each:**

| Instinct | Core question | Named weakness | Canonical source |
|----------|---------------|----------------|------------------|
| **TOCTOU / race window** | Can the thing change between check and use? | CWE-367 (child of CWE-362) | Bishop & Dilger 1996; MITRE |
| **Abuse the protocol** | Do all parsers agree? Is the input well-formed? | CWE-502, CWE-22, CWE-384, parser differential | OWASP; PKI Layer Cake (FC 2010); LANGSEC TR2011-709 |
| **The delta is Byzantine** | Is this trusted because verified, or because stored? | (composition of above into a state machine) | derived; LANGSEC recognizer principle |

**TOCTOU — the check and the use must be atomic, or bind once:**

- The flaw: `check(R)` then `use(R)`, where another actor mutates `R` (or rebinds its name) in the window. CWE-367.
- Classic shape (CWE-367 Example 2): a setuid program calls `access(path)` then `fopen(path)`; attacker swaps `path` for a symlink to a protected file between the two calls.
- Defense: **operate on a handle, not a name** — `open()` then `fstat(fd)`, never `stat(name)` then `open(name)`. Use atomic primitives (`O_CREAT\|O_EXCL`, `openat`, `rename`, compare-and-swap, `flock`). Bind the resource once and reuse the binding.

**Abuse-the-protocol — distrust the byte-stream, not just the field values:**

- **Parser differential** (PKI Layer Cake, FC 2010): two implementations parse the *same* bytes into *different* objects. The signer sees CN `good.com\0evil.com`; the browser sees `good.com`. Defense: one canonical parser; reject ambiguity; full recognition before any action (LANGSEC).
- **Deserialization** (CWE-502 / CAPEC-586): never let the stream choose the type it instantiates; gadget chains turn `readObject` into code execution. Defense: prefer pure data formats (JSON/XML), validate against a fixed schema, allow-list types.
- **Path traversal** (CWE-22): `../../../etc/passwd` escapes the intended root. Defense: canonicalize (`realpath`) *then* verify the result still starts with the base dir — validate after resolution, not before.
- **Replay / reorder / fixation** (CWE-384 / CAPEC-60): a captured or re-ordered message is accepted twice or out of sequence. Defense: nonces, sequence numbers, idempotency keys, session re-issue on auth.

**The-delta-is-Byzantine — state read back is hostile input:**

- A record, a worktree delta, a merge candidate is *input* — apply the same distrust you apply to a network request.
- **Never trust a self-asserted key.** A stored `idempotency_key` or `content_hash` must be *re-derived from the body* and compared; a forged one is record-suppression or false-merge injection.
- **An identity-erasing hash is not an identity.** A tree-only / fork-consistent hash answers "same content?" — it must never double as "same transaction?"; conflating them is a false-merge primitive.
- Fail **closed**: an unparseable / depth-bomb / mismatched-key record is rejected, not coerced.

**Top smells:**

- `stat`/`access`/`exists` followed later by `open`/`write` on the same *name* (TOCTOU).
- Two code paths that parse the same blob with different libraries/regexes/versions (differential).
- `pickle.loads` / `readObject` / `yaml.load` / `Marshal.load` on anything that crossed a trust boundary.
- A stored field used as a trust decision without re-deriving it from the payload.
- "It came from our own store/queue/worktree, so it's safe."

## Intent

Application logic is the layer attackers reach *last*. Before that, there is a parser turning bytes into your objects, a scheduler interleaving your operations, and a store handing back state you wrote earlier. Each of those layers has its own, simpler attack surface — and each is routinely guarded only by the assumption that *the input is well-formed, the resource is stable, and stored state is trustworthy*. Those three assumptions are exactly what an adversary removes.

This doc names three instincts so a reviewer reaches for them automatically. **TOCTOU**: never assume the thing you checked is the thing you use. **Abuse-the-protocol**: never assume the byte-stream is well-formed or that all consumers read it the same way. **The-delta-is-Byzantine**: never assume state you read back is trustworthy because *you* stored it. The unifying frame is the LANGSEC thesis: any component that consumes input is a *recognizer for a language*, and security failures live in the gap between the language you think you accept and the language you actually accept — including the "language" of your own persisted state.

## The Principle

> "The product checks the state of a resource before using that resource, but the resource's state can change between the check and the use in a way that invalidates the results of the check." — CWE-367, *Time-of-check Time-of-use (TOCTOU) Race Condition*, MITRE

> "The only path to trustworthy software that takes untrusted inputs is treating all valid or expected inputs as a formal language, and the respective input-handling routines as a recognizer for that language." — Sassaman, Patterson, Bratus, Locasto, Shubina, *Security Applications of Formal Language Theory* (LANGSEC), Dartmouth TR2011-709

Reformulated as three reflexes:

- **The check and the use are not the same instant.** Anything that can change between them is an attack window (CWE-367). Either make the pair atomic, or bind the resource once and operate only on that binding.
- **Recognize fully before you act.** Parse the *whole* input against one canonical grammar and reject anything ambiguous or malformed *before* taking any action on it. A "shotgun" of scattered ad-hoc checks (the LANGSEC anti-pattern) lets a malformed input reach the action through the gaps.
- **Trust is earned by re-derivation, not by provenance.** State carries no trust just because it came from your store. Re-derive every security-relevant property (the key, the hash, the identity) from the payload and verify it; treat a mismatch as hostile.

## TOCTOU and race windows (CWE-367, CWE-362)

A TOCTOU bug is the gap between *time-of-check* and *time-of-use*. CWE-367 is a child of **CWE-362** (*Concurrent Execution using Shared Resource with Improper Synchronization*) — the general "a timing window exists in which the shared resource can be modified by another code sequence" weakness. Bishop & Dilger (1996) framed it precisely: the **binding** of a *name* to an *object* changes between two references.

- **Filesystem races / symlink swaps** (CWE-367 Examples 2–3): the program checks a path, then opens it; the attacker rebinds the path (e.g. to a symlink targeting `/etc/shadow`) in the window. The check passed on one object; the use hit another. Bishop & Dilger dissect a real 1993 CERT advisory of exactly this shape.
- **Shared-state interleavings**: two threads/processes read-modify-write a shared counter, file, or ref without a lock; the lost-update / double-spend is a CWE-362 race even with no filesystem involved.
- **Defense — atomicity or single-binding**: prefer operations that check and act in one indivisible step (`O_CREAT\|O_EXCL` create, `rename` swap, compare-and-swap ref update, `flock`/advisory lock held across the pair). When you must check then act, operate on the *handle* returned by the first call (`open` → `fstat(fd)`), never re-resolve the *name*. The substrate's terminal CAS on `refs/loom/*` is the ref-level version of this: the integrator reads a tip, folds out-of-tree, and advances the ref with a single compare-and-swap that aborts if the tip moved.

## Abuse the protocol, not the app

Most logic guards assume well-formed input. The protocol layer is where that assumption is broken.

- **Parser differentials.** "PKI Layer Cake" (Kaminsky, Patterson, Sassaman; FC 2010) *coined the term* and demonstrated >20 differentials across X.509 libraries: a CA signs a CSR whose CN one parser reads as `good.com` and another reads as an attacker domain. The generalization (LANGSEC's "parse tree differential attack", TR2011-709): whenever two consumers of one byte-stream disagree on its parse, the disagreement is exploitable. **Defense**: one canonical parser, used by every consumer; reject any input two parsers would read differently; never act on a partially-parsed input.
- **Deserialization of untrusted data (CWE-502).** Letting the byte-stream choose which type to instantiate enables *object injection* (CAPEC-586) and gadget-chain RCE. **Defense** (OWASP Deserialization Cheat Sheet): don't accept serialized objects from untrusted sources; prefer pure data (JSON/XML); never let the stream define the target type; allow-list classes; bound resource use to stop deserialization-bomb DoS.
- **Path traversal (CWE-22).** External input like `../../../etc/passwd` (or an absolute path) escapes the restricted directory. **Defense** (OWASP): canonicalize the path *first* (`realpath`), *then* verify the canonical result still begins with the intended base directory — validating the raw string before resolution is the classic bypass.
- **Malformed-state / corrupted-JSON recovery.** A truncated, depth-bombed, or schema-violating blob must fail *closed*. "Tolerant" recovery that guesses at intent is itself an attack surface (it widens the accepted language). Bound recursion depth and node count on any structured parse; on violation, reject — do not coerce.
- **Replay / reorder / fixation (CWE-384, CAPEC-60).** A captured message replayed, or messages accepted out of order, or a session not re-issued on authentication. **Defense**: nonces / sequence numbers / one-time tokens; re-issue the session identifier on privilege change; make state transitions idempotent so a replay is a no-op (see `architecture/crosscut/idempotency`).

## The delta is Byzantine input

The hardest instinct to keep: **state you read back is hostile input wearing a trusted costume.** A persisted record, a captured worktree delta, a queued merge candidate did not stop being *input* just because the producer was (probably) you. Treat the store, the queue, and the worktree as an *untrusted channel* into the consumer.

- **Self-asserted keys are forgeable.** An incoming or stored `idempotency_key` / `content_hash` must be **re-derived from the record body** and compared; accepting the asserted value lets an attacker (a) suppress a real record by colliding its key, or (b) force a false merge. The substrate's `deriveIdempotencyKey` re-derives the key from the body and rejects a self-inconsistent incoming key (`idempotency-key-mismatch`); `readByIdempotencyKey` *skips* a forged stored key rather than trusting the index. The store is not a sandbox.
- **An identity-erasing hash is not an identity.** A *tree-only / fork-consistent* hash (e.g. a `post_state_hash` over content alone) answers "same bytes?" — it is deliberately blind to *who* produced them, which is its correct job as a chain-edge join key. Using that same hash as a *transaction identity* is the false-merge primitive: two independent producers with identical output collide and one silently overwrites the other. Bind identity with a hash that *includes* the producer (`{post_state_hash, writer_spawn_id, head_anchor}`), never the bare content hash.
- **Recover fail-closed.** A record whose canonical serialization overflows a depth bound, or whose hash-fed fields are the wrong type, is *rejected* (`record-uncomputable`), not coerced into the chain. A deep-nesting field that overflows the serializer's stack is a denial-of-service / record-suppression vector; bound it and throw a controlled error.

The frame collapses to one rule: **before any state drives a decision, validate and re-derive it as if a hostile party wrote it** — because, from the consumer's side of the trust boundary, one might have.

## Substrate-Specific Examples

### INV-22 — the idempotency key is a verified content-address, never a self-assertion

The Power Loom kernel's de-dup invariant treats every incoming record as Byzantine. `appendRecord` does not trust the `idempotency_key` on the record; `deriveIdempotencyKey(record)` re-derives it from the body and rejects any self-inconsistent incoming key (`idempotency-key-mismatch`), and `readByIdempotencyKey` skips a forged *stored* key. This is "the delta is Byzantine input" made executable: the store is explicitly *not* a sandbox, so the key earns trust only by re-derivation. The same review caught the inverse: a crash-suppression DoS where a deep field overflows the serializer — closed by a depth bound (`MAX_CANONICAL_DEPTH`) and fail-closed `record-uncomputable`.

### `post_state_hash` is a chain-edge, never a transaction identity (the false-merge near-miss)

The board's CRITICAL-1 finding was an *identity-erasing-hash-as-injection* bug: using the bare `post_state_hash` (tree-only, fork-consistent, producer-blind) as the transaction-identity key would let two independent spawns with identical output collide and silently false-merge. The fix binds identity to `computeContentHash({post_state_hash, writer_spawn_id, head_anchor})` — the content hash keeps its correct job as a *join key*, and identity is a separate, producer-inclusive hash. This is the canonical "a hash that answers `same content?` must not answer `same actor?`" lesson.

### Terminal CAS on `refs/loom/*` — closing the TOCTOU window on ref advancement

The ordered integrator reads an integration tip, folds candidate deltas out-of-tree, and advances the ref with **one terminal compare-and-swap** that aborts if the tip moved underneath it. That is the ref-level TOCTOU defense: rather than `read-tip` … (work) … `blindly-write-tip` (a check→use gap a sibling could race), the advance is atomic against the observed tip. A non-singleton `git merge-base --all` (a criss-cross) is *quarantined* via a plain `update-ref`, not force-resolved — fail-closed over guess-and-coerce.

### The worktree delta is untrusted input, not a trusted artifact

A spawn's worktree delta is captured and folded as a `commit-tree`'d object under a hidden ref; it is treated as *input to validate*, never as a trusted change applied in place. The kernel never mutates the user's checked-out HEAD/working tree (an absolute-path write inside a worktree still escapes the worktree — the `p-writescope` finding — so the worktree is explicitly *not* a security sandbox). Distrusting the delta is the same instinct as distrusting a deserialized object: the producer's good intentions are not a control.

## Tensions with Other Principles

### Recognize-fully-before-acting vs robustness / Postel's Law

"Be liberal in what you accept" (the robustness principle) directly conflicts with LANGSEC's "reject anything ambiguous." **Resolution**: liberal acceptance *widens the accepted language*, which is exactly where parser differentials and malformed-state bugs live. For any input that crosses a trust boundary or drives a security decision, prefer *strict* recognition; reserve liberal parsing for low-stakes display paths. The substrate fails closed on un-computable records rather than tolerating them.

### Atomicity (TOCTOU defense) vs performance / lock contention

Holding a lock across a check→use pair, or routing every ref advance through a single CAS, costs concurrency. **Resolution**: this is a `blast-radius-and-reversibility` decision — the cost of the race (lost update, false merge, privilege escalation) is usually catastrophic and irreversible, so the atomicity overhead is justified for security-relevant state and skippable for read-only/throwaway paths.

### Fail-closed recovery vs availability

Rejecting a malformed record protects integrity but can drop legitimate-but-corrupted data. **Resolution**: fail closed at the *boundary* (don't admit the bad record into the trusted chain), but log + quarantine the input so it is inspectable and recoverable (`error-handling-discipline`) — reject is not the same as discard.

### Re-derive-don't-trust vs DRY / cost

Re-deriving keys and hashes on every read duplicates the producer's work. **Resolution**: the duplication *is the security control* — it is the difference between "trusted because stored" and "trusted because verified." A DRY shortcut that trusts the stored value reintroduces the forged-key surface.

## When to use these instincts

- **TOCTOU**: any time the code does check-then-act on a resource another actor can touch — files by name, refs, rows, counters, session state, capability grants.
- **Abuse-the-protocol**: any time bytes cross a trust boundary into a parser/deserializer — request bodies, file uploads, queue messages, stored blobs, certificates, config that external input can influence.
- **The-delta-is-Byzantine**: any time a *decision* is driven by state read back from a store/queue/worktree/cache — especially keys, hashes, identities, and "already-processed?" checks.

## When NOT to use these instincts (or apply with caveat)

- **Genuinely local, single-actor, in-process state** with no concurrency and no external influence — adding lock ceremony or re-derivation is theater. The discipline applies at *trust boundaries* and *shared resources*, not to a local variable.
- **Display-only / best-effort paths** where a malformed input degrades gracefully and drives no security decision — strict recognition can be relaxed (but never for the path that *acts* on the input).
- **Trusted, signed, immutable artifacts** whose integrity is already cryptographically guaranteed upstream — re-derivation is redundant if a verified signature already binds the content. (Verify the *signature*, then trust the bytes.)

## Failure modes when applied incorrectly

- **`access()`-then-`open()` (check the name, use the name)** — the textbook TOCTOU (CWE-367 Example 2). Counter: handle-based ops; atomic primitives.
- **Shotgun parsing** (LANGSEC) — scattered ad-hoc validation instead of one recognizer; a malformed input slips through a gap between checks. Counter: parse fully against one grammar, then act.
- **Trusting the byte-stream's declared type** — `readObject`/`pickle.loads`/`yaml.load` on untrusted data (CWE-502). Counter: pure data formats + schema + type allow-list.
- **Validate-before-canonicalize** — checking the raw path string, then resolving `../` (CWE-22 bypass). Counter: canonicalize first, verify the prefix after.
- **Trusting a self-asserted key/hash** — using a stored `idempotency_key` or `content_hash` without re-deriving it. Counter: re-derive from the body; mismatch ⇒ reject.
- **Identity-erasing hash as identity** — a producer-blind content hash used to decide "same transaction," causing false merges. Counter: bind identity with a producer-inclusive hash.
- **Tolerant recovery as an attack surface** — "best-effort" parsing of corrupted state that guesses intent, widening the accepted language. Counter: fail closed; quarantine; bound depth/width.

## Tests / verification

- **TOCTOU audit**: grep for `stat` / `lstat` / `access` / `exists` / `-e` followed by `open` / `fopen` / `write` / `unlink` on the same *name*; for each, confirm the pair is atomic or handle-based. For shared state: confirm a lock or CAS spans every read-modify-write.
- **Parser-agreement check**: for any byte-stream consumed in ≥2 places, confirm a single canonical parser; add a differential test feeding adversarial inputs (NUL bytes, overlong encodings, nested-depth bombs) and assert all consumers agree or reject.
- **Deserialization gate**: grep for `pickle.loads` / `yaml.load` (non-safe) / `readObject` / `Marshal.load` / `unserialize` on boundary-crossing data; confirm schema + type allow-list (CWE-502).
- **Traversal test**: feed `../`, `..%2f`, absolute paths, and symlinks; assert the canonicalized result is rejected unless it stays within the base dir (CWE-22).
- **Replay/idempotency test**: submit the same message twice and out of order; assert the second is a verified no-op and order violations are rejected (CWE-384; idempotency).
- **Re-derivation test**: forge a record with a *valid-looking but wrong* `idempotency_key` / `content_hash`; assert the consumer re-derives, detects the mismatch, and rejects (`idempotency-key-mismatch` / `record-uncomputable`).
- **Depth-bomb test**: feed a record whose canonical serialization exceeds the depth/node bound; assert fail-closed (`record-uncomputable`), not a stack overflow. (Note: CI runner stack < local — verify under a reduced `--stack-size`.)

## Related Patterns

- [security-dev/threat-modeling-essentials](threat-modeling-essentials.md) — STRIDE's **T**ampering / **R**epudiation / **E**levation map directly onto TOCTOU and protocol abuse; trust boundaries are where these attacks originate.
- [security-dev/auth-patterns](auth-patterns.md) — session fixation/replay (CWE-384) and the session-re-issue defense live here; auth state is a prime Byzantine-input target.
- [architecture/crosscut/idempotency](../architecture/crosscut/idempotency.md) — idempotent state transitions are the structural defense against replay/reorder, and the re-derived idempotency key is the substrate's de-dup primitive.
- [architecture/discipline/blast-radius-and-reversibility](../architecture/discipline/blast-radius-and-reversibility.md) — a race or false-merge is usually an irreversible, high-blast-radius event; that sizing is what justifies atomicity overhead and quarantine-over-coerce.
- [architecture/discipline/error-handling-discipline](../architecture/discipline/error-handling-discipline.md) — fail-closed-at-the-boundary + quarantine-not-discard is the recovery posture for malformed/Byzantine state.
- [design-pushback/_index](../design-pushback/_index.md) — proactively pushing back on "it came from our own store, so it's safe" and "tolerant parsing is friendlier" is the design-review surface for these instincts.

## Sources

Authored by multi-source synthesis of:

1. **CWE-367 — Time-of-check Time-of-use (TOCTOU) Race Condition** (MITRE), child of **CWE-362 — Concurrent Execution using Shared Resource with Improper Synchronization ('Race Condition')**. The canonical taxonomy entries for the race-window instinct; consequences and the `access()`→`fopen()` symlink-swap example are quoted from the CWE-367 page.
2. **Matt Bishop & Michael Dilger, "Checking for Race Conditions in File Accesses"**, *Computing Systems* 9(2):131–152, USENIX, 1996 — the standard academic treatment of TOCTOU as a name→object binding flaw; dissects a 1993 CERT advisory of a real instance.
3. **CWE-502 — Deserialization of Untrusted Data** (MITRE) + **CAPEC-586 Object Injection** — the gadget-chain / object-injection surface and its consequences (integrity, DoS, RCE).
4. **CWE-22 — Improper Limitation of a Pathname to a Restricted Directory ('Path Traversal')** (MITRE) + **OWASP Path Traversal** — `../../../etc/passwd` and the canonicalize-then-verify-prefix defense.
5. **CWE-384 — Session Fixation** (MITRE) + **CAPEC-60 Session Replay** — the replay / reorder / fixation family and the session-re-issue defense.
6. **D. Kaminsky, M. L. Patterson, L. Sassaman, "PKI Layer Cake: New Collision Attacks Against the Global X.509 Infrastructure"**, *Financial Cryptography and Data Security* (FC 2010), LNCS 6052 — the paper that **coined "parser differential"** and demonstrated >20 of them across the X.509 ecosystem.
7. **L. Sassaman, M. L. Patterson, S. Bratus, M. E. Locasto, A. Shubina, "Security Applications of Formal Language Theory"**, Dartmouth CS Technical Report **TR2011-709**, 2011 — the LANGSEC paper; the "input-handler as recognizer for a formal language" thesis and the formalized **parse tree differential attack**.
8. **OWASP Deserialization Cheat Sheet** + **OWASP Path Traversal** (www-community) — the canonical practitioner defenses cited for CWE-502 and CWE-22.

Each source was verified to exist during authoring via WebFetch against `cwe.mitre.org` (CWE-367/362/502/22/384, with official names and example sequences quoted verbatim) and WebSearch for the Bishop & Dilger 1996 paper (USENIX *Computing Systems* 9(2):131–152), the "PKI Layer Cake" FC 2010 paper (Kaminsky/Patterson/Sassaman), and the LANGSEC TR2011-709 report. Substrate examples are drawn from the Power Loom v3.1 kernel: the INV-22 re-derived-content-address de-dup, the `post_state_hash`-as-chain-edge-not-identity invariant (board CRITICAL-1), the terminal CAS on `refs/loom/*`, depth-bounded `canonicalJsonSerialize`, and the out-of-tree worktree-delta-as-untrusted-input model.

## Phase

Authored: kb authoring batch (v3.1-era, post-Phase-2 / Runtime Foundation), single-lens KB-gap harvest. Multi-source synthesis from 8 verifiable sources spanning MITRE CWE taxonomy (367/362/502/22/384 + CAPEC-586/60), the canonical TOCTOU paper (Bishop & Dilger 1996), the parser-differential origin paper (PKI Layer Cake, FC 2010), and the LANGSEC formalization (Dartmouth TR2011-709). Serves the HETS security-engineer / hacker lens (named instincts: TOCTOU-race-window, abuse-the-protocol-not-the-app, the-delta-is-Byzantine-input) and the code-reviewer / architect lenses (re-derive-don't-trust, recognize-fully-before-acting, atomic-check-and-use). Substrate examples emphasize the kernel's treatment of read-back state as adversarial input — the load-bearing "trusted because verified, not because stored" posture.
