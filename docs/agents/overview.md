# Agents — Specialist Layer Overview

> Returns to README: [../../README.md](../../README.md)

### Agents (19) — The Specialist Layer

Each agent is a `.md` file (`agents/*.md`, 19 total) with YAML frontmatter declaring its name, description, tools, model tier, and color. Claude delegates to them when it judges a specialist would help. The table below highlights the five most-used generic personas; the full roster also includes `hacker`, `honesty-auditor`, the domain builders (`node-backend`, `python-backend`, `java-backend`, `react-frontend`, `ios-developer`, `data-engineer`, `ml-engineer`, `devops-sre`), the codebase investigators (`codebase-locator`, `codebase-analyzer`, `codebase-pattern-finder`), and `confused-user`.

| Agent | Model | Tools | Specialty |
|-------|-------|-------|-----------|
| `planner` | opus | Read, Grep, Glob | Phased implementation planning, dependency mapping, parallelization analysis |
| `architect` | opus | Read, Grep, Glob | System design, ADRs, evaluating trade-offs between competing approaches |
| `code-reviewer` | sonnet | Read, Grep, Glob, Bash | Severity-based review (Critical/High/Medium/Low), security → correctness → performance → readability |
| `security-auditor` | sonnet | Read, Write, Edit, Bash, Grep, Glob | OWASP Top 10 audit, secret detection, auth/authz verification, can fix critical vulnerabilities |
| `optimizer` | sonnet | Read, Grep, Glob, Bash, Edit | Harness configuration tuning, agent performance analysis, hook efficiency, MCP health |

---

### Skills (21) — The Workflow Layer

See [the skills overview](../skills/overview.md) for the workflow layer.

