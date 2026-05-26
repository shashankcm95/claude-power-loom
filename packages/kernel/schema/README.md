# Vendored JSON Schemas

These are vendored JSON Schemas used by `contract-marketplace-schema` (in `scripts/agent-team/contracts-validate.js`) to validate this plugin's manifest files at CI time.

## Files

| File | Source | Validates |
|------|--------|-----------|
| `plugin-manifest.schema.json` | `https://www.schemastore.org/claude-code-plugin-manifest.json` | `.claude-plugin/plugin.json` |
| `marketplace.schema.json` | `https://www.schemastore.org/claude-code-marketplace.json` | `.claude-plugin/marketplace.json` |

## Why vendored (not fetched at runtime)

- **Offline-CI reliability**: CI is the only line of defense between author intent and a shipped plugin manifest. A network-fetched schema can fail (DNS, TLS, schemastore outage) and silently skip validation. Vendoring guarantees the validator always has its schema.
- **Reproducibility**: a schema update should be a discrete commit, not an invisible behavior change at the next `git push`.
- **Air-gapped install paths**: `install.sh` legacy install path may run on machines without internet at install time.

Trade-off: vendoring creates upstream-drift maintenance debt. See drift-note 45 — a CI-scheduled refresh job is the durable answer (deferred per YAGNI; manual cadence sufficient for now).

## Refresh cadence

**Bi-monthly** (every other phase that touches `.claude-plugin/`). Manual refresh via:

```bash
bash scripts/agent-team/refresh-plugin-schema.sh
```

The helper fetches both schemas, diffs against vendored copies, and writes the update if non-empty. Diff output is preserved so the refresh commit can summarize what changed.

## Validator scope (intentionally narrow)

Per H.7.23 design (and code-reviewer FAIL #1 in the H.7.23 plan's pre-approval verification), `contract-marketplace-schema` is **NOT** a general JSON Schema validator. `ajv` is not a transitive dep of this repo, and writing a "minimal subset" was rejected as understating the work. Instead, the validator targets the **3 specific failure patterns** that caused the H.7.22.1/.2/.3 hotfix sequence:

1. **Source field regex** (catches H.7.22.1): `marketplace.json` plugin entries with `source` as a string must match `^\./.*` — i.e., start with `./`. Bare `"."` is rejected.
2. **Component-path regex** (catches H.7.22.2): `plugin.json` fields like `hooks` / `agents` / `commands` / `skills` if present as strings must match `^\./.*` per upstream schema. Bare directory names without `./` prefix rejected.
3. **Redundancy flag** (catches H.7.22.3): `plugin.json` component-path fields are optional (Claude Code auto-discovers from default locations). Validator emits an info-level note when they're present-but-redundant — the official `code-review` and `feature-dev` plugins declare zero such fields.

The vendored schemas are checked-in to give future maintainers a reference for the full upstream contract; they're not exhaustively enforced because doing so without `ajv` is a project of its own.

## Refresh procedure (manual)

```bash
# 1. Run the refresh helper — it will diff + update vendored copies
bash scripts/agent-team/refresh-plugin-schema.sh

# 2. If the diff is non-empty, review the changes:
git diff swarm/schemas/

# 3. If the upstream schema added a regex that affects our validator,
#    update contract-marketplace-schema in contracts-validate.js to honor it.
#    Otherwise just commit the schema update:
git add swarm/schemas/
git commit -m "chore: refresh vendored plugin manifest schemas"
```

## Provenance

Last vendored: 2026-05-08 (H.7.23 ship). Upstream commit hash not pinned (schemastore.org doesn't expose stable revision URLs).
