# Boot-Test Fixture — Minimal Todo CLI

A 3-file Node.js project used as the working substrate for the power-loom boot test. Intentionally tiny — the boot task asks Claude to ADD a feature here, and we measure how the plugin behaves during that work.

## What's here

| File | Purpose |
|---|---|
| `cli.js` | Minimal CLI with `list` + `add` commands; stores todos in `todos.json` |
| `cli.test.js` | Self-contained smoke runner (no Jest dep); tests existing commands |
| `README.md` | This file |

## Test

```bash
node cli.test.js
```

Expected: `3 passed, 0 failed`

## What the boot task will ask Claude to do

See `bench/boot-task.md` at the bench root. The task adds a new subcommand that dumps data to a JSON archive at a given path, with input validation and a smoke test — exercising plan mode, security validation, agent spawns, KB consultation, and the self-improve loop.

## Why a synthetic fixture (not dogfood)

The boot test must run on any user's machine the moment they install the plugin. Dogfooding the toolkit repo would require them to clone it first. The synthetic fixture works anywhere `node` is installed.
