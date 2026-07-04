# Phase {{N}} — {{TITLE}}

**Status:** {{▶ Planned / ⧗ In progress / ✅ Complete}}
**Realizes:** PRD §6 Phase {{N}} ({{link/title}}).
**Depends on:** {{prior phase(s) + any preconditions}}.
**Mode:** {{SHADOW / beta / GA — and any part gated OFF and why}}.

## Objective

<!-- One or two sentences, lifted from the PRD. What is true when this phase closes? -->

## Scope

**IN (buildable this phase):**

- <!-- concrete deliverables -->

**OUT (deferred / operator / later phase):**

- <!-- what is explicitly NOT in this phase, and where it goes instead -->

## Runtime probes (verify the premises before building)

<!-- Every claim about current substrate OR harness state ("file X exists", "the spawn carries agentId",
     "hook Y fires on Z") cites a probe: `Probe: <command> → <observed result>`. Multi-reviewer blessing is
     NOT runtime verification. -->

- Probe: `{{command}}` → `{{observed result}}`

## Tasks

### Build

- [ ] <!-- concrete build step -->

### Test

- [ ] <!-- unit / real-path / invariant coverage; a green mock suite is a HYPOTHESIS — prefer a real-component
      integration test + a live dogfood on the real path over a mocked seam -->

### Validate

- [ ] <!-- for a kernel / security / auth / data-mutation diff: the 3-lens tier in parallel — code-reviewer
      (correctness) + hacker (adversarial-security, re-probing the BUILT code) + honesty-auditor
      (claim-vs-evidence); findings folded before close. Lower-stakes → one lens is enough. -->

### Operator / external — TRACKED here, executed by the operator (not the build session)

- [ ] <!-- deploys, arming flags, cross-uid signer, third-party applications — listed for visibility, NEVER for
      the build session to run -->

## Definition of done (exit criteria)

- [ ] Build + Test tasks complete; `bash install.sh --hooks --test` + the kernel suite green; linters + signpost + release-surface clean.
- [ ] Validate run and findings folded (3-lens for the high-stakes class).
- [ ] `/verify-plan` run before approval (for a HETS-routed phase); `/phase-close` run at the boundary.
- [ ] ADR recorded when the phase introduces a meaningful decision (`docs/ADRs/` → `packages/specs/adrs/`).
- [ ] Committed + PR'd; the merge is the USER's gate (never auto-merge).
- [ ] Reconciliation with the PRD done (below); next phase scoped.

## Reconciliation with the PRD (filled at close)

- **Implemented vs PRD intent:** <!-- does the built list match what the PRD said this phase would deliver? -->
- **Drift / deviations:** <!-- any + how resolved -->
- **PRD updates made:** <!-- dated-accretion links; if the phase changed the roadmap, say how -->
- **Next-phase readiness:** <!-- what the next phase should now scope; what this phase unblocked -->

## Open questions (resolve during the phase / escalate)

- <!-- design forks to settle, ideally recorded in an ADR at close -->
