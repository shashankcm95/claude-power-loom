# Rules — Always-On Guidance Layer

> Returns to README: [../../README.md](../../README.md)

### Rules (9) — The Always-On Guidance Layer

Rules are markdown files injected into every session's context. They shape Claude's reasoning but rely on instruction-following — no enforcement mechanism beyond the model. Source: `packages/skills/rules/{core,typescript,web}/*.md`.

| Rule | What it enforces |
|------|------------------|
| `core/fundamentals.md` | KISS / DRY / YAGNI, immutability, files <800 lines, functions <50 lines, no nesting >4 levels, explicit error handling, schema-based input validation, naming conventions, ASCII-only source edits |
| `core/security.md` | No hardcoded secrets, parameterized SQL, output escaping, CSRF protection, auth on every protected route, rate limiting, exact-set authorization checks, security response protocol (stop work → invoke security-auditor → fix → rotate) |
| `core/workflow.md` | Predicate-gated development workflow (apply each section only when its `<important if "...">` predicate matches): conventional commits + feature branches, testing expectations, code-review standards (incl. async review-bot gate), plan-before-edit discipline, route-decision gate + persona-selection, pre-approval `/verify-plan` + phase-close gates |
| `core/research-mode.md` | Epistemic honesty (say "I don't know" if no source), Read files before claiming what's in them, cite every factual claim about external libs/APIs |
| `core/self-improvement.md` | Gap detection (throttled — observe silently, batch for session-end), pre-compact awareness, pointer to skill-forge for procedure |
| `core/workspace-hygiene.md` | Transient-artifact retention via `lifecycle` frontmatter (`ephemeral` / `archive-after` / `persistent`), session-end / pre-compact stale-artifact scan + debt levels, default-archive locations |
| `core/prompt-enrichment.md` | Vagueness detection criteria, skip patterns, library prompt-patterns lookup path, sub-agent enrichment requirement |
| `typescript/style.md` | Type discipline, Zod validation at boundaries, no console.log in production code |
| `web/react-nextjs.md` | Server/client component boundaries, hooks rules, key prop discipline, Server Action conventions |

---

