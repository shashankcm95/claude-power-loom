# Rules — Always-On Guidance Layer

> Returns to README: [../../README.md](../../README.md)

### Rules (8) — The Always-On Guidance Layer

Rules are markdown files injected into every session's context. They shape Claude's reasoning but rely on instruction-following — no enforcement mechanism beyond the model.

| Rule | What it enforces |
|------|------------------|
| `core/fundamentals.md` | KISS / DRY / YAGNI, immutability, files <800 lines, functions <50 lines, no nesting >4 levels, explicit error handling, schema-based input validation, naming conventions |
| `core/security.md` | No hardcoded secrets, parameterized SQL, output escaping, CSRF protection, auth on every protected route, rate limiting, security response protocol (stop work → invoke security-auditor → fix → rotate) |
| `core/workflow.md` | Conventional commits, feature branches, <400-line PRs, 80%+ coverage on critical paths, code review checklist (security → correctness → performance → readability) |
| `core/research-mode.md` | Epistemic honesty (say "I don't know" if no source), Read files before claiming what's in them, cite every factual claim about external libs/APIs |
| `core/self-improvement.md` | Gap detection (throttled — observe silently, batch for session-end), pre-compact awareness, pointer to skill-forge for procedure |
| `core/prompt-enrichment.md` | Vagueness detection criteria, skip patterns, MemPalace fallback path, sub-agent enrichment requirement |
| `typescript/style.md` | Type discipline, Zod validation at boundaries, no console.log in production code |
| `web/react-nextjs.md` | Server/client component boundaries, hooks rules, key prop discipline, Server Action conventions |

---

