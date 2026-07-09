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
2. **Verify-key pinned root-owned (load-bearing — the sole mitigation for the bare verify-key read).**
   `emitPR`'s `resolveVerifyKey` is a plain `readFileSync` that **follows symlinks with no owner check**
   (`emit-pr.js:428-434`). If the `--verify-key` path (or its parent dir) is writable by the actor uid, a
   same-uid attacker can symlink-swap it to their own pubkey and self-mint a "valid" approval. So:
   - `/etc/loom/verify.pem` (broker) and `/etc/loom/edge-verify.pem` MUST be **root-owned, mode `0644`
     or stricter, inside a root-owned `/etc/loom`** — check:
     `stat -f '%Su %Sp' /etc/loom /etc/loom/verify.pem` (both owner `root`, dir not group/world-writable).
   - This is a **checked precondition**, not a soft suggestion. Do not emit if it fails.
   - Follow-up (tracked): harden `resolveVerifyKey` with `O_NOFOLLOW` + `fstat` + owner check (parity
     with the mint side's `readVerifyKeySafe`) so the pin is defense-in-depth, not the sole guard.
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

Claude never performs prereqs 1-4, minting, or the emit. The `resolveVerifyKey` symlink+owner hardening
is a tracked follow-up; until it lands, the root-owned `/etc/loom/verify.pem` pin (prereq 2) is
load-bearing, not optional.
