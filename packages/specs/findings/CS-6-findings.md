# CS-6 — End-user USING.md walkthrough (PASS)

> Fourth phase via corrected autonomous-platform pattern. **First asymmetric architect+confused-user pair-run** (different from prior architect+13-node-backend pairs). **First identity to hit HIGH-TRUST tier** in toolkit history. Bundles HETS-on-git future-improvement BACKLOG entry per side-conversation.

## Cycle headline

- **Pair-run shape**: 04-architect.ari (drafts) + 02-confused-user.rafael (challenger reviews)
- **Both PASS** independently via their respective contracts
- **Convergence: agree** with 3 of 4 challenger findings applied inline; 4th was already addressed
- **First natural use of H.5.7 engineering-task contract** (ari's lightweight 3-finding report passed without padding)
- **First HIGH-TRUST identity ever recorded**: ari now at 5 verdicts × 1.0 passRate

## What landed

- **NEW** `skills/agent-team/USING.md` (283 lines) — 7-step walkthrough for product-engineer audience
  - Step 1: Install (plugin marketplace path)
  - Step 2: Initialize HETS (with diagnostic commands per CHALLENGE-3)
  - Step 3: Run `/build-team your-task`
  - Step 4: Review the analyzer's plan (with redirect-gate worked-example sub-section per CHALLENGE-2)
  - Step 5: Bootstrap missing skills via canonical-source registry
  - Step 6: Spawn the team + review per-actor reports
  - Step 7: Verify + iterate (with weighted_trust_score use-case framing per CHALLENGE-4)
  - Worked example: H.6.8 rate-limiting task with real artifact paths
  - Troubleshooting matrix: 6 failure modes × diagnostic + fix
- README link added pointing to USING.md
- BACKLOG entry: HETS-on-git future-improvement direction (deferred on credential substrate gap)
- contracts-validate: 0 violations

## Cycle data

```
ari (04-architect, draft):
  pass=5 (was 4), passRate=1.0, tier UNPROVEN → HIGH-TRUST  ← MILESTONE
  weighted_trust_score: 1.000, bonus +0.236
  convergence_samples: 2, convergence_agree_pct: 1.0
  This run: 3 findings, 18 citations, 70.8K tokens

rafael (02-confused-user, challenger):
  pass=2, passRate=1.0, tier unproven (2<5)
  weighted_trust_score: 1.000, bonus +0.144
  convergence_samples: 1, convergence_agree_pct: 1.0
  This run: 4 substantive challenges, 6 citations, 70K tokens
```

## The 4 challenges and their dispositions

| # | Challenge | Cited line | Disposition |
|---|-----------|------------|-------------|
| 1 | "Challenger" leaned on heavily but never defined as distinct kind of agent | USING.md:140 | **Already addressed** — ari's "What HETS gives you" section at line 20 + inline parenthetical at line 142 ("different perspective, not a duplicate") provide the definition. Counter-revision: leave as-is. |
| 2 | Worked example skips Step 4 redirect gate | USING.md:233 | **Applied** — added 6-line "Step 4 redirect-gate alternative path" sub-example showing what would happen if analyzer inferred Fastify instead of Express |
| 3 | Step 2 failure path lacks specific diagnostic | USING.md:53 | **Applied** — replaced "Re-install the plugin or surface the error" with diagnostic commands (`agent-identity list`, `kb-resolver list-broken`, plugin remove + install pair) |
| 4 | weighted_trust_score shown without use case | USING.md:202-207 | **Applied** — added one-sentence framing of when a user would inspect (trust degradation, latency debugging) before the bash block |

## Pair-run notes

This phase exercised a **new pair-run shape**: architect (author) + confused-user (challenger). Different from H.7.1, H.7.2, H.5.7 which all used architect (designer) + 13-node-backend (implementer). The confused-user persona was specifically designed to surface user-confusion — well-suited to reviewing user-facing docs from a fresh-reader perspective.

Worked as intended: rafael surfaced 4 concrete challenges with file:line citations, all concrete and actionable. 3 demanded inline revisions; 1 was a counter-revision-justified disagreement (ari's existing definition was sufficient). Convergence axis recorded as `agree` because the structural alignment held — refinements were polish on a sound draft, not fundamental rewrites.

This validates the H.7.1 substrate generalizing from code-review pair-runs to **document-review pair-runs**. The challenger pattern works for any artifact, not just code.

## Trust milestone — first HIGH-TRUST identity

The trust formula's tier promotion criteria:
- ≥5 verdicts (ari: 5 ✓)
- passRate ≥ 0.8 (ari: 1.0 ✓)
- → tier: **high-trust**

H.7.1's trust-tiered verification policy maps high-trust to:
- Verification: `spot-check-only`
- Spawn challenger: false
- Skip checks: `noTextSimilarityToPriorRun`

So ari's NEXT spawn will get spot-check verification (faster, fewer probes) instead of full verification + challenger. **The latency-saving design from H.2.4 will fire for the first time** when ari is next assigned. That's the trust formula doing its job — graduating proven identities to lighter-touch verification.

## HETS-on-git BACKLOG entry (bundled)

Captured architectural insight from the prior conversation: HETS structurally maps to git's parallel-work patterns; git history could become the trust-source-of-truth replacing JSON; agent's "GitHub portfolio" would be analogous to human dev's portfolio.

**Why deferred** (the load-bearing constraint the user surfaced):
LLM identities have **no first-class git credentials**. Spoofing `--author=kira` is just text manipulation; no GPG signing, no per-identity GitHub accounts, no cryptographic backing for "kira committed this." Without credential infrastructure, the portfolio is anchored to the human user's git config — provability story collapses.

Implementation gated on:
- Anthropic / Claude Code platform support for per-agent credential management
- Cross-project portability becoming load-bearing (currently single-toolkit use)
- External skeptic audit needs (currently internal observability only)

Documented in BACKLOG with conceptual mapping table + 4-stage adoption roadmap. Future authors of this work have the architectural thinking preserved.

## Toolkit-wide trust signal

```
Builder verdicts toolkit-wide: 14 → 16 (+2 paired)
Distance to H.7.3 (n=20 empirical refit milestone): 4 verdicts (80% there)
HIGH-TRUST identities: 0 → 1 (ari)
MEDIUM-TRUST identities: 4 (kira, mio, vlad, casey at 5+ verdicts; nova post-recovery)
UNPROVEN identities: ~13 still
```

## CS-6 follow-ups (deferred)

- **Onboarding skill** (`/onboard` slash command) — interactive walkthrough version. Pair with USING.md.
- **Multi-language USING.md** — English-only today.
- **Auto-generation from SKILL.md sources** — defer; manual-write produces better narrative.
- **Video walkthrough** — written-only for now.
- **Address rafael's CHALLENGE-1 with even more proactive in-line definition** — could promote "challenger" to a glossary entry. Defer until next user-doc-style task surfaces a real confusion.

## Closure

Phase CS-6 closes the persistent CS-6 BACKLOG item (lived since H.2.x cross-phase chat-scan). The autonomous-platform vision now has a usable entry point for external developers.

The asymmetric architect+confused-user pair-run pattern is validated on doc work. The H.5.7 engineering-task contract template proved its design intent (lightweight reports pass naturally without padding). The trust formula graduated its first high-trust identity — substrate now demonstrably builds reputation over time, not just records verdicts.

Toolkit verdicts trajectory: H.5.6 (1) → H.6.x (6) → H.7.0-prep (7) → H.7.1 (9) → H.7.2 (11) → H.5.7 (14) → CS-6 (16). One more orchestration cycle reaches n=20; H.7.3 empirical refit unlocks.
