---
kb_id: hets/identity-roster
version: 1
tags: [hets, identity, roster]
---

## Summary

Per-persona identity rosters: `01-hacker → [zoe, ren, kai]`, `02-confused-user → [sam, alex, rafael]`, `03-code-reviewer → [nova, jade, blair]`, `04-architect → [mira, theo, ari]`, `05-honesty-auditor → [quinn, lior, aki]`. Round-robin assignment via `agent-identity.js assign`. Each identity accumulates per-instance trust + skill-invocation history independent of the persona class.

## Full content

### The roster mental model

Each persona is a **role** (`04-architect`). Each identity is a **named instance** within that role (`04-architect.mira`, `04-architect.theo`, `04-architect.ari`). Three architects on a real team aren't interchangeable — each has a track record. Same here.

### Default rosters

| Persona | Roster | Naming theme |
|---------|--------|--------------|
| `01-hacker` | `zoe`, `ren`, `kai` | sharp, short |
| `02-confused-user` | `sam`, `alex`, `rafael` | everyman, ambiguous |
| `03-code-reviewer` | `nova`, `jade`, `blair` | precise, austere |
| `04-architect` | `mira`, `theo`, `ari` | systems-thinking |
| `05-honesty-auditor` | `quinn`, `lior`, `aki` | observer, calm |

Names are gender-neutral by design. The naming theme is mostly aesthetic but informs how a human reviewer might mentally categorize a finding ("mira flagged this — she's been right 19/20 times on architecture claims").

### Roster size

Default size is 3 per persona. Rationale:
- A typical chaos run uses 1 actor per persona (5 total) — round-robin always picks the next-in-line, so 3 names cover three runs without immediate repetition
- A "team" use case (build me a website) might spawn 2-3 architects in parallel — 3 names cover the worst case
- Larger rosters dilute the per-identity track record; 3 names accumulate trust faster

### Adding to a roster

Edit `~/.claude/agent-identities.json` directly under `rosters.<persona>`, then re-run `agent-identity.js stats` to verify. New identities start at `unproven` tier (until ≥5 runs).

### Trust tiers per identity

| Tier | Pass-rate threshold | Min runs |
|------|---------------------|----------|
| `unproven` | (N/A) | <5 |
| `low-trust (verify everything)` | <0.5 | ≥5 |
| `medium-trust (full review)` | ≥0.5 | ≥5 |
| `high-trust (spot-check only)` | ≥0.8 | ≥5 |

These tiers eventually drive [Trust-Tiered Verification Depth](../../patterns/trust-tiered-verification.md) — high-trust identities skip the challenger pair, low-trust always get one.

### Builder personas (Phase H.2.1 + H.2.2, shipped)

All seven builder personas are live. Each has its own roster following the same convention as the auditor family:

- `06-ios-developer`: `riley`, `morgan`, `taylor` (shipped H.2.1)
- `07-java-backend`: `sasha`, `cam`, `pat` (shipped H.2.2)
- `08-ml-engineer`: `chen`, `priya`, `omar` (shipped H.2.2)
- `09-react-frontend`: `dev`, `jamie`, `casey` (shipped H.2.2)
- `10-devops-sre`: `iris`, `hugo`, `jules` (shipped H.2.2)
- `11-data-engineer`: `fin`, `niko`, `rae` (shipped H.2.2)
- `12-security-engineer`: `vlad`, `mio`, `eli` (shipped H.2.2)
