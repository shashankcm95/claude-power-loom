---
kb_id: web-dev/accessibility-essentials
version: 1
tags:
  - web
  - frontend
  - mobile
  - accessibility
  - a11y
  - foundational
  - quality-baseline
sources_consulted:
  - "Web Content Accessibility Guidelines (WCAG) 2.2 — W3C Recommendation, 2024-12-12 (w3.org/TR/WCAG22) — the four POUR principles + SC 1.4.3 / 2.4.7 / 2.4.11 / 2.5.8 / 4.1.2"
  - "WCAG 2.2 Understanding SC 1.4.3 Contrast (Minimum) — W3C (w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) — 4.5:1 normal / 3:1 large-text ratios"
  - "WAI-ARIA Authoring Practices Guide (APG) — W3C WAI (w3.org/WAI/ARIA/apg) — design patterns, accessible name/description, 'No ARIA is better than Bad ARIA'"
  - "MDN Web Docs — ARIA / Accessibility (developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA) — the verbatim 'first rule of ARIA use'; native-semantics-first guidance"
  - "Apple Human Interface Guidelines — Accessibility + VoiceOver (developer.apple.com/design/human-interface-guidelines/accessibility) — VoiceOver labels, Dynamic Type ≥200%, accessibility labels/traits/values"
  - "Heydon Pickering — Inclusive Components (inclusive-components.design, 2018) — accessible component patterns: menus, tabs, tooltips, data tables, cards"
  - "The A11Y Project — Accessibility Checklist (a11yproject.com/checklist) — WCAG-A/AA practitioner checklist across semantics, color, keyboard, controls"
related:
  - web-dev/react-essentials
  - architecture/discipline/trade-off-articulation
  - architecture/crosscut/single-responsibility
  - architecture/discipline/reliability-scalability-maintainability
  - architecture/discipline/error-handling-discipline
status: active+enforced
---

## Summary

**Principle**: Accessibility is a **baseline quality, not a bolt-on feature**. A user interface that a keyboard or a screen-reader user cannot operate is broken — the same defect class as a crash, not a polish pass.
**The frame (WCAG 2.2)**: content must be **Perceivable, Operable, Understandable, Robust** (POUR).
**The mechanism**: semantic structure first (native HTML / native platform controls); ARIA (or platform accessibility APIs) only to fill gaps native semantics cannot express — never to replace them.
**The test**: name-role-value for every interactive element; keyboard/switch operability; visible focus; sufficient contrast; respect text scaling; **verify with the actual assistive tech** (screen reader / VoiceOver), not just static analysis.
**Sources**: WCAG 2.2 (W3C Rec 2024) + WAI-ARIA APG + MDN + Apple HIG + Inclusive Components + The A11Y Project.
**Substrate**: the canonical a11y referral for the `09-react-frontend` (instinct: *accessibility-first*) and `06-ios-developer` (instinct: *accessibility-as-baseline*) lenses; a Runtime-layer concern, never a kernel one.

## Quick Reference

**POUR — the four WCAG 2.2 principles** (w3.org/TR/WCAG22):

| Principle | One-line | Web checks | iOS checks |
|-----------|----------|-----------|-----------|
| **Perceivable** | Info presentable in ways users can perceive | alt text; captions; contrast; not-color-alone | image `accessibilityLabel`; contrast; Dynamic Type |
| **Operable** | UI + navigation operable | keyboard; visible focus; target size; no traps | VoiceOver/Switch Control; focus order; hit target ≥44pt |
| **Understandable** | Readable + predictable + input assistance | labels; consistent nav; error messages | clear labels; consistent gestures; helpful errors |
| **Robust** | Compatible across tech / assistive tech | valid name-role-value; semantic HTML | correct traits; standard controls |

**The native-semantics-first discipline (the "first rule of ARIA")** — MDN, verbatim:

> "If you can use a native HTML element or attribute with the semantics and behavior you require already built in, instead of re-purposing an element and adding an ARIA role, state or property to make it accessible, then do so."

**Order of preference (both platforms)**: native element/control → native + minimal ARIA/trait to fill a gap → fully custom + full ARIA/accessibility-API contract (you now own ALL the behavior).

**Hard numbers worth memorizing**:

| Check | Threshold | Source (SC) |
|-------|-----------|-------------|
| Contrast — normal text | ≥ **4.5:1** | WCAG 1.4.3 (AA) |
| Contrast — large text (≥18pt, or ≥14pt bold) | ≥ **3:1** | WCAG 1.4.3 (AA) |
| Non-text contrast (UI components, focus rings) | ≥ **3:1** | WCAG 1.4.11 (AA) |
| Target size (minimum) | ≥ **24×24 CSS px** | WCAG 2.5.8 (AA) |
| Text resize / scaling | up to **200%** without loss | WCAG 1.4.4 (AA); Apple Dynamic Type |
| Visible focus indicator | required for every focusable element | WCAG 2.4.7 (AA) |

**Top smells**:

- A `<div onClick>` (or a `View` with a tap gesture) where a `<button>` (or `Button`) belongs — no role, no keyboard, no focus.
- `role="button"` on a `<div>` to "make it a button" instead of using `<button>` — the bad-ARIA trap.
- Color as the only signal ("required fields are red") — fails not-color-alone.
- `outline: none` with no replacement focus style — invisible focus.
- Fixed `px`/`pt` font sizes that ignore `rem` / Dynamic Type — breaks text scaling.
- "We'll add accessibility later" — the bolt-on anti-pattern this doc exists to refuse.

**Platform mapping (web ⇄ iOS)** — same concept, two vocabularies:

| Concept | Web | iOS / SwiftUI |
|---------|-----|---------------|
| Accessible name | label / `aria-label` / `<label for>` | `.accessibilityLabel(_:)` |
| Role | semantic element / `role` | `.accessibilityAddTraits(_:)` (`.isButton`, `.isHeader`…) |
| Value/state | `aria-checked`, `aria-expanded`, `<progress value>` | `.accessibilityValue(_:)` |
| Screen reader | NVDA / JAWS / VoiceOver (desktop) | **VoiceOver** |
| Text scaling | `rem` + `1.4.4` resize | **Dynamic Type** (`.dynamicTypeSize`, scaled fonts) |
| Audit tool | axe / Lighthouse / browser a11y tree | **Accessibility Inspector** (Xcode) |

**Apply when**: any spawn produces user-facing UI under the react-frontend or ios-developer lens.
**Skip when**: kernel/CLI/library work with no rendered UI surface (most of this substrate).

## Intent

Most inaccessible interfaces are not built by developers who *decided* to exclude disabled users — they are built by developers who never made accessibility a gate. The defect enters the same way every other deferred-quality defect enters: "ship the happy path now, harden later." The keyboard-only user, the screen-reader user, and the low-vision user who needs 200% text are not edge cases on the happy path — they *are* a real slice of every product's users, and they hit the broken path on the very first interaction.

The fix is not heroics at the end. It is treating accessibility as a **baseline constraint the same way you treat "it compiles" or "it doesn't crash"**: a property the work must have *before* it is considered done, enforced at review time by a lens that reflexively asks "can a keyboard and a screen reader actually use this?" That is exactly how the substrate's `09-react-frontend` and `06-ios-developer` personas frame it — a11y is a CRITICAL-class / ship-blocker defect, not an enhancement.

The intent of this doc is to convert "accessibility" from a vague aspiration into a small set of **checkable, sourced commitments** (POUR + semantics-first + the hard numbers above) that a reviewer can apply in minutes and a builder can satisfy from the start.

## The Principle

> "If you can use a native HTML element or attribute with the semantics and behavior you require already built in … then do so." — *MDN Web Docs, the first rule of ARIA use*

and its corollary, the load-bearing warning from the WAI-ARIA APG and MDN:

> "No ARIA is better than Bad ARIA."

Reformulated for both platforms:

- **Semantics come from the platform, not from you.** A `<button>`, `<a href>`, `<input>`, `<nav>`, `<h1>` (and on iOS a `Button`, `Toggle`, `NavigationStack`) ship a *correct* role, keyboard/focus behavior, and assistive-tech exposure for free. Re-implementing that with generic containers + ARIA/traits means you now own all of it, and you will get some of it wrong.
- **ARIA / accessibility traits FILL gaps; they do not REPLACE semantics.** Use them when no native primitive expresses the pattern (a custom combobox, a tab set, a live region) — and when you do, you owe the full name-role-value + keyboard contract the native element would have given you.
- **Every interactive element has a name, a role, and a value/state** (WCAG 4.1.2 Name, Role, Value). If a screen reader announces "button" with no name, or announces nothing at all, the element does not exist for that user.
- **Operability is keyboard/switch-first.** If you can't reach it and activate it without a mouse/touch — Tab to it, see the focus, Enter/Space to fire — it is not operable (WCAG 2.1 Keyboard; 2.4.7 Focus Visible).
- **Robustness means assistive tech can parse it.** Valid markup + correct roles = the accessibility tree the screen reader walks. Bad ARIA actively *corrupts* that tree — WebAIM's million-homepage survey (cited by MDN) found pages with ARIA averaged ~41% *more* detected errors than pages without.

## POUR in practice

### Perceivable

Information must reach every sense channel a user has available.

- **Text alternatives** (WCAG 1.1.1): every informative image gets `alt`; decorative images get `alt=""` (web) or are hidden from VoiceOver (iOS). An icon-only button needs an accessible *name*, not just a glyph.
- **Color is never the only channel** (WCAG 1.4.1): pair color with text, an icon, or a pattern. "Errors are red" fails; "errors are red **and** prefixed with an error icon **and** described in text" passes.
- **Contrast** (WCAG 1.4.3 / 1.4.11): meet 4.5:1 (normal text), 3:1 (large text, and non-text UI like focus rings and input borders).
- **Captions / transcripts** for time-based media (1.2.x).

### Operable

Everything must be reachable and triggerable without a mouse or precise pointer.

- **Keyboard / switch operability** (WCAG 2.1.1): all interactive elements reachable and operable by keyboard (web) or VoiceOver/Switch Control (iOS); **no keyboard traps** (2.1.2).
- **Visible focus** (WCAG 2.4.7): the focused element is unmistakable. Never `outline: none` without an equal-or-better replacement. WCAG 2.2 strengthens this with 2.4.11 *Focus Not Obscured* (a sticky header must not hide the focused control).
- **Focus management**: when a dialog opens, move focus into it and trap it there; on close, return focus to the trigger. SPA route changes should move focus to the new view's heading so screen-reader users aren't stranded.
- **Target size** (WCAG 2.5.8): interactive targets ≥ 24×24 CSS px (web); Apple HIG recommends ≥ 44×44 pt hit targets (iOS).

### Understandable

- **Name everything**: `<label for>` / `aria-labelledby` (web), `.accessibilityLabel` (iOS). A placeholder is **not** a label.
- **Predictable, consistent** navigation and component behavior (WCAG 3.2.x); WCAG 2.2 adds 3.2.6 *Consistent Help*.
- **Helpful errors** (WCAG 3.3.1/3.3.3): say what went wrong *and the next action*. This is exactly where technical accessibility meets the substrate's usability lens (see Tensions).

### Robust

- **Name, Role, Value** (WCAG 4.1.2): the cornerstone. Custom widgets must expose all three programmatically.
- **Valid, semantic markup** so the assistive-tech accessibility tree is well-formed. On iOS, use standard controls and correct traits so VoiceOver describes element *type* and *status*, not just text.

## Semantics-first, ARIA-as-fallback (the decision the lens enforces)

The single highest-leverage habit, on both platforms:

1. **Reach for the native element/control first.** `<button>`, `<a>`, `<select>`, `<input type=...>`, `<dialog>`, `<details>`; `Button`, `Toggle`, `Picker`, `NavigationStack`, `.sheet`.
2. **If no native primitive fits**, build the custom widget against a *named pattern* (the WAI-ARIA APG documents the keyboard + ARIA contract for combobox, tabs, menu, disclosure, dialog, etc.; Heydon Pickering's *Inclusive Components* walks the same patterns end-to-end). On iOS, compose standard controls and add the missing trait/label/value rather than re-rolling a control from a bare `View`.
3. **When you go custom, you owe the WHOLE contract**: name + role + value + every keyboard interaction (Arrow keys, Home/End, Esc, Enter/Space) the native element would have provided. Half a contract ("we added `role="tablist"` but arrow keys don't work") is bad ARIA — worse than none.

The anti-pattern this prevents: `<div role="button" onClick>` instead of `<button>`. The `<button>` gives you focusability, Enter/Space activation, the button role, and disabled-state semantics for free; the `div` version typically ships *none* of those and the author rarely notices because they test with a mouse.

## Substrate-Specific Examples

> **Honest scope note**: Power Loom is a CLI/kernel substrate. Accessibility is a **Runtime-layer** concern that applies *only* when a spawn produces user-facing UI under a UI lens — never to the kernel, the hooks, the record-store, or the CLI itself. The examples below are deliberately light and bounded to that surface.

### `09-react-frontend` — accessibility-first as a named instinct

The react-frontend persona (`packages/runtime/personas/09-react-frontend.md`) lists *accessibility-first* as instinct #2, framed verbatim as: "Every interactive element gets a focus state, every image alt text, every input a label; semantic HTML before ARIA, ARIA before nothing. **A11y is a CRITICAL-class defect, not a polish pass.**" This doc is that instinct's KB referral: when the lens drives an a11y finding on a spawn's React output, it cites the POUR check and the semantics-first rule from here rather than re-deriving them. The persona's contract (`09-react-frontend.contract.json`) is the structural side of the same gate.

### `06-ios-developer` — accessibility-as-baseline as a ship-blocker

The ios-developer persona (`packages/runtime/personas/06-ios-developer.md`) lists *accessibility-as-baseline* as instinct #9: "Can VoiceOver and Dynamic Type users actually use this? Every interactive element needs a label; text must scale with Dynamic Type. **Not an enhancement — a ship-blocker for a meaningful slice of real users.**" The platform-mapping table above is the bridge that lets one canonical doc serve both lenses: a finding phrased as "missing accessible name" maps to `aria-label` for web review and `.accessibilityLabel` for iOS review.

### `02-confused-user` — the adjacent, complementary lens (clarity, not a11y)

The substrate's `02-confused-user` persona (`packages/runtime/personas/02-confused-user.md`) is the **usability adversary** — it reads docs, error strings, and flows "as someone unfamiliar with the system" and flags ambiguity, jargon, and dead-end errors. That is **clarity/legibility**, which is *adjacent to but distinct from* technical accessibility:

- A button labeled "Process" passes a name-role-value (a11y) check but fails the confused-user (clarity) check — process *what?*
- An error with `aria-live="assertive"` is technically perceivable (a11y) yet still strands the user if it says "Error 0x4" with no remedy (clarity).

They are complementary gates: confused-user covers WCAG's *Understandable* edge (helpful errors, predictable labels), while this doc owns the *Perceivable / Operable / Robust* machinery. Run both on user-facing UI; neither subsumes the other.

## Tension with Other Principles

### A11y baseline vs YAGNI / velocity

"Accessibility later" feels like YAGNI applied to a hypothetical user. It is not — the keyboard and screen-reader users exist on day one. **Resolution**: the *baseline* (semantic elements, labels, visible focus, contrast) is essentially free when done from the start and expensive as a retrofit; treat it as part of "done," like error handling. The genuinely deferrable tail (AAA criteria, exotic widget polish) is where YAGNI legitimately applies — articulate that line explicitly (see [trade-off-articulation](../architecture/discipline/trade-off-articulation.md)).

### Native semantics vs design/visual control

Designers sometimes want a control that no native element matches visually, pushing toward custom `div`/`View` widgets. **Resolution**: style the native element (you can restyle `<button>` and SwiftUI `Button` almost arbitrarily) before abandoning it; only go custom when the *interaction*, not just the skin, is genuinely novel — and then pay the full APG contract.

### A11y (machine-perceivable) vs clarity (human-understandable)

Covered above: the confused-user lens and this doc overlap at WCAG *Understandable* but are not the same gate. A label can be programmatically perfect and humanly useless. Run both.

### Reduced-motion and the motion budget

Rich animation can harm users with vestibular disorders (WCAG 2.3.3 Animation from Interactions). **Resolution**: honor `prefers-reduced-motion` (web) / Reduce Motion (iOS) — the motion-ui-engineering skill already enforces a reduced-motion budget, which is the operational expression of this tension.

## When to use / When NOT to use

**Use this doc when**:

- A spawn produces or modifies **user-facing UI** under the `09-react-frontend` or `06-ios-developer` lens.
- Reviewing a component, screen, form, dialog, or navigation flow.
- A `tech-stack-analyzer` plan resolves a web or iOS UI build (referral target for the UI personas).

**Do NOT reach for it when**:

- The work is kernel / hooks / record-store / CLI / pure library code with **no rendered UI** — that is the vast majority of this substrate, and a11y simply does not apply (forcing it would be theater).
- The concern is *clarity of prose/errors* with no assistive-tech dimension — that is the `02-confused-user` lens (adjacent, not this).
- You are tempted to bolt ARIA onto something a native element already handles — the right move is to *remove* the custom widget, not document its ARIA here.

## Failure modes

- **Bolt-on accessibility** — leaving a11y to a final pass; it never comes, or arrives as expensive retrofit. *Fix*: gate at review via the persona instinct; baseline is part of "done."
- **ARIA as a band-aid** — `role="button"` / `tabindex="0"` sprinkled on `div`s to simulate a `<button>` while shipping none of its behavior. *Fix*: native element; "No ARIA is better than Bad ARIA."
- **Mouse-only / touch-only testing** — author never tabs through or runs VoiceOver, so keyboard traps and missing names ship silently. *Fix*: the verification step below — exercise the actual assistive tech.
- **Invisible focus** — `outline: none` for aesthetics with no replacement. *Fix*: provide a clear `:focus-visible` style (web) / rely on the system focus ring (iOS).
- **Hard-coded sizes** — `px`/`pt` fonts that ignore `rem` / Dynamic Type, breaking at 200%. *Fix*: relative units (web) + scaled fonts / `.dynamicTypeSize` (iOS).
- **Contrast regressions** — a brand-color refresh quietly drops text below 4.5:1. *Fix*: automated contrast check in CI (axe/Lighthouse).
- **Color-only signaling** — status conveyed by hue alone. *Fix*: add text/icon/shape.

## Tests / verification

Static analysis catches a floor (~30–50% of issues); the rest needs the real assistive tech. The A11Y Project checklist is a good practitioner spine.

**Automated (the floor)**:

- **Web**: `axe-core` / Lighthouse accessibility audit / `eslint-plugin-jsx-a11y` in CI; inspect the browser accessibility tree.
- **iOS**: Xcode **Accessibility Inspector** (audit + element inspection); UI tests asserting `accessibilityLabel` / traits on key controls.

**Manual (the part automation cannot do)**:

- **Keyboard-only pass (web)**: unplug the mouse. Tab through every interactive element — reachable? visible focus? logical order? Enter/Space activates? dialogs trap + restore focus? no traps?
- **Screen-reader pass**: navigate the flow with **VoiceOver** (iOS/macOS) or NVDA (Windows). Does every control announce a meaningful **name, role, and value/state**? Are images described or correctly hidden?
- **Text-scaling pass**: set OS text to 200% (web zoom / iOS Dynamic Type at the largest setting). Does anything overlap, clip, or truncate? (Apple HIG: support scaling to at least 200%.)
- **Contrast pass**: sample text and UI components against their backgrounds — 4.5:1 / 3:1.
- **Reduced-motion pass**: enable Reduce Motion / `prefers-reduced-motion` and confirm non-essential animation is suppressed.

**The load-bearing test**: *can you complete the primary task using only the keyboard, and again using only the screen reader?* If not, the UI is broken for those users — a CRITICAL finding, the same severity as a crash.

## Related Patterns

- [web-dev/react-essentials](react-essentials.md) — the React idioms these a11y checks layer onto; the react-frontend lens pairs both.
- [architecture/discipline/trade-off-articulation](../architecture/discipline/trade-off-articulation.md) — articulate the baseline-vs-deferrable-tail line (AA baseline now, AAA tail later) explicitly rather than implicitly dropping a11y.
- [architecture/crosscut/single-responsibility](../architecture/crosscut/single-responsibility.md) — a control with one clear responsibility maps cleanly to one role/name/value; god-components muddy the accessibility tree.
- [architecture/discipline/reliability-scalability-maintainability](../architecture/discipline/reliability-scalability-maintainability.md) — accessibility is a maintainability/quality attribute; it belongs in the same "non-negotiable baseline" tier.
- [architecture/discipline/error-handling-discipline](../architecture/discipline/error-handling-discipline.md) — WCAG *Understandable* error guidance overlaps error-handling; the `02-confused-user` lens covers the clarity half.

## Sources

Authored by multi-source synthesis of verified, canonical standards (each URL web-fetched during authoring):

1. **WCAG 2.2** — W3C Recommendation, published 2024-12-12 (w3.org/TR/WCAG22). The four POUR principles (verbatim) and the success criteria cited throughout (1.1.1, 1.4.1, 1.4.3, 1.4.4, 1.4.11, 2.1.1/2, 2.4.7, 2.4.11, 2.5.8, 3.2.6, 3.3.x, 4.1.2). WCAG 2.2 added nine criteria, including Focus Not Obscured, Focus Appearance, Target Size (Minimum), and Dragging Movements.
2. **WCAG 2.2 Understanding SC 1.4.3 Contrast (Minimum)** — W3C (w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). The 4.5:1 (normal) / 3:1 (large-text; ≥18pt or ≥14pt bold) thresholds.
3. **WAI-ARIA Authoring Practices Guide (APG)** — W3C WAI (w3.org/WAI/ARIA/apg). The named-pattern keyboard + ARIA contracts for custom widgets; "No ARIA is better than Bad ARIA."
4. **MDN Web Docs — ARIA** (developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA). The verbatim "first rule of ARIA use" and the native-semantics-first guidance; cites WebAIM's million-homepage finding that pages with ARIA averaged ~41% more detected errors.
5. **Apple Human Interface Guidelines — Accessibility + VoiceOver** (developer.apple.com/design/human-interface-guidelines/accessibility). VoiceOver labels/descriptions, the requirement to convey element type + status/value, Dynamic Type scaling to ≥200%, and accessibility labels/traits/values for custom controls.
6. **Heydon Pickering — Inclusive Components** (inclusive-components.design, 2018). End-to-end accessible component patterns (menus & menu buttons, tabbed interfaces, tooltips & toggletips, data tables, cards, collapsible sections).
7. **The A11Y Project — Accessibility Checklist** (a11yproject.com/checklist). A WCAG-A/AA practitioner checklist across semantics, color/contrast, keyboard, and controls — the operational spine for the verification section.

Substrate grounding cites the live persona definitions `packages/runtime/personas/09-react-frontend.md` (instinct #2, accessibility-first), `06-ios-developer.md` (instinct #9, accessibility-as-baseline), and `02-confused-user.md` (the adjacent usability/clarity lens), plus their contracts under `packages/runtime/contracts/`.

## Phase

Authored: kb authoring batch (web-dev / mobile UI). The canonical accessibility referral shared by the `09-react-frontend` and `06-ios-developer` lenses; deliberately scoped as a Runtime-layer concern (user-facing UI only), explicitly NOT a kernel concern. Multi-source synthesis from seven verified standards/sources; substrate examples kept light and honest about the CLI/kernel substrate's narrow UI surface. The platform-mappings table (web ARIA/semantics ⇄ iOS VoiceOver / Dynamic Type / Accessibility Inspector) is the bridge that lets one doc serve both lenses; the `02-confused-user` clarity lens is named as complementary, not subsumed.
