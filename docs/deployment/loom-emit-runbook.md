# Loom egress emit runbook (operator)

> **First-live / done-DARK.** The armed egress emit path (`emitPR` -> `gh-emit` opening a real PR) has
> been built + unit-proven but **never run against real GitHub**. Expect friction on the first run
> (like the colophon#27 dogfood). This runbook is OPERATOR-only.
>
> **Claude never runs any step here.** Deploying the broker, pinning `/etc/loom` keys, setting arm
> flags, minting the approval, and running the emit are all OPERATOR actions (task_d722450d). Claude
> builds the tooling and stages the draft; it does not touch `/etc/loom`, set arm flags, or emit.

## What this does

Opens a real (draft) GitHub PR from an approved `draft.json`, through the kernel egress chokepoint:
`approve-cli` mints a broker-signed approval, then `emit-cli` runs the armed `emitPR`. Both point at the
**same** `draft.json` so the `approvalHash` matches.

## Prerequisites (HARD — verify each before emitting)

1. **Broker deployed.** Follow [`loom-broker.md`](loom-broker.md) (`scripts/loom-broker-deploy-macos.sh`):
   a distinct broker user, sudo caller-auth, the signing key.
2. **The entire custody directory root-owned + not attacker-writable (load-bearing — the actual boundary).**
   `emitPR` reads the disposition, token, killswitch, AND verify-key with **plain `readFileSync` that
   follows symlinks with no owner check** — `resolveVerifyKey`/`resolveToken`/`resolveDisposition`/
   `isKillswitchOn` are bare reads *by deliberate parity* (`emit-pr.js:423-434`): "the custody root's
   provenance is the host-setup contract, not a per-file `O_NOFOLLOW` guard." So the boundary is the
   **directory**, not any one file — a same-uid attacker who can symlink-swap `verify.pem` can equally
   swap the token or the killswitch. Therefore:
   - Every custody path (`--verify-key`, `--token`, `--disposition`, `--killswitch`, `--approvals-dir`,
     `--gh-config-dir`) MUST live inside a **root-owned (or dedicated-operator-owned) directory that is
     NOT group/world-writable, with each file root/operator-owned**. For the broker keys specifically,
     `/etc/loom/verify.pem` + `/etc/loom/edge-verify.pem` root-owned inside a root-owned `/etc/loom`.
     Check EVERY custody path you point a flag at (not just the keys — a copied check that omits a
     sibling is the gap): `stat -f '%Su %Sp' /etc/loom /etc/loom/verify.pem <token-file> <disposition-file>
     <arm-file> <approvals-dir> <gh-config-dir>` — every owner `root`/operator, no dir group/world-writable.
   - This is a **checked precondition**, not a soft suggestion. Do not emit if any custody path fails it.
   - Follow-up (tracked, the "③.2.5b arming decision" `emit-pr.js:425` names): close it in CODE — either
     give ALL custody reads the `.approved` path's `O_NOFOLLOW`+`fstat`+uid treatment, OR add a
     custody-root ownership gate (mirroring `assertCustodyApprovalsDir`). Hardening only `verify.pem`
     would just shift the symlink attack to a sibling custody file — do it consistently or at the dir.
3. **Arm flags set** per the broker deploy (`LOOM_EDGE_REQUIRE_UID_SEP` and any world-anchor arm the
   deploy specifies). Typos fail CLOSED by design; confirm the intended value.
4. **Custody GitHub token** with write access to the target repo, in the custody token file.

## Custody layout (the paths the emit-cli flags point at)

| Flag | Points at | Holds |
|---|---|---|
| `--killswitch` | custody ARM file | the literal `ARMED` (anything else / absent => killswitch ON) |
| `--disposition` | custody disposition JSON | `{"mode":"live"}` (anything else => draft/dry) |
| `--token` | custody token file | the GitHub token (root/operator-owned, not actor-writable) |
| `--verify-key` | `/etc/loom/verify.pem` | the broker public key (root-owned — see prereq 2) |
| `--approvals-dir` | custody approvals dir | where `approve-cli` writes `<hash>.approved` (owner-checked) |
| `--gh-config-dir` | an EMPTY custody dir | an isolated `GH_CONFIG_DIR` (`emitPR` throws if absent or non-empty) |
| `--etiquette-ledger` | custody ledger file | **REQUIRED for a live emit** — the durable one-PR-per-issue backstop (the approval one-shot-consume is best-effort; this ledger refuses a re-run before the gate) |

All custody paths are OPERATOR-owned. `emit-cli` takes them ONLY from argv — never from the draft.

## Steps

1. **Prepare `draft.json`** — `{ "repo": "<owner>/<repo>", "issueRef": <n>, "diff": "<unified diff>" }`.
   The `diff` is the exact bytes to emit (`emit-cli` passes it verbatim; `emitPR` scrubs + validates).
   For the #536 dogfood, a staged draft is provided (see the arc's scratch artifacts).

2. **Mint the approval** (`approve-cli`) — run as the OPERATOR uid (distinct from the actor uid; the
   broker's caller-auth denies the actor). Sign-what-you-see on `/dev/tty`:
   ```
   node packages/kernel/egress/approve-cli.js \
     --draft draft.json --approvals-dir <approvals-dir> \
     --broker-user <broker-user> --wrapper <abs-wrapper-path> \
     --verify-key /etc/loom/verify.pem
   ```
   This writes `<approvalHash>.approved` (broker-signed, TTL-bounded — default 24h).

3. **Run the armed emit** (`emit-cli`) — same `draft.json`:
   ```
   node packages/kernel/egress/emit-cli.js \
     --draft draft.json --approvals-dir <approvals-dir> \
     --killswitch <arm-file> --disposition <disp-json> --token <token-file> \
     --verify-key /etc/loom/verify.pem --gh-config-dir <empty-dir> \
     --etiquette-ledger <ledger-file>
   ```
   - Exit 0 + `opened PR: <url>` => the real draft PR is open.
   - Exit 1 + `not emitted (<reason>)` => a fail-closed refusal; the reason names the gap
     (`awaiting-approval` sub-reasons: `sig-invalid`, `body-hash-mismatch`, `stale-or-future`,
     `no-verify-key`, `lesson-commitment-mismatch`; or `not-armed` = disposition not live / no token /
     killswitch on, with the `approvalHash` to approve).
   - Exit 2 => a usage error (a missing/malformed flag), distinct from a runtime refusal.

4. **Verify + merge.** Review the opened PR; run CI; merge at your gate. The merge is the
   world-anchored hardening signal (OQ-NS-6) — not the emit.

## Troubleshooting

- `not-armed` with an `approvalHash`: the gate is not live (check disposition `mode:"live"`, the token
  file, and the killswitch ARM file) OR you have not minted the approval for THIS exact draft. The hash
  printed is what `approve-cli` must sign.
- `awaiting-approval (stale-or-future)`: the approval TTL lapsed; re-mint.
- `awaiting-approval (sig-invalid)` right after a clean mint: check the verify-key pin (prereq 2) — a
  swapped or wrong `/etc/loom/verify.pem` is the usual cause.
- `already emitted (deduped, prior PR)`: the PR already exists; the CLI reports the prior URL (not a
  fresh open).

## Security posture

Claude never performs prereqs 1-4, minting, or the emit. The **emit-side** custody reads (`emit-pr`'s
verify-key + the token/disposition/killswitch reads) follow symlinks with no owner check by deliberate
parity. (The **approve-cli** side is the exception — its verify-key read is already hardened with
`O_NOFOLLOW` + owner validation; this posture is about the emit-side reads only.) The "③.2.5b arming
decision" to close the emit-side reads in code (all-reads-safe or a custody-root gate) is a tracked
follow-up; until
it lands, the **root/operator-owned, non-attacker-writable custody directory** (prereq 2) is the
load-bearing boundary, not optional, and not reducible to any single file.
