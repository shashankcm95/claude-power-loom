# Phase {{N}} — {{TITLE}}

**Status:** {{▶ Planned / ⧗ In progress / ✅ Complete}}
**Realizes:** PRD §9 Phase {{N}} ({{link/title}}).
**Depends on:** {{prior phase(s) + any preconditions}}.
**Mode:** {{SHADOW / beta / GA — and any part gated OFF and why}}.

## Objective

<!-- One or two sentences, lifted from the PRD. What is true when this phase closes? -->

## Scope

**IN (buildable this phase):**

- <!-- concrete deliverables -->

**OUT (deferred / operator / later phase):**

- <!-- what is explicitly NOT in this phase, and where it goes instead -->

## Tasks

### Build

- [ ] <!-- concrete build step -->

### Test

- [ ] <!-- unit / real-path / invariant coverage; prefer real-component tests over mocked seams -->

### Validate

- [ ] <!-- for a security-sensitive diff: the multi-lens review (correctness + adversarial + claim-vs-evidence),
      findings folded before close -->

### Operator / external — TRACKED here, executed by the operator (not the build session)

- [ ] <!-- deploys, key arming, third-party applications — listed for visibility, not for us to run -->

## Definition of done (exit criteria)

- [ ] Build + Test tasks complete; the test suite + linters green.
- [ ] Validate run and findings folded.
- [ ] ADR recorded.
- [ ] Committed + pushed (per the repo's merge convention).
- [ ] Reconciliation with the PRD done (below); next phase scoped.

## Reconciliation with the PRD (filled at close)

- **Implemented vs PRD intent:** <!-- does the built list match what the PRD said this phase would deliver? -->
- **Drift / deviations:** <!-- any + how resolved -->
- **PRD updates made:** <!-- dated-accretion links; if the phase changed the roadmap, say how -->
- **Next-phase readiness:** <!-- what the next phase should now scope; what this phase unblocked -->

## Open questions (resolve during the phase / escalate)

- <!-- design forks to settle, ideally recorded in the ADR at close -->
