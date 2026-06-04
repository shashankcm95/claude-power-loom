# Power Loom

> **A deterministic state-management substrate for stochastic (LLM) agents.**
>
> A loom imposes deterministic structure on stochastic threads. **Power Loom** does the same for agentic coding: it wraps non-deterministic agent execution in **transaction boundaries** and **pure-function verification gates**, so an agent's file edits become **atomic, replayable, and reversible** — the way a database transaction manager wraps unreliable writes, or a CI gate wraps an unreliable release.
>
> **It makes long-horizon agent failures cheap, observable, and reversible. It does _not_ make the underlying LLM smarter.** That honesty is the project's design anchor.

[![CI](https://github.com/shashankcm95/claude-power-loom/actions/workflows/ci.yml/badge.svg)](https://github.com/shashankcm95/claude-power-loom/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![Phase](https://img.shields.io/badge/substrate-v3.3%20(evolution%20lab%20foundation)-orange.svg)](docs/ROADMAP.md) [![Plugin](https://img.shields.io/badge/Claude_Code-plugin-orange.svg)](.claude-plugin/plugin.json)

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

## Status

It is distributed as a **Claude Code plugin**, now at **v3.3.0** — the **v3.x kernel + runtime + Lab substrate** (v3.1.0 was the first published cut; the prior published line was v2.9.x).

**Four phases are complete: Phase 1-alpha (the pure kernel transaction loop), v3.1 (Runtime Foundation), v3.2 (Runtime Decomposition), and v3.3 (Evolution Lab Foundation — Wave 0 + E1).** Phase 1-alpha shipped **11 kernel primitives** (atop the pre-existing `K5` validators; sub-PRs `#167`–`#175`, all merged). **v3.1** then built the first runtime layer on top: the persona/capability runtime (**R1–R4** two-tier contracts + the agent.md↔contract reconciliation validator), the live shadow-default **spawn-close transaction loop**, and **INV-22** in-substrate idempotency (`#179`–`#200`). **v3.2** added the **decomposition + verification tier** (R6–R12) + the **K11** algorithm library with the **A4-binding gate enforcing**, phase-closed 2026-06-04 (`#214`–`#237`). **v3.3** lit the first **Layer-3 (Evolution Lab)** code — the **un-darkening** (`decompose-run` writes an outbox → the Lab **E1 negative-attestation** ingest reads it; dogfood-proven a real spawn drives it end-to-end) + the **E1** store, phase-closed 2026-06-04 (`#240`); RESHAPED by a cumulative-coherence pass to Wave 0 + E1 (E2/E3/E4 → v3.4). Both the decomposition tier and E1 ship **inert** (no production hook trigger yet — that's v3.4). Kernel-primitive status:

| Live | Dormant | Advisory | Dropped / Deferred |
|---|---|---|---|
| K1 K2 K3 K4 K7 K9 K10 K13 K14 | **K3.b** · **K6** (shipped v3.1) | **K12** (layer-boundary lint) | **K8** (dropped — [ADR-0012](packages/specs/adrs/0012-capability-enforcement-is-static-not-runtime-injected.md)) · K11 → v3.2 · K2.c → v3.4 |

"Dormant" = the code ships with **no production importer yet** (a CI gate enforces it) — for K6, the reconciliation validator does its own containment check, so K6 awaits a v3.2+ runtime consumer. "Advisory" = it **warns, never blocks**. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the phase-by-phase plan and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#kernel-primitives) for what each primitive does.

> ⚠️ Early major release. **v3.1.0** is the first published cut of the v3.x kernel; its surface changes incompatibly with v2.9 readers (the MAJOR bump — see [ADR-0009](packages/specs/adrs/0009-major-bump-rationale.md)). Expect the kernel schema to keep evolving across v3.x minors as runtime consumers (v3.3+) land — pin a version if you depend on it.

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

---

## How the substrate is layered

Power Loom is a microkernel architecture in three layers (a fourth, `adapters`, is a v3.5+ convention path):

| Layer | Path | Responsibility | Trust |
|---|---|---|---|
| **Kernel** | `packages/kernel/**` | Deterministic, portable, minimal. Hooks + validators + recall-CLI + spawn-state + the transaction primitives. | **Pure-function gates only — no LLM in the blocking path.** |
| **Runtime** | `packages/runtime/**` | The agent team (HETS): personas, decomposition disciplines, capability traits, contracts. | Kernel gates (blocking) + advisory checks (non-blocking, audit-logged). |
| **Evolution Lab** | `packages/lab/**` | Adaptive cognition — measures the substrate's own quality and feeds reputation. Phase 3+ (v3.3+). | Advisory only; outputs reach the kernel **only** through an explicit reputation snapshot. |

The **dependency rule** points inward: an inner layer may never import an outer one (`kernel` imports nothing outward; `runtime` may import `kernel`). This is enforced by convention + per-file `// @loom-layer:` markers + the **`K12` advisory lint** — downgraded from mandatory in v5.1 after six months on the spike branch produced zero observed cross-layer drift (the `_lib/` extraction pattern keeps the tree acyclic by construction).

The kernel boundary is **Axiom 2**: *kernel = pure deterministic functions; user-space = agent spawns; interface = filesystem deltas + contract-conformant text.* It forbids LLMs writing to kernel paths, kernel code calling LLMs in a verification gate, and agents bypassing the interface. The Ten Axioms (A1–A10) are stated in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#the-ten-axioms).

---

## Enforced vs. best-effort — the honesty line

The substrate has a hard floor and a soft ceiling, and the docs never blur them:

- **🔒 Enforced (deterministic).** Hooks and validators are pure logic — they fire every time, no LLM interpretation. Read-before-edit, secret-literal blocking, config-guard, path canonicalization, write-scope detection, serial-spawn enforcement, the pre-commit promote gate. If a behavior *must* always happen, it is a hook.
- **📜 Best-effort (instruction-following).** Rules, skills, and agent prompts shape Claude's reasoning but **can be skipped** by the LLM under context pressure. They are ideals, not guarantees.

The value is concentrated in the enforced layer. The runtime adds *verifiable* multi-agent coordination on top: even when an individual agent skips an instruction, its output is checked against a per-persona contract, so the **team-level verdict is deterministic**. See [Honest disclosures](#honest-disclosures).

---

## Documentation

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — the substrate model: layers, the Ten Axioms, the transaction loop, and every kernel primitive K1–K14.
- **[docs/ROADMAP.md](docs/ROADMAP.md)** — Phase 0 ✓ → Phase 1-alpha ✓ → v3.1 ✓ → v3.2+ (appended as each phase lands).
- **[docs/README.md](docs/README.md)** — the full documentation index.

Machinery references (still accurate, preserved): **[Hooks](docs/hooks/)** · **[Library memory organizer](docs/library.md)** · **[Install](docs/install/)** · **[Commands](docs/reference/commands.md)** · **[Rules](docs/reference/rules.md)** · **[Project structure](docs/reference/project-structure.md)** · **[Stability commitment](docs/reference/stability-commitment.md)**.

---

## Honest disclosures

What this substrate does **not** do:

- ❌ **Does not make the LLM better at long-horizon coding.** It makes failures cheap, observable, and reversible. That is the whole pitch; anything more would be an overclaim.
- ❌ **Does not guarantee Claude follows the markdown rules in `rules/`.** Those are advisory text. *Specific* behaviors are hook-enforced and deterministic (read-before-edit, vague-prompt detection, config-guard, pre-compact checkpoint); the rest ride on best-effort instruction-following.
- ❌ **Does not give agents continuous LLM memory across sessions.** Each spawn is a fresh call. The substrate maintains *per-identity reputation* on disk (trust scores, history) — that is persistence of a record, not of the model's memory.
- ⚠️ **Is local-trust-anchored.** v3.0-alpha does **not** defend against host-level filesystem tampering; hash-chained tamper-evidence and network-egress policy are deferred (see ROADMAP).
- ⚠️ **`K3.b` and `K9`-style dormant code, and the `K12` advisory lint, are not yet load-bearing.** They ship early so the design can settle; the docs label them as such rather than implying an active system.

These are intentional architecture decisions, not gaps to fix.

---

## Project layout

- `packages/kernel/` — the Loom Kernel: `hooks/` + `validators/` + `recall/` + `spawn-state/` + `_lib/` (transaction primitives), `hooks.json`, `schema/`.
- `packages/runtime/` — the Loom Runtime: HETS orchestration, persona contracts, identity registry.
- `packages/lab/` — the Evolution Lab (Phase 3+).
- `packages/specs/` — the design record: `rfcs/`, `adrs/`, `plans/`, `research/`.
- `packages/skills/` — cross-cutting skills (including `agent-team/` for HETS).
- `agents/` · `commands/` · `rules/` — agent definitions, slash commands, always-on guidance.

Full walkthrough: [`docs/reference/project-structure.md`](docs/reference/project-structure.md).

## License

MIT — see [LICENSE](LICENSE).

## Attribution

Builds on community plugins and patterns that came before it. See [ATTRIBUTION.md](ATTRIBUTION.md) and [`docs/development/attribution.md`](docs/development/attribution.md).

---

**Repository**: <https://github.com/shashankcm95/claude-power-loom>
