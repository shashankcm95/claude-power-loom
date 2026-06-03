---
kb_id: hets/code-search-heuristics
version: 1
tags:
  - hets
  - codebase-locator
  - search-heuristics
  - tooling
  - ripgrep
  - recall
sources_consulted:
  - "Andrew Gallant (BurntSushi), ripgrep GUIDE.md — -i/--ignore-case, -S/--smart-case, -w/--word-regexp, -U/--multiline, -t/--type + --type-list, -g/--glob (+ ! negation), -F/--fixed-strings, -o/--only-matching, .gitignore-respect-by-default (github.com/BurntSushi/ripgrep/blob/master/GUIDE.md) [web-verified]"
  - "GNU grep manual + The Open Group POSIX grep utility — -E (ERE), -w whole-word, -i ignore-case, -r recursive (gnu.org/software/grep/manual/grep.html; pubs.opengroup.org/onlinepubs/009695399/utilities/grep.html) [web-verified]"
  - "Sourcegraph code-search reference — type:symbol, select:symbol.function, repo:/file:/lang:/case:yes filters, RE2 regexp syntax, structural patterns with '...' holes (sourcegraph.com/docs/code_search/reference/language + /blog/how-to-search-with-sourcegraph-using-structural-patterns) [web-verified]"
  - "ast-grep docs — CST/tree-sitter structural patterns, meta-variables ($A), atomic/relational/composite rules (ast-grep.github.io/guide/pattern-syntax.html + /advanced/core-concepts.html) [web-verified]"
  - "comby.dev — lightweight structural match/rewrite with :[hole] templates over balanced delimiters (comby.dev/docs/basic-usage) [web-verified]"
  - "Diomidis Spinellis, Code Reading: The Open Source Perspective (Addison-Wesley, 2003) — reading as an engineer (how it ticks) vs as a scavenger (reuse); choosing the technique to the goal [web-verified]"
related:
  - hets/spawn-conventions
  - architecture/crosscut/single-responsibility
  - architecture/crosscut/information-hiding
  - architecture/discipline/evidence-and-premise-discipline
  - architecture/discipline/error-handling-discipline
  - hets/stack-skill-map
status: active
---

## Summary

**Principle**: locating code is a **recall problem**. The governing failure is the **false negative** — a file that exists but the search missed — so the discipline biases toward over-search: enumerate every naming variant, sweep breadth-first, and cross-check with a second tool before ever concluding "not found".
**Practice**: drive `ripgrep`/`grep` with the right knobs (`-i`/`-S` casing, `-w` word boundaries, `-U` multiline, `-t`/`-g` scoping), spell out identifier variants as a regex alternation, escalate to **structural/semantic** search (Sourcegraph `type:symbol`, ast-grep, comby) when text regex under- or over-matches, and trace **definitions AND every reference** to map the real surface.
**Output**: report `file:line` locations as a map of where code **is** — not prose about behavior, not opinions about where it **should** be.
**Sources**: ripgrep GUIDE (Andrew Gallant) + GNU/POSIX grep + Sourcegraph code-search + ast-grep + comby + Spinellis *Code Reading*.
**Serves**: the `14-codebase-locator` persona's eight flagged KB-gap instincts (`packages/runtime/personas/14-codebase-locator.md:48`).

## Quick Reference

**The eight locator instincts → the tool move that serves each:**

| Instinct | One-liner | Primary move |
|---|---|---|
| `exhaustive-naming-variants` | enumerate all spellings before "not found" | regex alternation `(get\|fetch)User(Profile)?` + `-i` |
| `where-not-just-what` | report `file:line`, not behavior prose | `rg -n` / `--vimgrep`; hand behavior to the analyzer |
| `trace-every-reference` | find the def AND all call sites/imports | `rg -l symbol` + import-string grep + `type:symbol` |
| `no-false-negatives` | a missed match is the worst failure | cross-check a 2nd tool; widen before narrowing |
| `breadth-before-depth` | sweep the tree before drilling one file | `rg --files \| rg <area>`; `--count-matches` per dir |
| `entrypoint-finding` | locate mains/routes/handlers/exports/config | grep for `main(` / route decorators / `exports` / config roots |
| `current-location-not-ideal` | describe where code IS, not where it should be | report observed paths; defer relocation to architect |
| `empirical-naming-convention` | infer the repo's ACTUAL idioms from what exists | `rg --files \| sed` survey; report the observed pattern |

**ripgrep knobs** (all from the GUIDE — github.com/BurntSushi/ripgrep):

| Flag | Effect |
|---|---|
| `-i` / `--ignore-case` | "ignore case differences … `rg -i fast` matches `fast`, `fASt`, `FAST`" |
| `-S` / `--smart-case` | case-insensitive UNLESS the pattern has an uppercase letter |
| `-w` / `--word-regexp` | "matches … surrounded by word boundaries" (≈ `\b(?:pat)\b`) |
| `-U` / `--multiline` | "permit matches to span multiple lines" |
| `-t` / `--type` (+ `--type-list`) | a named glob set (e.g. `-t py`); `-T` excludes a type |
| `-g` / `--glob` (`!`-negate) | restrict to / exclude a glob; `.gitignore` semantics |
| `-F` / `--fixed-strings` | literal match — disables regex (use for `$`, `.`, `(`) |
| `-o` / `--only-matching` | print only the matched span |

ripgrep **respects `.gitignore` by default** — so `node_modules`, build dirs, and `.git` are skipped unless you pass `-u`/`--no-ignore` / `-uu` / `-uuu`. A "missing" file may simply be ignored — escalate to `-uu` before concluding `no-false-negatives`.

**Escalation ladder** (text → structure → semantics):

1. **literal/regex** (`rg`, POSIX `grep -E`) — fast, line-oriented, the default sweep.
2. **structural** (ast-grep, comby) — match by code shape (balanced delimiters, AST nodes), not characters — when regex over/under-matches nested code.
3. **semantic / cross-repo** (Sourcegraph `type:symbol`, `select:symbol.function`) — symbol-aware, RE2 regex, repo/file/lang scoping — when you need the def + every reference across a tree.

**Top smells**:

- Concluding "X is not in the codebase" after one casing of one spelling (the canonical false negative).
- Reporting *what the code does* ("this validates the token") instead of *where it lives* (`auth/token.js:42`) — that is the analyzer's lane.
- Finding the definition and stopping — never tracing the call sites / imports.
- Asserting a naming convention the repo "should" use instead of the one `rg --files` shows it *does* use.

## Intent

A locator answers "where does X live?" and the only way to get it wrong that actually hurts is to **miss** a file that exists. A false positive costs the reader one extra glance; a false negative silently removes a file from the architect's map, and every downstream decision is now made on an incomplete picture. So the locator's whole discipline is **recall-first**: enumerate variants, sweep wide, cross-check tools, and bias toward over-search.

This doc fills a gap the `14-codebase-locator` persona names explicitly — its instinct list ends with "search heuristics have thin KB; codified here, not in the library" for exactly eight instincts (`packages/runtime/personas/14-codebase-locator.md:48`). It is a **practitioner-methodology** doc: how to wield `ripgrep`/`grep`, when to climb from text to structural to semantic search, and how to trace references — grounded in the real tools' documentation.

## The Principle

> "You may read code the way an engineer examines a machine to discover what makes it tick, or you may read code because you are scavenging looking for material to reuse … the ability to determine which technique you use when is crucial." — Diomidis Spinellis, *Code Reading: The Open Source Perspective* (2003)

The locator is the **first reader** in the chain. Spinellis's point — match the reading technique to the goal — is the locator's whole job: the goal is *coverage of where*, not *understanding of how*. Reformulated:

- **Recall dominates precision.** Optimize for "I found every file that could match," not "every result is relevant." The architect filters; the locator must not pre-filter into a miss.
- **Enumerate before concluding.** "Not found" is a strong claim. It is only valid after every naming variant, every tool, and the ignore-file blind spots have been checked.
- **Report location, withhold judgment.** The output is a `file:line` map of where code *is*. Behavior is the analyzer's; "where it should be" is the architect's.
- **Climb the ladder when text fails.** Regex is the fast default; structural and semantic search exist for when identifier-shape or nesting defeats line-oriented matching.

## Named Instincts (the locator lens, served)

### `exhaustive-naming-variants`

Before "not found," enumerate every form the concept could wear, then search them as **one** case-insensitive alternation rather than serially:

```bash
rg -i -w '(get|fetch|load|read)_?[Uu]ser(_?[Pp]rofile)?s?'
```

Cover, for a concept like *user profile*:

- **Casings**: `userProfile` (camelCase), `user_profile` (snake_case), `user-profile` (kebab-case), `UserProfile` (PascalCase), `USER_PROFILE` (`SCREAMING_SNAKE_CASE`).
- **Abbreviations / synonyms**: `usr`, `acct`, `profile`/`prof`, `getX`/`fetchX`/`loadX`/`readX`.
- **Plurals & affixes**: `users`/`user`; prefixes (`_lib/`, `is`, `has`); suffixes (`-helpers.js`, `.contract.json`, `Impl`, `Service`).

`ripgrep -i` makes the casing axis free ("matches `fast`, `fASt`, `FAST`" — GUIDE); a `[_-]?` between tokens absorbs the snake/kebab/camel boundary in one pattern. Word boundaries (`-w`, "surrounded by word boundaries" — GUIDE) stop `user` from drowning in `username`, `superuser`, `user_agent` when you want the bare token. One missed variant is one missed file — this instinct is the front line of `no-false-negatives`.

### `where-not-just-what`

Report **paths and line numbers**, not explanations. Use `rg -n` (or `--vimgrep` for `file:line:col`) and present each finding as a citable location with a one-line "what's here" tag — never a paragraph on how it works. Behavior analysis is a different persona (`15-codebase-analyzer`); mixing it in contaminates the documentary stream and trips the locator's no-critique contract (`A4` at `packages/runtime/contracts/14-codebase-locator.contract.json:81`). A finding that is prose-without-a-path is a recall gap dressed as an answer.

### `trace-every-reference`

A symbol's footprint is its **definition plus every use**. After locating the def, follow the references three ways:

```bash
rg -l 'computePostStateHash'                 # every file naming it
rg -n "(import|require).*record-store"        # import sites
rg -nF "from './record-store'"                 # exact module-path string (-F = literal)
```

For symbol-aware tracing across a tree, Sourcegraph's `type:symbol` returns definitions and `select:symbol.function foo` narrows to functions (per the code-search reference). For language-accurate "every call site" without string false-positives, ast-grep matches the **call shape** (`$FN($$$ARGS)`) on the parse tree. The deliverable is the full set of files that *touch* the symbol, not just the one that *declares* it.

### `no-false-negatives`

The load-bearing instinct: **a missed match is the worst outcome.** Defenses:

- **Cross-check a second strategy.** If `rg` finds nothing, retry with `grep -r`, with `Glob`, or with a relaxed pattern. Agreement across two tools raises confidence; a single-tool null is weak evidence.
- **Defeat the ignore blind spot.** ripgrep skips `.gitignore`'d paths by default — a vendored or generated file can hide there. Re-run with `-u`/`-uu`/`-uuu` before declaring absence.
- **Widen, then narrow.** Start broad (drop `-w`, drop anchors, use `-i`); only tighten once you see the shape of the result set. Over-search is recoverable; a confident false "absent" is not.

This is the search analogue of fail-closed error handling (`architecture/discipline/error-handling-discipline`): when uncertain, surface more, not less.

### `breadth-before-depth`

Sweep the **whole tree's surface area** before drilling into any single file. Map the candidate locations first — entrypoints, supporting modules, config, tests — then let the analyzer do deep single-file reading later:

```bash
rg --files | rg -i 'auth'                      # every path mentioning the area
rg -c 'TODO' --type js                          # per-file match counts → hot spots
fd -t f . packages/kernel | sed 's:/[^/]*$::' | sort -u   # directory shape
```

Deep reading is the analyzer's stage; the locator's job is to ensure no candidate *location* is left unenumerated. Drilling one file early is how you miss the other five.

### `entrypoint-finding`

Locate where execution and configuration **enter** a subsystem — the doors, not every room:

- **mains / CLI**: `rg -n 'def main\(|func main\(|if __name__|#!/usr/bin/env'`
- **routes / handlers**: framework markers — `@app.route`, `router.(get|post)`, `addEventListener`, `export async function (GET|POST)` (Next.js), `module.exports =` handlers.
- **exports / public API**: `index.js` barrels, `exports`/`export {`/`export default`, `__all__`, `package.json` `"main"`/`"exports"`.
- **config roots**: `*.config.*`, `.env*`, `settings.json`, `hooks.json`, `pyproject.toml`, `Cargo.toml` at repo/package roots.

Distinguish the entry from the supporting files and surface it with weight. The `hets/stack-skill-map` doc is a worked example of locating per-stack entrypoints and config roots.

### `current-location-not-ideal`

Describe where code **is**, never where it **ought** to be. "`route-decide.js` lives at `packages/kernel/algorithms/`" is a finding; "it should live under `scripts/`" is the architect's call. Relocation opinions, "this is disorganized," and "consider moving" are forbidden by the locator contract's `A4` no-critique check; if a finding tempts a judgment, hand it off as a follow-up for the critic phase (`fallbackAcceptable` at `packages/runtime/contracts/14-codebase-locator.contract.json:99`). This mirrors the is-vs-ought separation in `architecture/discipline/evidence-and-premise-discipline`: report the *is*, label any *ought* and route it elsewhere.

### `empirical-naming-convention`

Infer the repo's **actual** idiom from the evidence in front of you, not the convention you'd expect:

```bash
rg --files packages | rg -o '[^/]+\.(js|json|md)$' | sort | uniq -c | sort -rn
```

Report the observed pattern — e.g. "tests are `*.test.js` collocated under `tests/unit/kernel/`; contracts are `NN-name.contract.json`; helpers are `_lib/*.js` or `*-helpers.js`" — drawn from what `rg --files` shows, never from a house style you assume. An assumed convention is a premise (`evidence-and-premise-discipline`); the file listing is the probe that grounds it.

## ripgrep / grep strategy (the toolbox)

- **Casing**: `-i` for blanket case-insensitivity; `-S`/`--smart-case` to stay sensitive only when the pattern itself has an uppercase letter (per GUIDE) — handy when hunting a `PascalCase` type without drowning in lowercase noise.
- **Word boundaries**: `-w`/`--word-regexp` to isolate the bare token (`\b(?:pat)\b` semantics) — the difference between `id` and `valid`/`idx`/`width`.
- **Multiline**: `-U`/`--multiline` to "permit matches to span multiple lines" — needed for a signature or call broken across lines. ripgrep is line-oriented by default; without `-U` a cross-line pattern silently misses.
- **Scoping**: `-t py` / `-t js` (named type sets; `--type-list` to see them); `-g '!**/dist/**'` to exclude; `-g '*.{ts,tsx}'` to include. Scope shrinks noise and speeds the sweep.
- **Literal vs regex**: `-F`/`--fixed-strings` when the needle contains regex metacharacters (`$ref`, `a.b`, `foo()`); otherwise the `.`/`$`/`(` are interpreted and over- or under-match.
- **Inventory & shape**: `rg --files` (every searched path — already `.gitignore`-filtered), `-c`/`--count-matches` (per-file counts → density map), `-l`/`--files-with-matches` (just the filenames — feeds reference tracing).
- **POSIX fallback**: where only `grep` exists, `grep -rEnw` (recursive, ERE, line-numbers, whole-word) is the portable equivalent of the core `rg` sweep; `-E` selects POSIX extended regex per the Open Group / GNU grep manual.

**Regex for identifier variants.** A single alternation beats N serial searches and keeps recall in one pass: `(snake_case|camelCase)` boundaries with `[_-]?`, optional plural `s?`, optional affixes grouped `(_?[Pp]rofile)?`. Anchor only when you mean it — premature `^`/`$`/`\b` is a common source of false negatives.

## Structural and semantic search (when text isn't enough)

Line-oriented regex has two blind spots: it can't reason about **balanced delimiters / nesting**, and it has **no notion of a symbol** (so `user` the variable, `user` the comment, and `User` the type all match the same text). Climb the ladder:

- **ast-grep** matches **code structure** via tree-sitter (CST) patterns with meta-variables — `console.log($A)`, `$FN($$$ARGS)` — and composes atomic/relational/composite rules "like CSS selectors" (ast-grep docs). Use it for "every call to this function regardless of formatting" or "this pattern only inside that block" — queries regex can't express without fragility.
- **comby** matches with lightweight `:[hole]` templates over **balanced delimiters** per language ("`(:[1])` will only match … well-balanced parentheses" — comby.dev). Good for nested-structure search/rewrite across ~any language without a full grammar.
- **Sourcegraph** adds **symbol-awareness and cross-repo scope**: `type:symbol foo` (definitions), `select:symbol.function foo` (functions only), `repo:`/`file:`/`lang:` filters, `case:yes`, and RE2 regex (per the code-search reference). Its **structural** mode uses `...` "holes" as placeholders for syntactic structures (Sourcegraph structural-search blog). Reach for it when you need the definition + every reference across a large or multi-repo tree, not just one checkout.

**Call-graph / reference tracing**: combine the layers — `rg -l` for the fast candidate set, import-string grep for the wiring, then `type:symbol` / ast-grep for language-accurate def-and-callsite coverage. The map is complete only when definitions *and* usages are both surfaced.

**Sitemap / breadth-first traversal**: `rg --files` (or `fd`) yields the full path inventory in one shot — the locator's "sitemap." Read the tree's shape (top-level dirs, per-package layout, where tests/config live) before drilling, so the breadth sweep precedes any depth dive.

## Substrate Examples

### The locator persona declares this exact KB-gap

`packages/runtime/personas/14-codebase-locator.md:44-50` lists ten named instincts and ends: "**KB-gaps (no doc yet — search heuristics have thin KB; codified here, not in the library):** current-location-not-ideal, exhaustive-naming-variants, where-not-just-what, trace-every-reference, no-false-negatives, breadth-before-depth, empirical-naming-convention, entrypoint-finding." This doc is the library home for those eight; the persona's `Instinct → KB referral` block can now point at `kb:hets/code-search-heuristics` instead of "no doc yet." The contract's `interface.instincts` array (`packages/runtime/contracts/14-codebase-locator.contract.json:128`) enumerates the same set machine-readably.

### Recall-first is enforced by the ≥5-citation contract gate

The locator contract requires `hasFileCitations` with `min: 5` (`F3` at `packages/runtime/contracts/14-codebase-locator.contract.json:48`). That floor is the recall instinct made into a gate: a report with fewer than five `file:line` citations is treated as under-searched and fails verification — the contract operationalizes `no-false-negatives` and `where-not-just-what` at once.

### No-critique is the `current-location-not-ideal` guardrail

The contract's `A4` `noCritiqueLanguage` check forbids "should be", "recommend", "consider", "needs refactoring", etc. (`packages/runtime/contracts/14-codebase-locator.contract.json:81-97`), and `fallbackAcceptable` (line 99) routes any critique to the architect/code-reviewer phase. That is `current-location-not-ideal` enforced: the locator maps where code *is* and hands judgments off, keeping the documentary stream uncontaminated (the RPI doctrine in the contract's `_documentary_note`, line 6).

### Empirical-naming on this very repo

A `rg --files` survey of this codebase yields the observed idioms a locator would report: tests as `*.test.js` under `tests/unit/<area>/`; persona contracts as `NN-name.contract.json` under `packages/runtime/contracts/`; kernel code under `packages/kernel/<subsystem>/`; KB docs under `packages/skills/library/agent-team/kb/<domain>/`. These are reported *as observed*, per `empirical-naming-convention` — not as a style the repo "should" follow.

## Tension with Other Principles

### Recall (over-search) vs Precision / Signal

Biasing toward over-search yields noisy result sets; a reader wants the *relevant* files. **Resolution**: the division of labor is explicit — the locator maximizes recall (find every candidate), the architect/analyzer applies precision (decide which matter). Pre-filtering into a miss is the locator's cardinal sin; an extra candidate is cheap. Scope (`-t`, `-g`) trims *obvious* noise (vendored, generated) without risking real misses.

### Locate-only vs Helpful-explanation (single responsibility)

It is tempting, having found a file, to explain what it does — but that crosses into the analyzer's responsibility. **Resolution**: `architecture/crosscut/single-responsibility` — the locator has one reason to change (where things live); behavior explanation is a separate persona with its own context. Mixing them contaminates downstream reasoning (the contract's documentary doctrine).

### Text-regex speed vs Structural-search accuracy

`ripgrep` is near-instant; ast-grep/comby/Sourcegraph parse and are slower. **Resolution**: start with the fast text sweep; climb the ladder only when regex demonstrably over- or under-matches (nesting, symbol-vs-text ambiguity). Don't pay parse cost for a query a `-w` boundary already answers; don't force a fragile regex for a query that needs the parse tree.

### Surface (`where-not-just-what`) vs Depth (information hiding)

Reporting only paths can feel shallow when the reader wants to know what's *behind* the path. **Resolution**: `architecture/crosscut/information-hiding` — the locator surfaces the module boundary (the door); what's hidden behind it is the analyzer's to open. The map is honest about being a map.

## When to use this doc

- Spawning or acting as the `14-codebase-locator` persona — this is its methodology reference.
- Any "where does X live?" / "which files touch Y?" task, in an unfamiliar or large tree.
- Before concluding "not in the codebase" — to run the variant-enumeration + ignore-blind-spot + second-tool checklist first.
- When a plain `rg` query over- or under-matches and you need to decide whether to climb to structural/semantic search.

## When NOT to use this doc (or apply with caveat)

- **You need behavior, not location** — that is `15-codebase-analyzer`; this doc deliberately stops at `file:line`.
- **Tiny, fully-known codebase** — exhaustive variant enumeration is theater when `rg --files` fits on one screen; just look.
- **The tool isn't available** — fall back along the ladder (`rg` → POSIX `grep -rEnw` → `Glob`/`find`); the *instincts* hold even when the named tool doesn't.

## Failure modes when applied incorrectly

- **Single-variant false negative** — searching `getUser` only, missing `fetch_user` / `UserService`. Counter: always enumerate variants as one alternation (`exhaustive-naming-variants`).
- **Ignore-file blind spot** — declaring absence without `-uu`, so a `.gitignore`'d vendored copy stays invisible. Counter: re-run unrestricted before any "not found."
- **Definition-only trace** — finding the `def` and stopping, leaving call sites unmapped. Counter: `rg -l` + import grep + `type:symbol` for the full footprint (`trace-every-reference`).
- **Critique leakage** — slipping "this should be reorganized" into a locator report. Counter: report `is`, route `ought` to the architect (`current-location-not-ideal`; contract `A4`).
- **Prose-without-a-path** — explaining behavior instead of citing a location, masking a recall gap. Counter: every claim is an openable `file:line` (`where-not-just-what`).
- **Premature anchoring** — a stray `^`/`$`/`\b` silently dropping real matches. Counter: widen first (drop anchors, `-i`), narrow only after seeing the result shape.
- **Regex over-reach on nested code** — a fragile bracket-counting regex that mis-matches. Counter: climb to ast-grep/comby structural search.

## Tests / verification

- **Variant-coverage check**: for the target concept, was every casing + abbreviation + plural searched (ideally in one alternation)? An un-enumerated variant is an untested recall gap.
- **Second-tool corroboration**: was a null result confirmed with a second strategy (`grep`/`Glob`) and an unrestricted (`-uu`) pass? A single-tool null does not justify "absent."
- **Citation floor**: does the report carry ≥5 `file:line` citations (locator contract `F3`)? Fewer signals under-search.
- **Reference completeness**: for a located symbol, are call sites/imports surfaced, not just the definition? A def-only report is half a map.
- **No-critique scan**: does the output contain any forbidden judgment phrase (`should`, `recommend`, `consider`…)? If so, it has left the locator lane (contract `A4`).
- **Is-vs-ought separation**: is every finding a description of where code *is*, with any "where it should be" routed to the architect handoff?

## Related Patterns

- [hets/spawn-conventions](spawn-conventions.md) — the output-format, frontmatter, and documentary-discipline contract for HETS spawns; the locator's `report-paths-not-prose` / `critique-is-not-mine` instincts refer here.
- [architecture/crosscut/single-responsibility](../architecture/crosscut/single-responsibility.md) — locate-don't-analyze: the locator has one reason to change; behavior explanation is a separate persona.
- [architecture/crosscut/information-hiding](../architecture/crosscut/information-hiding.md) — `where-not-just-what`: surface the module boundary (the path); what's behind it is the analyzer's to open.
- [architecture/discipline/evidence-and-premise-discipline](../architecture/discipline/evidence-and-premise-discipline.md) — `empirical-naming-convention` and `current-location-not-ideal` are is-vs-ought discipline: report the observed pattern (the probe), not the assumed one; label any *ought*.
- [architecture/discipline/error-handling-discipline](../architecture/discipline/error-handling-discipline.md) — `no-false-negatives` is fail-closed recall: when uncertain, surface more, not less.
- [hets/stack-skill-map](stack-skill-map.md) — a worked example of `entrypoint-finding`: per-stack entrypoints, config roots, and test locations.

## Sources

Authored by multi-source synthesis of (each web-verified at authoring time):

1. **Andrew Gallant (BurntSushi), ripgrep GUIDE.md** — the authoritative reference for `ripgrep` flags used throughout: `-i/--ignore-case` ("matches `fast`, `fASt`, `FAST`"), `-S/--smart-case`, `-w/--word-regexp` ("surrounded by word boundaries"), `-U/--multiline` ("span multiple lines"), `-t/--type` + `--type-list`, `-g/--glob` with `!` negation, `-F/--fixed-strings`, `-o/--only-matching`, and `.gitignore`-respect-by-default. Verified against `github.com/BurntSushi/ripgrep/blob/master/GUIDE.md`.
2. **GNU grep manual + The Open Group POSIX `grep` utility** — the portable fallback: `-E` (POSIX extended regex), `-w` (whole-word), `-i` (ignore-case), `-r` (recursive). Verified against `gnu.org/software/grep/manual/grep.html` and `pubs.opengroup.org/onlinepubs/009695399/utilities/grep.html`.
3. **Sourcegraph code-search reference** — symbol-aware and cross-repo search: `type:symbol`, `select:symbol.function`, `repo:`/`file:`/`lang:`/`case:yes` filters, RE2 regex syntax, and structural patterns with `...` "holes." Verified against `sourcegraph.com/docs/code_search/reference/language` and the structural-search blog post.
4. **ast-grep documentation** — structural search over tree-sitter CST: code-shaped patterns, meta-variables (`$A`, `$$$ARGS`), and atomic/relational/composite rules "like CSS selectors." Verified against `ast-grep.github.io/guide/pattern-syntax.html` and `/advanced/core-concepts.html`.
5. **comby.dev** — lightweight structural match/rewrite with `:[hole]` templates over balanced delimiters across many languages. Verified against `comby.dev/docs/basic-usage`.
6. **Diomidis Spinellis, *Code Reading: The Open Source Perspective*** (Addison-Wesley, 2003) — code reading as a first-class skill; reading as an engineer (how it ticks) vs as a scavenger (reuse), and matching the technique to the goal — the framing for the locator's recall-first, location-only stance.

Substrate references cite the `14-codebase-locator` persona's declared KB-gap (`packages/runtime/personas/14-codebase-locator.md:44-50`), its contract's `F3` ≥5-citation gate, `A4` no-critique check, `fallbackAcceptable` handoff, and `interface.instincts` array (`packages/runtime/contracts/14-codebase-locator.contract.json`).

## Phase

Authored: kb authoring batch (v3.1 Runtime Foundation closed; persona-instinct depth detour / single-lens KB-gap harvest). Fills the eight search-heuristic KB-gaps the `14-codebase-locator` persona flags inline. Multi-source synthesis from six web-verified tool/reference sources (ripgrep, GNU/POSIX grep, Sourcegraph, ast-grep, comby) plus Spinellis's *Code Reading*. Each named instinct is served as a subsection with the concrete tool move that satisfies it; substrate examples bind the instincts to the persona file and its enforcing contract gates (`F3` citation floor, `A4` no-critique). Serves the HETS `codebase-locator` lens (recall-first, location-only, documentary).
