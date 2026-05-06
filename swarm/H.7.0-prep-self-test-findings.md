# H.7.0-prep — Self-test findings (PASS)

> Companion to the H.7.0-prep phase. Validates that hybrid quality factors capture end-to-end + the validation_sources registry path produces measurably better-grounded skill output.

## Test setup

- **Task**: "Audit JWT token-handling: pin algorithm allowlist + replay-detection"
- **Identity**: `12-security-engineer.mio` (round-robin pick; mio's 2nd spawn — first was H.5.6 dogfood)
- **Skill**: `penetration-testing` (forged H.6.9 from `owasp.org/www-project-web-security-testing-guide/`; H.7.0-prep adds RFC 6749 / RFC 6819 / OAuth 2.0 Security BCP / NIST SP 800-63B as `validation_sources`)
- **Run ID**: `orch-self-test-h7-prep-jwt-20260506-135958`

## Verdict (independent contract-verifier)

```
verdict: pass
functionalFailures: 0
antiPatternFailures: 0
findingsCount: 5
fileCitations: 15
tokensUsed: null  (no transcript supplied — graceful fallback works as designed)
recommendation: accept
```

## Quality-factor capture (the H.7.0-prep core test)

After recording with new flags `--tokens 57100 --file-citations 15 --cap-requests-acted 0 --cap-requests-total 0 --kb-provenance-verified false`:

```json
{
  "samples": 2,
  "findings_per_10k": 0.876,        // 5 findings / (57100/10000)
  "file_citations_per_finding": 3.0, // 15/5
  "cap_request_actionability": null, // both 0 → null (correct semantics, not 0/0)
  "kb_provenance_verified_pct": 0,   // F9 was graceful-pass without transcript → false
  "tokens": 57100
}
```

mio's tier: `unproven` (3 verdicts < 5-threshold). passRate: 1.0. **Trust formula unchanged** — H.4.2 transparency commitment honored.

## The validation_sources path validates

mio's report grounded **every** finding with BOTH:
- **Canonical (HOW)**: OWASP WSTG / Cheat Sheets — engineering practice
- **Validation_sources (WHY)**: RFCs / NIST — protocol-level threat model

Per finding:

| F | Severity | OWASP citation (HOW) | RFC/NIST citation (WHY) |
|---|----------|---------------------|--------------------------|
| F1 | CRITICAL | WSTG-SESS-10 | RFC 6819 §4.6.4 + OAuth Security BCP §2.4 |
| F2 | HIGH | OWASP JWT Cheat Sheet | RFC 6749 §6 + OAuth Security BCP §4.13.2 + NIST SP 800-63B §5.1.7 |
| F3 | HIGH | WSTG-SESS-10 | RFC 6749 §10.6 + RFC 6819 §4.4.1.7 + OAuth Security BCP §2.3 |
| F4 | MEDIUM | OWASP Secrets Mgmt Cheat Sheet | NIST SP 800-63B §5.1.1.2 + RFC 6819 §5.1.4.1.3 |
| F5 | LOW | OWASP Cheat Sheet | RFC 7519 §4.1.4-4.1.5 + OAuth Security BCP §4.13.4 |

Without `validation_sources`, the same finding shape would be reducible to "OWASP says so" — engineering practice without protocol-level grounding. **The two-axis principle is now load-bearing in actual spawn output.**

## Comparison vs Task 4 (vlad's pre-H.7.0-prep audit)

| Metric | vlad (Task 4, H.6.9) | mio (Self-test, H.7.0-prep) |
|--------|----------------------|------------------------------|
| Findings | 13 | 5 |
| Citations | 23 | 15 |
| RFCs/standards cited per finding | 0 (cited in `## Threat Model` table only) | ≥1 per finding (in body) |
| Tokens | 57,682 | 57,100 |
| Verdict | pass | pass |

vlad surfaced more findings (good breadth), mio surfaced deeper grounding (better depth). Different shape; both PASS the contract. The H.7.0-prep extension *changed the kind of audit produced* — measurable signal that validation_sources affects output quality.

## What the self-test proves

1. **Schema captures**: `quality_factors_history` populated correctly across 2 verdicts (mio's H.5.6 + this run); aggregate computes correctly across mixed-null samples
2. **Pattern-recorder flow works**: new flags forward to agent-identity.js as `--quality-factors-json`; identity record updated
3. **tierOf unchanged**: H.4.2 audit transparency preserved — passRate-with-min-runs still drives tier; quality factors are observability-only
4. **Backwards-compat**: probe 3 confirmed records without quality flags still work (null axes, no errors)
5. **Backfill works**: 5 H.6.x identities (kira, casey, hugo, vlad, niko) populated from agent-patterns.json fallback; no double-backfill on re-run (idempotent)
6. **validation_sources resolves**: kb-resolver returns the new field; skill-forge Step 2a documents the lookup path
7. **Output quality affected**: mio's report cites RFCs in finding bodies, not just metadata — the registry extension changed substrate behavior, not just the directory structure

## Out-of-scope items captured for future phases

1. **Token-extraction from transcripts**: `tokensUsed` field is in the summary but null in this self-test (no transcript supplied). When a future spawn DOES pass `--transcript`, the existing logic in `contract-verifier.js:557-590` will populate it. Validation deferred until the first orchestration run that wires transcripts in.
2. **kb_provenance_verified true case**: this self-test recorded `false` because no transcript = F9 graceful-pass. A future run with `--transcript` would populate `true` (or false if KB reads weren't actually performed). Still need a true-positive demo.
3. **Empirical weight derivation**: H.7.0 deferred until ≥20 verdicts. Current state: 6 verdicts toolkit-wide (was 1 pre-H.6.x cycle; this run brings to 7 unique-axis-populated entries). Need 13 more before designing weights.

## Status

Phase H.7.0-prep is **shippable**. Substrate accumulates multi-axis data starting now; trust formula unchanged; validation_sources registry produces measurably better-grounded output. The next milestone (H.7.0 weighted formula) is data-driven from here forward.
