# Extending power-loom

> Returns to README: [../../README.md](../../README.md)


| Goal | Use a... | File location |
|------|----------|---------------|
| Always-active behavior | **Rule** | `rules/{category}/{name}.md` |
| Deterministic block/modify on tool calls | **Hook** | `hooks/scripts/{name}.js` + entry in `settings-reference.json` |
| Specialist Claude delegates to | **Agent** | `agents/{name}.md` (with YAML frontmatter) |
| Multi-step workflow Claude follows when relevant | **Skill** | `skills/{name}/SKILL.md` |
| Explicit shortcut a user types | **Command** | `commands/{name}.md` |

---

