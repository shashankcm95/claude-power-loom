# Agents — Specialist Layer Overview

> Returns to README: [../../README.md](../../README.md)

### Agents (5) — The Specialist Layer

Each agent is a `.md` file with YAML frontmatter declaring its name, description, tools, model tier, and color. Claude delegates to them when it judges a specialist would help.

| Agent | Model | Tools | Specialty |
|-------|-------|-------|-----------|
| `planner` | opus | Read, Grep, Glob | Phased implementation planning, dependency mapping, parallelization analysis |
| `architect` | opus | Read, Grep, Glob | System design, ADRs, evaluating trade-offs between competing approaches |
| `code-reviewer` | sonnet | Read, Grep, Glob, Bash | Severity-based review (Critical/High/Medium/Low), security → correctness → performance → readability |
| `security-auditor` | sonnet | Read, Write, Edit, Bash, Grep, Glob | OWASP Top 10 audit, secret detection, auth/authz verification, can fix critical vulnerabilities |
| `optimizer` | sonnet | Read, Grep, Glob, Bash, Edit | Harness configuration tuning, agent performance analysis, hook efficiency, MCP health |

---

### Skills (17) — The Workflow Layer

