# test3 — Substrate DRIFT-notes Docket → v2.9.1 candidates

**Run**: test3 (PDF→Tutorial app, value-delivery sub-run of claude-power-loom v2.9.0 dogfood)
**Project on disk**: `~/Documents/TB_to_Tutorial_converter/` (GitHub: `shashankcm95/TextBook_to_Tutorial_Converter`)
**Last updated**: 2026-05-24
**Author**: triaged from session memory snapshots (`2026-05-22-test3-phase2-w2-complete-pre-phase-3` + Phase 5 UAT live session 2026-05-23/24)

## Purpose

Centralise every substrate-level finding the test3 sub-run surfaced that is *out of scope for the app* but *in scope for the next plugin minor*. Phase 6 (bench-run extraction + retrospective) consumes this file when promoting candidates into the v2.9.1 cycle.

## Severity ladder (per bench/EXPERIMENT-LOG conventions)

- **HIGH** — blocks dogfood progression in a fresh environment; ship-blocking for v2.9.1
- **MEDIUM** — workaround documented; reduces but does not block dogfood
- **LOW** — quality-of-life or cosmetic; defer-with-criteria acceptable
- **PREVIEW** — environmental/IDE/tooling-side, not plugin substrate proper; routed for awareness

## Status legend

- **OPEN** — needs design + implementation in v2.9.1
- **DEFERRED** — criteria recorded; revisit when criteria fire
- **CLOSED** — fixed before this file was authored (carried as historical)
- **WORKAROUND-SHIPPED** — fix applied in test3 app code; substrate change still wanted

---

## Cohort A — Phase 2 Wave 2 findings (001–008)

These were surfaced during Phase 2 Wave 2 of the original test3 build (per memory snapshot `2026-05-22-test3-phase2-w2-complete-pre-phase-3.md`). Full forensic detail lives in that snapshot; this section is the index.

| # | Severity | Title | Status |
|---|---|---|---|
| DRIFT-test3-001 | MEDIUM | Placeholder regex gap in agent-team validator | OPEN |
| DRIFT-test3-002 | MEDIUM | KB-id-drift across persona contracts | OPEN |
| DRIFT-test3-003 | HIGH | Challenger contract structural mismatch (challenger persona spec vs runtime envelope) | OPEN |
| DRIFT-test3-004 | MEDIUM | Bench harness write-protection — `runner.sh` can mutate `~/.claude` mid-run | OPEN |
| DRIFT-test3-005 | LOW | FIX-I1 hint blind spot — engineering-task persona ignores model-tier hint when ≥3 hints stack | OPEN |
| DRIFT-test3-006 | MEDIUM | _(carried, full text in 2026-05-22 snapshot)_ | OPEN |
| DRIFT-test3-007 | HIGH | _(carried)_ | OPEN |
| DRIFT-test3-008 | MEDIUM | _(carried — potential 8+)_ | OPEN |

**Action for v2.9.1 triage**: open each entry in the 2026-05-22 snapshot, copy the forensic detail forward into this file inline before the v2.9.1 plan locks. Not done now to avoid paraphrasing the snapshot.

---

## Cohort B — Phase 5 setup findings (013–014)

Surfaced during Phase 5 UAT bring-up on 2026-05-23 by the (wedged-then-forked) Phase-5 session. Both have **WORKAROUND-SHIPPED** in test3 app code but warrant substrate consideration.

### DRIFT-test3-013 — Next.js < 15 doesn't accept `next.config.ts`

- **Severity**: MEDIUM
- **Status**: WORKAROUND-SHIPPED (next.config.ts → next.config.mjs in TB)
- **Surface**: HETS persona templates / scaffolding skill default
- **Repro**: a HETS-spawned scaffold using `next@14.x` will fail at first `next dev` if the persona writes `next.config.ts` (which is the TS-default reflex when `tsconfig.json` is present).
- **Suggested fix for v2.9.1**: detect Next major version in scaffolding hint; emit `.mjs` for `<15` and `.ts` for `≥15`. Either ship a tiny Next-version probe in `skills/next-js/SKILL.md` or document the constraint in the persona contracts for `react-frontend` + `node-backend-development`.
- **Detection**: `pnpm dev` exits with `Error: configuration with type TypeScript is not supported`.

### DRIFT-test3-014 — Phase 2-3 scaffolding ships tutorial pages without a root `src/app/page.tsx`

- **Severity**: MEDIUM
- **Status**: WORKAROUND-SHIPPED (hand-wrote `src/app/page.tsx` + `HomeIngestForm.tsx`)
- **Surface**: next-js skill scaffolding contract / react-frontend persona checklist
- **Repro**: agent-spawned Next 14 App Router scaffolds with detail-routes (`/[id]/page.tsx`) but no `/page.tsx` leave the deployed app returning 404 on `/`, which the bench's smoke checks miss because they probe `/api/health` not `/`.
- **Suggested fix for v2.9.1**: add a `requires_root_page: true` contract item to the next-js scaffolding skill; bench smoke probe should add `GET /` to the universal-checks set.
- **Detection**: `curl http://localhost:3000/` → 404 with no `src/app/page.tsx` on disk.

---

## Cohort C — Phase 5 UAT (live) findings (015–018)

Surfaced 2026-05-24 driving the form in real Chrome end-to-end with the DDIA fixture. App-side fixes shipped to TB; plugin-side action listed below.

### DRIFT-test3-015 — Drizzle migrator needs `meta/_journal.json`; hand-written SQL lacks it

- **Severity**: MEDIUM
- **Status**: WORKAROUND-SHIPPED (`db.exec(rawSql)` bypass in TB; `pnpm db:migrate` still broken)
- **Surface**: postgres-engineering skill / data-engineer persona for SQLite + Drizzle
- **Repro**: a persona that hand-writes `0000_initial.sql` (no `drizzle-kit generate` invocation, because pnpm isn't installed at codegen time) cannot then run `drizzle-orm/better-sqlite3/migrator.migrate()` — it requires `meta/_journal.json` alongside the SQL.
- **Suggested fix for v2.9.1**: postgres-engineering / data-engineer scaffolding should either (a) emit a hand-written `meta/_journal.json` next to any hand-written SQL migration, or (b) document the "fall back to `db.exec(rawSql)`" pattern as the SQLite hand-write convention. Probably (a).
- **Detection**: `pnpm db:migrate` throws `ENOENT: no such file or directory, open '.../meta/_journal.json'` even though the SQL exists.

### DRIFT-test3-016 — pdfjs-dist polyfill warnings leak through `verbosity: 0`

- **Severity**: LOW
- **Status**: WORKAROUND-SHIPPED *(none needed — cosmetic)*
- **Surface**: ml-engineer / node-backend-development persona PDF-handling guidance
- **Repro**: `getDocument({ verbosity: 0 })` should suppress warnings per pdfjs-dist docs but `Warning: Cannot polyfill DOMMatrix` + `Warning: Cannot polyfill Path2D` still print to stderr on every parse. Non-blocking for text-only extraction; would matter if rendering were attempted.
- **Suggested fix for v2.9.1**: add a `pdfjs Node-side conventions` ADR or a short note in any pdf-related skill — capture stderr separately or filter the warning prefixes.
- **Detection**: stderr from `parsePdfBuffer(buf)` shows the two warnings even when verbosity is 0.

### DRIFT-test3-017 — webpack `require.resolve` of an ESM-only package errors with "ESM packages need to be imported"

- **Severity**: HIGH
- **Status**: WORKAROUND-SHIPPED (CWD-relative `path.join` constructs a runtime-only string webpack can't statically analyse)
- **Surface**: next-js skill / react-frontend + node-backend-development personas for ESM-only deps
- **Repro**: in a Next.js Route Handler, doing `require('foo-esm-pkg/path/to/file.mjs')` or `createRequire(import.meta.url).resolve('foo-esm-pkg/...')` triggers webpack's static analysis and fails. `serverComponentsExternalPackages` (Next 14) / `serverExternalPackages` (Next 15) alone is **not sufficient** for Route Handlers; the resolve still gets bundled.
- **Suggested fix for v2.9.1**: codify the **"non-statically-analysable runtime path"** pattern — `join(process.cwd(), 'node_modules', pkg, ...)` — in the next-js skill's "Node-side ESM dep gotchas" subsection. Pair with a list of common offenders (pdfjs-dist, native deps with `.node` binaries).
- **Detection**: webpack build error `Module not found: ESM packages (X) need to be imported. Use 'import' to reference the package instead.`

### DRIFT-test3-018 — tiktoken@1.0.15 rejects `gpt-4o-mini` as a model name

- **Severity**: HIGH
- **Status**: WORKAROUND-SHIPPED (mapped `gpt-4o-mini` → `gpt-4o` for encoding lookup; same o200k_base family)
- **Surface**: ml-engineer persona / claude-api skill / cost-management ADR
- **Repro**: `tiktoken@1.0.15` (the version pinned by ml-engineer scaffolding) throws `Invalid model: gpt-4o-mini` from `encoding_for_model()`. tiktoken released `gpt-4o-mini` recognition in a later version, but personas pin via `^1.0.x` without bumping. The error surfaces as a fully-bubbled "Invalid model: gpt-4o-mini" mid-stream, halting chapter generation — opaque to anyone who hasn't read tiktoken source.
- **Suggested fix for v2.9.1**: either (a) bump tiktoken min version in the ml-engineer skill to a recognising release, or (b) ship a recommended `ENCODING_FOR_MODEL` alias map alongside the cost-arithmetic recipe — explicitly map gpt-4o-mini → gpt-4o (same encoding family) as a fall-forward. **Important** because the error message names the **billing model**, misleading the developer into thinking their API key lacks model access (curl probe to `/v1/models/gpt-4o-mini` returns 200 fine).
- **Detection**: chapter generation logs `chapter generation failed: Invalid model: gpt-4o-mini` despite the API key having access.

---

## Cohort D — PREVIEW (environment/IDE-level, routed for awareness)

Not plugin substrate proper, but logged so Phase 6 retrospective sees the full picture.

### DRIFT-test3-PREVIEW-1 — Claude Preview MCP cwd-sandboxed

- **Severity**: PREVIEW
- **Status**: OPEN (cannot be fixed inside the plugin)
- **Surface**: Claude Preview MCP server (Anthropic-side, not power-loom)
- **Detail**: Preview MCP refuses to render an app outside its conversation cwd. If the conversation root is project A and the user wants to preview project B in a sibling directory, no preview is possible. This is what sent the wedged session into a crash loop after multiple preview-resume attempts.
- **Plugin-side mitigation**: document the constraint in the live-test ADR / verify skill — recommend driving via real Chrome (`mcp__Claude_in_Chrome`) for cross-directory app verification.

### DRIFT-test3-PREVIEW-2 — Dueling Claude CLI processes resuming the same session id

- **Severity**: PREVIEW
- **Status**: OPEN (Claude Code harness-side)
- **Surface**: Claude Code session management
- **Detail**: when two `claude` processes (or the desktop app + a `claude -c` continuation) both try to resume the same session id, they enter an API-retry storm that corrupts the session JSONL — the desktop app crashes shortly after.
- **Plugin-side mitigation**: nothing actionable; flagged for harness team.

---

## Triage proposal for v2.9.1 cycle

Suggested ship priority for the v2.9.1 minor:

1. **Cohort C blockers first** — DRIFT-017 (webpack ESM-resolve pattern) + DRIFT-018 (tiktoken model name) are HIGH and burned a real Phase-5 hour each.
2. **Cohort B scaffolding hygiene** — DRIFT-013 + DRIFT-014 are 1-hour each; low risk; raise persona-output quality.
3. **Cohort C quality-of-life** — DRIFT-015 (Drizzle journal) + DRIFT-016 (pdfjs verbosity).
4. **Cohort A backfill** — once 001–008 are inlined from the 2026-05-22 snapshot, triage individually; many likely DEFERRED-with-criteria.

Total scope estimate: ~6–10h of focused work + paired-with architect review for the next-js skill changes (DRIFT-013, 014, 017 all touch it).

## What this docket is NOT

- Not a v2.9.1 plan. Plans live under `swarm/thoughts/shared/plans/` and adopt the standard plan template.
- Not a guarantee of inclusion — Phase 6 retrospective + soak-gate verdict decide what actually ships.
- Not retroactive on tracked-file substrate state — every workaround listed here was applied in test3 app code (`~/Documents/TB_to_Tutorial_converter/`), not in the toolkit. The toolkit is byte-identical to `v2.9.0` at the time of this writing.
