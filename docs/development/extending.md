# Extending power-loom

> Returns to README: [../../README.md](../../README.md)


| Goal | Use a... | File location |
|------|----------|---------------|
| Always-active behavior | **Rule** | `packages/skills/rules/{category}/{name}.md` |
| Deterministic block/modify on tool calls | **Hook** | `packages/kernel/hooks/{pre,post,lifecycle}/{name}.js` (or `packages/kernel/validators/`) + entry in `packages/kernel/hooks.json` |
| Specialist Claude delegates to | **Agent** | `agents/{name}.md` (with YAML frontmatter) |
| Multi-step workflow Claude follows when relevant | **Skill** | `packages/skills/library/{name}/SKILL.md` |
| Explicit shortcut a user types | **Command** | `packages/skills/commands/{name}.md` |

---

