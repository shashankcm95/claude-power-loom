# test3 — PDF→Tutorial app (value-delivery + v2.9.0 substrate dogfood)

**Status**: planning
**Substrate version**: v2.9.0 (`d9ced49` on main; 4 new entrypoints active)
**App home**: `~/Documents/TB_to_Tutorial_converter/`
**Bench artifacts home**: `bench/control-runs/test3/` (this folder)
**Start date**: 2026-05-22

---

## What's new about test3 vs test0/1/2

Prior runs (test0/1/2-treatment/2-control) were **diagnostic** — they produced multi-orchestrator HETS reports diagnosing the toolkit. They did **not** produce a working app. test3 inverts the framing: **ship a real app that real users can run**, and use the substrate to do it well.

The substrate exercises happen as a side-effect of shipping value. That's the right pattern — it mirrors how production teams will actually consume power-loom.

**Dogfood criteria** (the substrate features that get empirical signal):
| Feature | Test fires when | Success signal |
|---------|-----------------|----------------|
| FIX-I4 `agent-team doctor` | Phase 0 pre-flight | `--probe env-inheritance --strict` blocks Phase 1 if `.env` placeholders detected (FIX-I7) |
| FIX-I2 YAML-quoted identity | Every spawn | Zero `~`-as-null bugs across 8+ persona spawns |
| FIX-I1 `_format-spec.md` hint | Any actor emits orphan H3s | F3 hint fires + actor self-corrects on retry |
| FIX-I3 counter/history invariant | Every pattern-record | Zero `drift_detected` warns across 30+ verdicts |
| FIX-I6 noUnrolledLoops 20-thresh | Drizzle schema review | Zero false-positives on schema imports |
| FIX-I8 ml-engineer inference path | ml-engineer spawned | Persona invokes `claude-api`/OpenAI skill, NOT `pytorch` (the bench v2.8.5-treatment failure mode) |
| FIX-I9 validate-config-redirect | Any Bash redirect to tsconfig/eslintrc | WARN fires; build script writing `tsconfig.build.json` is OK |
| FIX-I5 extract-run.sh | Post-run metrics | All tier_1 fields filled, zero `_unfilled_fields` |
| DEVIATION-003/006/007 measurement | All implementer spawns | challenger-spawn rate ≥0.5 (Option D measurement plan; if hit, mandate stays deferred; if not, escalate to v3.x Option C tier-gate) |
| design-pushback catalog | Brief intake | At least 1 catalog reference cited (e.g. localStorage for auth — N/A here; or syntactic-gate if any reviewer surfaces config-bypass) |

---

## Architecture (locked at clarification)

| Layer | Choice | Persona that owns it |
|-------|--------|----------------------|
| Frontend | Next.js 14 App Router + Tailwind + shadcn/ui | `09-react-frontend` |
| Backend | Next.js API routes + Server Actions | `13-node-backend` |
| Persistence | SQLite via better-sqlite3 + Drizzle ORM | `11-data-engineer` |
| PDF parsing | `pdfjs-dist` or `unpdf` (decided in Phase 1) | `13-node-backend` (or `08-ml-engineer` if streaming chunking) |
| LLM | OpenAI GPT-4o-mini (cheap default) / GPT-4o (fallback for hard chapters) | `08-ml-engineer` (inference path, FIX-I8) |
| Storage | S3 → presigned URL ingest | `10-devops-sre` + `13-node-backend` |
| Recall engine | Leitner 5-box SRS (in SQLite) | `11-data-engineer` (schema) + `09-react-frontend` (UI) |
| Auth | Cookie-signed session-id (anonymous; no email) | `13-node-backend` |
| Deploy | Localhost-first; Cloudflare Pages target deferred | `10-devops-sre` (deploy-checklist contract) |

---

## Feature MVP (locked at clarification)

### Core ingest flow
1. User pastes S3 URL → server fetches via presigned URL
2. PDF extraction → text + per-page metadata (page-num, source-paragraph anchors for citations)
3. Chunk by chapter (use PDF outline if present; fall back to heuristic split at heading H1/H2 detection)
4. **Streaming chapter generation**: OpenAI generates Ch.1 → emits tokens → UI renders → Ch.2 starts. Each chapter has `source_paragraphs[]` field pointing back to PDF page-anchors for proof-citation

### Per-chapter content
- Narrative tutorial (LLM-rewritten for clarity; preserves source meaning)
- **5–10 MCQ questions** (with 4 options + correct + explanation + source-paragraph citation)
- **15–25 flashcards** (Q / A / source citation)
- Completion marker (boolean per user)

### SRS engine
- 5-box Leitner (Box 1 = daily, Box 2 = 3 days, Box 3 = 7 days, Box 4 = 14 days, Box 5 = retired)
- User rates flashcard recall on review: "got it" advances to next box; "review again" demotes to Box 1
- Server stores per-card state in SQLite
- "Due today" panel surfaces cards from all chapters

### Cost transparency
- Per-parse token usage + estimated $ shown on tutorial header
- Stored in `parses` table; running total visible to user

### Proof-of-source UI affordance
- Each quiz question + flashcard has a "Source" link → opens PDF at the source page (or shows the source paragraph text inline)
- Mirrors the portfolio-website-builder's "Proof-Backed Portfolio" discipline

### Completion status
- Per-chapter: read ✓, quiz-passed ✓, flashcards-due-cleared ✓
- Per-tutorial dashboard: % complete + due cards + next-up chapter

### Things NOT in test3 scope (defer to test4+)
- Export (markdown/PDF download)
- Re-prompt sections
- Note-taking / highlights
- Multi-tutorial library (one PDF → one tutorial per user; later expand)
- Cross-device sync (session-id stays local)
- Cloudflare Pages deploy
- Anthropic API alongside OpenAI (single-LLM keeps things tight)

---

## Phase sequencing (estimated wallclock 8–14h, multi-session OK)

### Phase 0 — Pre-flight (~30 min)

**Goal**: catch the v2.8.5-control silent-stub class of bug BEFORE any spawn.

1. Run `node ~/Documents/claude-toolkit/scripts/agent-team/doctor.js --probe env-inheritance --strict` against the empty TB_to_Tutorial_converter folder
2. Author `.env.example` with placeholder shapes (`OPENAI_API_KEY=<your-key-here>`, `S3_ACCESS_KEY=XXXXX`, etc.) → expect doctor's `env-placeholder` to flag them
3. User authors real `.env` (or sets env vars) → re-run doctor → expect `pass`
4. Confirm `agent-team doctor --json` returns `{summary: {pass: ≥1, fail: 0}}`
5. **Phase 0 gate**: BLOCK Phase 1 if any `fail`. WARN passes through. (This validates FIX-I7 + FIX-I4 in practice.)

**Plugin features invoked**: `doctor.js`, `env-placeholder` helper, fail-loud discipline

### Phase 1 — HETS design ceremony (~90 min)

**Goal**: produce an architecture doc + 8 persona contracts via formal HETS ceremony.

1. `route-decide` gate with full brief context → expect `route` recommendation
2. `/build-team` flow:
   - Spawn `04-architect.theo` (or fresh identity if drift) for architecture design
   - Spawn `05-honesty-auditor` (lior) as challenger pair — surfaces ≥1 substantive disagreement on tech choice / scope / failure-mode
   - Optionally: `06-ios-developer` (riley) cross-domain adjacency challenger (catches design-pushback opportunities from outside the web-stack frame)
3. Architect output MUST cover:
   - Data flow diagram (S3 → ingest → parse → chunk → LLM → DB → UI)
   - Drizzle schema (users, tutorials, chapters, questions, flashcards, srs_reviews, parses_cost)
   - Streaming architecture (SSE vs Vercel AI SDK)
   - Error budgets per layer (PDF parse retries, OpenAI rate-limit handling, schema migration safety)
   - Cost model (input/output tokens × $0.15/$0.60 per 1M for gpt-4o-mini)
   - Trade-offs section (per `kb:architecture/discipline/trade-off-articulation`)
4. Each output → `contract-verifier` with `engineering-task.contract.json` → `pattern-recorder` records verdict
5. **HETS Output validations** (FIX-I1 dogfood): if any actor emits orphan H3s, the structured hint fires; require a retry on F3 fail

**Plugin features invoked**: `route-decide`, `/build-team`, `agent-identity assign`, `agent-identity assign-pair`, `contract-verifier`, `pattern-recorder`, `kb:hets/spawn-conventions`, `kb:hets/asymmetric-challenger`, `kb:hets/stack-skill-map`, `_format-spec.md`

### Phase 2 — Foundation (~2.5h, parallel where possible)

**Goal**: scaffold the Next.js app + DB schema + S3 ingest + OpenAI integration.

**Wave 1 (parallel)** — these can run concurrently per persona-bulkhead:
- `13-node-backend.<name>` — Next.js 14 init + Tailwind + shadcn + base routes + middleware/cookies
- `11-data-engineer.<name>` — Drizzle schema + migrations + better-sqlite3 setup + seed script
- `10-devops-sre.<name>` — `.env.example` schema + S3 client (AWS SDK v3) + presigned URL fetcher

**Wave 2 (depends on Wave 1)**:
- `08-ml-engineer.<name>` — OpenAI client (using `openai` package) + streaming completion handler + prompt templates for chapter-gen / quiz-gen / flashcard-gen / SRS-review-eval. **MUST** cite `kb:ml-dev/training-vs-inference` and stay on the inference path (FIX-I8 dogfood).
- `13-node-backend.<name2>` — PDF parsing pipeline (pdfjs-dist) + chapter detection heuristic + paragraph anchor extraction (for proof-citation)

**Each persona spawn**:
- Carries quoted YAML identity in frontmatter (FIX-I2 dogfood)
- Output verified via `contract-verifier` (engineering-task contract; F3 hint dogfood)
- Verdict recorded via `pattern-recorder` (FIX-I3 invariant dogfood)
- If Drizzle schema files have many short import lines, FIX-I6 dogfood validates no false-positives

**Plugin features invoked**: per-persona spawns, contract-verifier on each, pattern-recorder, library snapshots after each wave

### Phase 3 — Feature build (~3h, sequenced)

**Goal**: ship the value-add features (streaming, citations, SRS, cost display, completion tracking).

1. **Streaming chapter generation** (`08-ml-engineer` + `09-react-frontend` paired):
   - Server: SSE endpoint streams OpenAI tokens chapter-by-chapter
   - Client: progressive render; `<TutorialChapter>` component shows skeleton → tokens → done
2. **Proof-citation UI** (`09-react-frontend`):
   - Each quiz question + flashcard renders a "Source" affordance
   - Click → modal showing source paragraph + PDF page link
3. **SRS engine** (`11-data-engineer` + `09-react-frontend` paired):
   - Schema: `srs_reviews` table (card_id, user_id, box, last_reviewed, due_at)
   - Server action: `gradeCard(cardId, recall: 'got-it' | 'review-again')` — box transitions
   - UI: "Due today" panel + review flow + visual progress
4. **Cost display** (`08-ml-engineer` + `09-react-frontend` paired):
   - Server stores `usage` from OpenAI response → `parses_cost` table
   - UI: header chip "$0.04 / 1,238 tokens" on tutorial page
5. **Completion tracking** (`13-node-backend` + `09-react-frontend` paired):
   - Server actions: `markChapterRead`, `recordQuizAttempt`, `clearDueCards`
   - Dashboard: per-tutorial progress widget

**HETS pair-runs** on each feature so DEVIATION-003/006/007 challenger-rate gets measurement. **Target ≥0.5 pairing rate across all spawns this phase.**

### Phase 4 — Security + correctness review (~90 min)

**Goal**: catch the security + reliability holes before "ship".

1. `12-security-engineer.<name>` spawn — full security review:
   - S3 presigned URL handling (don't store credentials in URL)
   - SQL injection surface (Drizzle parameterizes by default; verify)
   - XSS on rendered tutorial markdown (use `react-markdown` with sanitized html)
   - CSRF on POST endpoints (cookie-based session-id requires CSRF token OR SameSite=strict)
   - OpenAI API key handling (never echoed to client; only used in server contexts)
   - Rate limiting on `/api/ingest` (presigned URL fetching could be abused)
2. `03-code-reviewer.<name>` spawn — full code review:
   - Drizzle schema sanity
   - Streaming error-handling (does an aborted stream leak resources?)
   - Cost-attribution accuracy (every OpenAI call charged correctly)
3. **Fix surfaces**: each CRITICAL finding goes to the originating persona for fix-loop (asymmetric-challenger pattern)
4. Re-run `agent-team doctor --strict` to confirm no env-leak introduced by build

### Phase 5 — Live integration + UAT (~90 min)

**Goal**: prove the app works end-to-end with a real S3 PDF.

1. User uploads test PDF to S3 → shares URL → app processes it
2. Verify chapters generate cleanly via streaming
3. Verify quizzes contain valid MCQs with source citations
4. Verify flashcards review flow + SRS state transitions
5. Verify completion tracking persists across sessions
6. Verify cost display matches actual OpenAI dashboard
7. Verify `validate-config-redirect.js` (FIX-I9) didn't accidentally block any legit build command

**Edge cases to test**:
- Very long PDF (200+ pages) — does chunking handle it?
- Image-heavy PDF — does pdfjs-dist extract usable text?
- PDF with no headings — does heuristic chapter detection produce sensible chunks?
- Network failure mid-streaming — does the UI handle gracefully?
- OpenAI rate limit hit — exponential backoff + user feedback?

### Phase 6 — Bench-run extraction + retrospective (~60 min)

**Goal**: produce a `bench/control-runs/test3/` artifact set matching v2.8.5-treatment format.

1. Run `bench/control-runs/extract-run.sh --project ~/Documents/TB_to_Tutorial_converter --target bench/control-runs/test3 --strict`
2. Expect zero `_unfilled_fields` — FIX-I5 dogfood
3. Produce `bench/control-runs/test3/NOTES.md` (mirrors v2.8.5-treatment/notes.md):
   - Per-phase summary
   - Plugin features that fired + their effect
   - Plugin features that DIDN'T fire when expected (gap analysis)
   - challenger-spawn rate measurement (DEVIATION-003/006/007)
   - Any new DRIFT-NNN entries discovered
   - Recommendations for v3.x scope
4. Cross-run comparison report — test3 vs test0/1/2 (working-app delta is the big swing; substrate effects are secondary)

**Plugin features invoked**: `extract-run.sh`, `aggregate.py` (for cross-run band), library snapshot

### Phase 7 — Ship to localhost + smoke (~30 min)

1. `pnpm dev` runs cleanly on localhost:3000
2. Smoke checklist:
   - Upload PDF → tutorial generates
   - Quiz works
   - Flashcards work + SRS advances
   - Completion persists across browser restart (via SQLite)
   - Cost display matches reality
3. Author `README.md` with setup steps + `.env.example` reference
4. Tag the working app build (`tb-converter-mvp-v0.1.0`)

### Phase 8 — Optional: Cloudflare Pages preview (defer if tight)

If time permits, build for Cloudflare Pages target — but plan defers this to test4 if Phase 7 hasn't completed cleanly.

---

## Persona invocation map

| Persona | Spawned in phases | Identity ceremony |
|---------|-------------------|-------------------|
| `04-architect` | Phase 1 (design) | High-trust if existing identity in good standing; else fresh |
| `05-honesty-auditor` (challenger) | Phase 1, Phase 3 substantive features | Asymmetric — different persona from implementer |
| `06-ios-developer` (cross-domain challenger) | Phase 1 only | Adjacency disconfirmation; lower priority if time-bound |
| `08-ml-engineer` | Phase 2 Wave 2, Phase 3 (streaming + cost) | **FIX-I8 dogfood**: MUST stay on inference path (claude-api / OpenAI; NOT pytorch) |
| `09-react-frontend` | Phase 2 Wave 1, Phase 3 (UI features) | TS skill auto-loaded if available |
| `10-devops-sre` | Phase 2 Wave 1, Phase 5 (env validation), Phase 7 (deploy-checklist) | |
| `11-data-engineer` | Phase 2 Wave 1, Phase 3 (SRS schema) | |
| `12-security-engineer` | Phase 4 | |
| `13-node-backend` | Phase 2 Wave 1+2, Phase 3 (completion endpoints) | |
| `03-code-reviewer` | Phase 4 | |

**Total expected spawns**: ~15–20 distinct persona spawns across phases. **Target challenger-spawn rate ≥0.5** (≥7–10 challenger pairs per ~15 implementer spawns) — DEVIATION-003/006/007 measurement.

---

## Plugin-feature dogfood checklist

Track each substrate feature's firing across the run; this is the secondary substrate-verification output of test3.

| Feature | Expected firing site | Pass criterion |
|---------|---------------------|----------------|
| `agent-team doctor --strict` | Phase 0, Phase 4 re-check | Blocks Phase 1 if .env placeholders detected |
| `env-placeholder` helper | Phase 0 doctor probe | Recognizes `<your-key-here>` shapes |
| `route-decide` | Phase 1 brief intake | Recommends `route` for user brief |
| `/build-team` flow | Phase 1 design, each Phase 3 feature | Spawns architect + challenger pair |
| `agent-identity assign` | Every spawn | Identity assignment ceremony fires |
| `agent-identity assign-pair` | Each pair spawn | Different-persona pairing preferred |
| `contract-verifier` | Each persona output | Verdict written; F3 hint fires on orphan-H3 (FIX-I1) |
| `pattern-recorder` | Each verdict | Per-persona + per-identity records updated; counter invariant holds (FIX-I3) |
| YAML-quoted identity | Every spawn frontmatter | Zero `~`-as-null bugs (FIX-I2) |
| `_format-spec.md` ref | Every contract `_format` field | Single source of truth; no docstring drift |
| `noUnrolledLoops` (FIX-I6) | Drizzle schema review | Zero false-positives on schema/import lines |
| `ml-engineer` inference path (FIX-I8) | Phase 2 Wave 2 + Phase 3 | Persona cites `claude-api`/OpenAI, NOT `pytorch` |
| `validate-config-redirect.js` (FIX-I9) | Any Bash redirect during build | Fires WARN on protected paths; doesn't false-block legit build scripts |
| `synthid hash` rationale (FIX-I10) | recommend-verification calls | Zero `? → ?` patterns |
| `extract-run.sh` (FIX-I5) | Phase 6 | Zero `_unfilled_fields`; metrics.json produced clean |
| `aggregate.py` | Phase 6 cross-run | Accepts test3 metrics for variance analysis |
| `kb:hets/stack-skill-map` | Phase 1 persona selection | Next.js stack → react-frontend + node-backend correctly mapped (post FIX-G/H1) |
| `kb:design-pushback` catalog | Phase 1 brief intake | Architect cites ≥1 entry OR explicitly notes "no applicable catalog entry" |
| `library` snapshots | After each phase | Phase milestones persist to `~/.claude/library/sections/toolkit/stacks/session-snapshots/` |

---

## Trade-offs surfaced (Pattern-1; what's sacrificed)

1. **Anonymous-only auth** — no email signup means no cross-device sync, no abuse-rate-limit per user. Trade-off: zero auth complexity for MVP; can add later. Cost: power-users on multiple devices have separate progress.
2. **OpenAI-only LLM** — no Anthropic fallback, no Claude exercise. Trade-off: simpler architecture + faster shipping; loses ecosystem-diversity. **design-pushback opportunity**: surface this as a known limitation; if Anthropic API is also in your stack, the substrate's stack-skill-map could route differently.
3. **No tutorial export** (deferred) — user can't take their generated tutorial outside the app. Trade-off: tighter MVP scope; user is "trapped" until test4. Mitigation: SQLite file IS portable; advanced users can extract.
4. **Local SQLite, no D1** — works on localhost only until we add a deploy story. Trade-off: simpler local dev; defer infra surface. Mitigation: Drizzle abstraction means swap to D1 is a few-hour migration.
5. **No chapter re-prompt** (deferred) — generated content is fixed; user can't say "make Ch.3 simpler". Trade-off: tighter MVP; user must re-upload PDF + accept full re-gen if they want different output.
6. **Streaming requires native fetch on client** — modern browsers only; no IE/legacy fallback. Acceptable for target audience.

---

## Success criteria (this is the bar)

- [ ] `pnpm dev` runs the app on `localhost:3000` cleanly
- [ ] User pastes S3 PDF URL → tutorial generates with streaming chapters visible
- [ ] Each chapter has 5–10 MCQ + 15–25 flashcards
- [ ] Each quiz question shows source paragraph from PDF
- [ ] SRS flow advances flashcards across 5 boxes correctly
- [ ] Cost display shows token usage + estimated $ per parse
- [ ] Completion tracking persists across browser restart (SQLite roundtrip)
- [ ] All Phase 0 probes pass (`agent-team doctor --strict`)
- [ ] Phase 4 security review surfaces 0 CRITICAL post-fix
- [ ] Phase 6 `extract-run.sh --strict` exits 0 (zero `_unfilled_fields`)
- [ ] Bench artifact `bench/control-runs/test3/NOTES.md` documents:
  - Plugin features that fired + effect
  - challenger-spawn rate (DEVIATION-003/006/007 measurement)
  - New DRIFT entries (if any)
  - v3.x scope recommendations
- [ ] Working app + bench report committed to a feature branch

**Not required for success** (deferred):
- [ ] Cloudflare Pages deploy (defer to test4 if time-bound)
- [ ] Tutorial export (Phase 8 if time)
- [ ] Re-prompt sections (Phase 8 if time)

---

## KB sources to consult per phase (per H.9.20.0 v2.0.3 KB-discipline)

| Phase | Required KB consultations |
|-------|---------------------------|
| Phase 0 | `kb:architecture/discipline/error-handling-discipline` (fail-loud at gate) |
| Phase 1 design | `kb:architecture/crosscut/dependency-rule`, `kb:architecture/crosscut/single-responsibility`, `kb:architecture/discipline/trade-off-articulation`, `kb:design-pushback/_index`, `kb:hets/spawn-conventions`, `kb:hets/asymmetric-challenger`, `kb:hets/stack-skill-map` |
| Phase 2 ml-engineer | `kb:ml-dev/training-vs-inference` (FIX-I8 dogfood), `kb:architecture/ai-systems/inference-cost-management` |
| Phase 2 data-engineer | `kb:data-dev/data-modeling-basics` |
| Phase 2 node-backend | `kb:backend-dev/api-design-essentials` (if exists; else fall through) |
| Phase 3 streaming | `kb:architecture/ai-systems/inference-cost-management` (cost-aware streaming), `kb:architecture/discipline/stability-patterns` (retry + backoff) |
| Phase 4 security | `kb:security-dev/auth-patterns`, `kb:security-dev/threat-modeling-essentials`, `kb:security-dev/owasp-top-10` (if exists) |
| Phase 6 retrospective | `kb:architecture/discipline/error-handling-discipline` (anti-silencing in the bench-extraction step) |

---

## Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| OpenAI API quota / rate limits hit mid-generation | HIGH | Exponential backoff in `08-ml-engineer` work; cost-cap config; graceful degradation message |
| Large PDF (>200 pages) exceeds context window | MEDIUM | Chapter-by-chapter chunking; never send full PDF to LLM; per-chapter retry on failure |
| pdfjs-dist mangles complex PDFs | MEDIUM | Fallback to `unpdf` or pure `pdf-parse`; UI surfaces "low-confidence extraction" warning |
| SQLite file conflicts on hot-reload | LOW | Drizzle migration discipline; backup before schema change |
| Cost overrun unnoticed | MEDIUM | Cost transparency feature is load-bearing — must be in MVP, not deferred |
| Streaming SSE breaks on network proxy | LOW | Vercel AI SDK has tested polyfills; fall back to polling if SSE fails |
| `validate-config-redirect.js` false-blocks legit build scripts (FIX-I9) | LOW | WARN-not-BLOCK default already mitigates; test3 will exercise + measure |
| challenger-spawn rate stays low even with new infra (DEVIATION-003/006/007) | MEDIUM | If measured rate <0.5 even with v2.9.0 infra, escalate to v3.x Option C (tier-gated mandate) per Phase E policy doc |

---

## Branch + ship strategy

- New branch on toolkit repo: `bench/test3-tb-converter` (substrate-side workspace)
- New branch on app repo (if separate): `~/Documents/TB_to_Tutorial_converter/` initialized as own git repo with branch `main` (no upstream initially; user pushes later)
- Bench artifacts committed to toolkit repo's `bench/control-runs/test3/`
- v3.x scope decisions feed forward into power-loom v3.0.0 planning post-test3

---

## What I think you might have missed (surfaced for confirmation, not assumed)

| Surface | Rationale | Decision needed |
|---------|-----------|-----------------|
| Source-language detection | If PDF is non-English, tutorial gen quality drops sharply | Add language detection in Phase 2; show user the detected language; offer English-translation toggle? Defer? |
| Table / equation handling | Textbooks have math/tables that PDF-extraction mangles | Best-effort fallback; warn the user; defer LaTeX rendering to test4? |
| Image extraction | Diagrams in PDFs are usable for tutorial illustration | Out of scope for test3; defer to test4? |
| Concurrent user safety | What if two users use the same localhost simultaneously? | Single-user assumption is fine for localhost; document explicitly? |
| LLM hallucination on technical facts | Quiz questions with wrong "correct" answer is failure mode | Proof-citation feature mitigates by anchoring to source paragraph; user can flag bad questions? |
| User feedback loop on bad questions | Marking a quiz question as "wrong" — does the app re-generate? Or just hide? | Hide-only for MVP; defer regen to re-prompt feature in test4 |
| Telemetry / privacy | Are we recording any user-side data beyond progress? | Local SQLite only; no telemetry. Document in README. |

If any of these feel load-bearing, ship them in Phase 3 or as part of the value-add scope. Otherwise documented for test4+.

---

## How this advances v3.x scope

- **HETS challenger-rate measurement** → if ≥0.5 with v2.9.0 infra, Option D defers correctly; if <0.5, Option C (tier-gated mandate) becomes the v3.x candidate
- **agent-team doctor utility evidence** — does Phase 0 actually catch problems? Does the `not-implemented` status surface anything actionable?
- **`_format-spec.md` hint utility** — does it actually help actors self-correct? Empirical signal for whether the discoverability ROI was worth the substrate-fundament cost
- **ml-engineer inference path uptake** — does the persona-brief change actually shift behavior? Or did test2 prove the persona-split is still needed?
- **`design-pushback` catalog utility** — does the catalog get cited at brief intake? Or does it sit dormant?

These are the **load-bearing v3.x design questions** that test3 answers empirically.

---

## Next step

Awaiting GO/NO-GO. Once approved, kick off Phase 0 (~30 min) and confirm doctor probes pass before any Phase 1 spawn.
