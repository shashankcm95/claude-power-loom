# K12 layer-boundary lint — regression fixtures

Intentional bad-import sample files, exercised by
`tests/unit/kernel/_lib/layer-boundary-lint.test.js`. **Not real code** — these
files `require()` modules that do not exist; the K12 lint classifies imports by
*path*, never by resolving the target, so non-existent targets are fine.

`sample-repo/` is a synthetic mini-workspace. Pointing the linter at it
(`lint(<abs path to sample-repo>)`) must report **exactly one finding**: the
`inner-imports-outer.js` fixture (a kernel file importing a runtime path). The
clean fixtures — same-layer, outer→inner, and the commented-out violation — must
**not** be flagged.

These fixtures live under `tests/`, so the real repo-wide lint
(`node packages/kernel/_lib/layer-boundary-lint.js`) ignores them: a file under
`tests/` is neither "production" nor a layer, so neither finding type can fire.
That is what keeps the 0-findings-on-main baseline intact even with intentional
violations committed to the tree.
