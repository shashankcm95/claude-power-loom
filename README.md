# Power Loom

> **A deterministic state-management substrate for stochastic (LLM) agents.**
>
> A loom imposes deterministic structure on stochastic threads. **Power Loom** does the same for agentic coding: it wraps non-deterministic agent execution in **transaction boundaries** and **pure-function verification gates**, so an agent's file edits become **atomic, replayable, and reversible** — the way a database transaction manager wraps unreliable writes, or a CI gate wraps an unreliable release.
>
> **It makes long-horizon agent failures cheap, observable, and reversible. It does _not_ make the underlying LLM smarter.** That honesty is the project's design anchor.

[![CI](https://github.com/shashankcm95/claude-power-loom/actions/workflows/ci.yml/badge.svg)](https://github.com/shashankcm95/claude-power-loom/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![Phase](https://img.shields.io/badge/substrate-v3.8%20(un--darken%20%2B%20graduation%20gates)-orange.svg)](docs/ROADMAP.md) [![Plugin](https://img.shields.io/badge/Claude_Code-plugin_3.8.0-orange.svg)](.claude-plugin/plugin.json)

---

## What it is

Power Loom is an **agent runtime**: the layer that *executes* and *constrains* a coding agent's effects, separate from the layer that generates them. Concretely, it treats every agent spawn as a **transaction**:

```
spawn → isolated worktree → filesystem delta → verify (pure gates) → promote or reject → record
```

The unit of truth is the **validated, in-scope filesystem delta** — not the LLM's prose, and not the file's current bytes. LLM trajectories are non-deterministic by construction and recoverable by re-sampling; the substrate's job is to make sure that whatever a spawn *did* is captured, checked against external ground truth, and either committed atomically or rolled back cleanly.

### The problem it solves

Claude Code's native `isolation: "worktree"` is a **git mechanism**, not a filesystem sandbox: a sub-agent can write anywhere the user account can reach (the parent project, sibling repos, `/tmp`), and a `Bash` call bypasses tool-layer hooks entirely. Power Loom's kernel **detects out-of-scope writes post-hoc**, treats them as policy violations, captures every spawn's effects in a **replayable envelope**, and can **roll a promotion back** via a reverse-cherry-pick journal.

### What it is *not*

Honest positioning matters here, so the boundaries are explicit:

- **Not durable execution.** Workflow continuity through process death (Temporal, LangGraph) is a different layer. Power Loom contains the *effects* of non-deterministic edits; it does not resume workflows.
- **Not an output-scoring reliability vendor.** It does not grade LLM outputs after the fact (the Cleanlab category). Its gates are pure functions over filesystem state, in the *blocking* path.
- **Not a fix for long-horizon coding.** The long-horizon-coding gap is model-capability-bound. Power Loom makes those failures *recoverable and cheap*, not *less frequent*. The thesis that "as models improve, the bottleneck shifts from generation to governance/containment" is a **wager the project is built on — not a claim it has proven.**

### The four pillars

Every primitive and axiom must serve at least one:

1. **Filesystem-delta-as-truth** — the in-scope delta is the unit of state; out-of-scope writes are violations; transactions are verifiable by replaying inputs.
2. **Byzantine treatment of the LLM** — both its *outputs* and its *inputs* (web content, retrieved docs, tool results) are untrustworthy by construction and verified against external ground truth.
3. **Deterministic, auditable execution** — spawns are replayable from a recorded envelope; reputation enters a spawn only via an explicit snapshot.
4. **Role-separation by capability, not discipline** — roles are enforced by *injecting a capability subset* into a spawn, not by asking a persona to behave.

For the full rationale see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). For the design record itself, see [`packages/specs/rfcs/v6-substrate-synthesis.md`](packages/specs/rfcs/v6-substrate-synthesis.md) and the ADRs under [`packages/specs/adrs/`](packages/specs/adrs/).

---

## Install

**Canonical — Claude Code plugin marketplace:**

```bash
/plugin marketplace add shashankcm95/claude-power-loom
/plugin install power-loom@power-loom-marketplace
```

Restart Claude Code (or `/reload-plugins`) afterward. Hook scripts then resolve via `${CLAUDE_PLUGIN_ROOT}`.

**Legacy — `install.sh`** (shell-only setup, CI provisioning, or environments without `/plugin`):

```bash
git clone https://github.com/shashankcm95/claude-power-loom.git ~/Documents/claude-toolkit
cd ~/Documents/claude-toolkit && ./install.sh --all
```

The legacy path wires hooks directly into `~/.claude/settings.json`; it works but doesn't get `/plugin update` integration. Full reference: [`docs/install/`](docs/install/). Migrating legacy → plugin: `bash bin/migrate-to-plugin.sh`.

> **Repo vs plugin name**: the GitHub repo is `claude-power-loom` (the `claude-` prefix aids ecosystem discovery); the plugin is `power-loom` (Anthropic marketplace convention). The repo was formerly `claude-skills-consolidated`; GitHub auto-redirects old URLs.

### See it run (5 seconds, hermetic)

The flagship transaction loop — spawn deltas staged as candidates, folded out-of-tree, recorded in the trust ledger, and merged only by a human — has a runnable, narrated demo that touches nothing outside a temp dir:

```bash
node examples/delta-promote-demo.js
```

CI re-runs it on every push. The documented workflow (and how to opt in for real) is [`docs/delta-promote-walkthrough.md`](docs/delta-promote-walkthrough.md).

---

## Status

Distributed as a **Claude Code plugin**, now at **v3.8.0**. The v3.x line is the kernel + runtime + Evolution Lab substrate; v3.1.0 was its first published cut (the prior published line was v2.9.x). Nine phases are complete:

| Phase | What shipped | Closed |
|---|---|---|
| Phase 1-alpha | the pure kernel transaction loop — 11 primitives atop the K5 validators | 2026-06-02 (with v3.1) |
| v3.1 — Runtime Foundation | the persona/capability runtime (R1–R4 contracts + reconciliation), the shadow-default spawn-close transaction loop, INV-22 idempotency | 2026-06-02 |
| v3.2 — Runtime Decomposition | the decomposition + verification tier (R6–R12), the K11 algorithm library (A4-binding) | 2026-06-04 |
| v3.3 — Evolution Lab Foundation | the first Layer-3 code: the un-darkening + the E1 negative-attestation store | 2026-06-04 |
| v3.4 — Evolution Lab Full | the complete advisory loop in shadow: verdict-attestation → E4 reputation → A6 snapshot → E11 breaker → persona-selection consumers | 2026-06-07 |
| v3.5 — Memory Manage-Layer | the manage layer over memory + the typed causal-edge graph (destructive ops recorded-not-executed) | 2026-06-08 |
| v3.6 — Destructive-manage enforcement | **leave-shadow event #1**: a human-approved proposal → a committed kernel TOMBSTONE/SUPERSEDE (opt-in, breaker-bounded) | 2026-06-10 |
| v3.7 — Delta-promote activation | **the trust system's first producer**: the reject-event ledger at the integrator + the documented, demo-proven human-gated promote workflow | 2026-06-11 |
| v3.8 — Un-darken + binding graduation gates | the advisory/recall loops un-darkened (the reject-event **breaker source**, route-decide dictionary, recall-suppression view, verdict-routine convention) + the USER-binding pre-kernel-gate set: E11 graduation gates (dedup-by-subject + source-validation + hysteresis latch), A6 snapshot-provenance (the witness ledger), and the OQ-21 rung-2 real-LLM calibration — all **shadow**, the gating consumer is v3.9 | 2026-06-12 |

**Next:** **v3.9 is the first live beta** (human-gated; routes around the ContainerAdapter) — it wires the fail-closed gating consumers the v3.8 machinery exposed and is the named decision point for whether human-gated promotion has a real consumer ([RFC §10](packages/specs/rfcs/2026-06-04-enforcing-vs-advisory-identity.md)). The full narrative lives in [`docs/ROADMAP.md`](docs/ROADMAP.md); what is dark/flag-gated and why in [`docs/ACTIVATION-LEDGER.md`](docs/ACTIVATION-LEDGER.md).

Kernel-primitive status (details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#kernel-primitives)):

| Live | Dormant | Advisory | Dropped / Retired |
|---|---|---|---|
| K1 K2 K3 K4 K7 K9 K10 K11 K13 K14 + the reject-event ledger | **K3.b** (no production importer yet; CI-asserted) | **K12** (layer-boundary lint — warns, never blocks) | **K6** (retired v3.2) · **K8** (dropped — [ADR-0012](packages/specs/adrs/0012-capability-enforcement-is-static-not-runtime-injected.md)) |

> ⚠️ Early major line. The v3.x kernel surface changes incompatibly with v2.9 readers (the MAJOR bump — [ADR-0009](packages/specs/adrs/0009-major-bump-rationale.md)), and the kernel schema keeps evolving across v3.x minors — pin a version if you depend on it.

---

## How the substrate is layered

Power Loom is a microkernel architecture in three layers (a fourth, `adapters` — the ContainerAdapter sandbox boundary — is a reserved Track-2 path that does not yet exist on disk):

| Layer | Path | Responsibility | Trust |
|---|---|---|---|
| **Kernel** | `packages/kernel/**` | Deterministic, portable, minimal. Hooks + validators + recall-CLI + spawn-state + the transaction primitives. | **Pure-function gates only — no LLM in the blocking path.** |
| **Runtime** | `packages/runtime/**` | The agent team (HETS): personas, decomposition disciplines, capability traits, contracts. | Kernel gates (blocking) + advisory checks (non-blocking, audit-logged). |
| **Evolution Lab** | `packages/lab/**` | Adaptive cognition — measures the substrate's own quality and feeds reputation. | Advisory only; outputs reach the kernel **only** through an explicit reputation snapshot. |

The **dependency rule** points inward: an inner layer may never import an outer one (`kernel` imports nothing outward; `runtime` may import `kernel`). This is enforced by convention + per-file `// @loom-layer:` markers + the **`K12` advisory lint** — downgraded from mandatory after six months on the spike branch produced zero observed cross-layer drift (the `_lib/` extraction pattern keeps the tree acyclic by construction).

The kernel boundary is **Axiom 2**: *kernel = pure deterministic functions; user-space = agent spawns; interface = filesystem deltas + contract-conformant text.* It forbids LLMs writing to kernel paths, kernel code calling LLMs in a verification gate, and agents bypassing the interface. The Ten Axioms (A1–A10) are stated in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#the-ten-axioms).

---

## Enforced vs. best-effort — the honesty line

The substrate has a hard floor and a soft ceiling, and the docs never blur them:

- **🔒 Enforced (deterministic).** Hooks and validators are pure logic — they fire every time, no LLM interpretation. Read-before-edit, secret-literal blocking, config-guard, path canonicalization, write-scope detection, serial-spawn enforcement. If a behavior *must* always happen, it is a hook.
- **🌓 Shadow / opt-in (human-gated).** The deep-substrate delta path — the spawn-close resolver, the ordered integrator, the v3.7 reject-event ledger — RECORDS provenance but does **not** gate. It stays in shadow unless you set a `LOOM_*` flag (default OFF), never writes your checked-out HEAD (all assembly is out-of-tree), and a human reviews + merges the staged `loom/integration` / `loom-promote/*` branch. It is a *capability*, not an enforced behavior — see [ARCHITECTURE §6](docs/ARCHITECTURE.md#6-what-is-enforced-and-where) and the [activation ledger](docs/ACTIVATION-LEDGER.md).
- **📜 Best-effort (instruction-following).** Rules, skills, and agent prompts shape Claude's reasoning but **can be skipped** by the LLM under context pressure. They are ideals, not guarantees.

The value is concentrated in the enforced layer. The runtime adds *verifiable* multi-agent coordination on top: even when an individual agent skips an instruction, its output is checked against a per-persona contract, so the **team-level verdict is deterministic**. See [Honest disclosures](#honest-disclosures).

---

## Documentation

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — the substrate model: layers, the Ten Axioms, the transaction loop, every kernel primitive, and the threat model.
- **[docs/ROADMAP.md](docs/ROADMAP.md)** — the phase-by-phase record (Phase 0 → v3.7 ✓, each with its phase-close sign-off) and what comes next (v3.8 → v3.9 first live beta).
- **[docs/ACTIVATION-LEDGER.md](docs/ACTIVATION-LEDGER.md)** — every built-but-dark / flag-gated capability, its consumer, and its activation fate. The honest inventory.
- **[docs/delta-promote-walkthrough.md](docs/delta-promote-walkthrough.md)** — the human-gated promote workflow, end to end (with the runnable demo).
- **[docs/README.md](docs/README.md)** — the full documentation index.

Machinery references: **[Hooks](docs/hooks/)** · **[Library memory organizer](docs/library.md)** · **[Install](docs/install/)** · **[Commands](docs/reference/commands.md)** · **[Rules](docs/reference/rules.md)** · **[Project structure](docs/reference/project-structure.md)** · **[Stability commitment](docs/reference/stability-commitment.md)**.

---

## Honest disclosures

What this substrate does **not** do:

- ❌ **Does not make the LLM better at long-horizon coding.** It makes failures cheap, observable, and reversible. That is the whole pitch; anything more would be an overclaim.
- ❌ **Does not guarantee Claude follows the markdown rules.** Those are advisory text. *Specific* behaviors are hook-enforced and deterministic (read-before-edit, vague-prompt detection, config-guard, pre-compact checkpoint); the rest ride on best-effort instruction-following.
- ❌ **Does not give agents continuous LLM memory across sessions.** Each spawn is a fresh call. The substrate maintains *per-identity reputation* on disk (trust scores, history) — that is persistence of a record, not of the model's memory.
- ⚠️ **Is local-trust-anchored.** The v3.x line does **not** defend against hostile same-uid filesystem tampering (e.g. back-dating a record's mtime to hide it from a rate window) — those residuals are named in the [threat model](docs/ARCHITECTURE.md#threat-model--the-human-gated-delta-path) and close only at the Track-2 **ContainerAdapter** sandbox.
- ⚠️ **Ships some code ahead of its consumer — deliberately, and tracked.** Producers may land one phase before the thing that reads them (e.g. the v3.7 reject-event ledger's breaker **source** landed in v3.8 as a shadow read; its fail-closed **gating** consumer arrives in v3.9). Every such edge is named in the [activation ledger](docs/ACTIVATION-LEDGER.md) rather than implied to be live.

These are intentional architecture decisions, not gaps to fix.

---

## Project layout

- `packages/kernel/` — the Loom Kernel: `hooks/` + `validators/` + `recall/` + `spawn-state/` + `_lib/` (transaction primitives), `hooks.json`, `schema/`.
- `packages/runtime/` — the Loom Runtime: HETS orchestration, persona contracts, identity registry.
- `packages/lab/` — the Evolution Lab: attribution, reputation, circuit-breaker, manage-proposal, verdict-attestation.
- `packages/specs/` — the design record: `rfcs/`, `adrs/`, `plans/` (living per-wave docs), `research/`.
- `packages/skills/` — the instruction-following layer SOURCE: `rules/` (always-on guidance), `commands/` (slash commands), `library/` (skills).
- `agents/` — the Agent-tool persona definitions (architect, code-reviewer, hacker, …).
- `examples/` — runnable demos (`delta-promote-demo.js`). `tests/` — the unit + E2E suites.

Full walkthrough: [`docs/reference/project-structure.md`](docs/reference/project-structure.md).

## License

MIT — see [LICENSE](LICENSE).

## Attribution

Builds on community plugins and patterns that came before it. See [ATTRIBUTION.md](ATTRIBUTION.md) and [`docs/development/attribution.md`](docs/development/attribution.md).

---

**Repository**: <https://github.com/shashankcm95/claude-power-loom>
