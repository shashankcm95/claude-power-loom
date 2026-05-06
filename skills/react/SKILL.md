---
skill: react
status: active
domain: web-dev
canonical_source: https://react.dev/reference/react
forged_via: H.6.7-canonical-source-registry
related_kb: [web-dev/react-essentials, web-dev/typescript-react-patterns]
notes: Always v18+ (concurrent rendering, automatic batching, hooks reference); skip the deprecated reactjs.org docs.
---

# React

Specialist skill for the `09-react-frontend` HETS persona (and any other persona that needs React expertise). Loaded on demand via the `Skill` tool when the spawn prompt lists `react` as required.

## When to use this skill

Trigger when:
- Building or modifying React components (function components — class components are legacy)
- Designing component composition, state management, data flow, custom hooks
- Debugging render loops, stale closures, missing deps, hydration mismatches
- Writing accessibility (a11y) into UI work — semantic HTML, ARIA, keyboard nav, focus management

**Skip** when the work is React Native (different rendering primitives — use `react-native` skill); pure CSS / styling without component changes; or test-only work where the testing pattern is the focus and React itself is incidental.

## Core competencies

### Hooks rules + idioms

- **Rules of Hooks** (enforced by lint, but understand the why): only call hooks at the top level of a function component or another custom hook; never inside loops, conditions, or nested functions. The dependency array is how React tracks which hooks correspond to which call sites — change the order and React loses track of state across renders.
- **`useState`** for local component state; **`useReducer`** when state transitions have explicit shape (form steps, multi-action flows).
- **`useEffect`** ONLY for synchronizing with external systems (subscriptions, DOM measurements, network calls). Don't use `useEffect` to derive state from props — compute it in render.
- **`useMemo` / `useCallback`** are optimizations. Default to NOT using them; add when a measured re-render cost shows up in profiler. Premature memoization adds dependency-tracking overhead without benefit.
- **`useRef`** for values that persist across renders without triggering them (DOM nodes, prior values, mutable counters). Reading `.current` mid-render is fine; writing it during render is a bug.

See `kb:web-dev/react-essentials` for the full hooks + state-management reference.

### Component design

- **Function components only** for new code. Class components are still supported but no new APIs target them.
- **Composition over inheritance**: pass children, render-prop functions, or component instances as props instead of subclassing.
- **Single responsibility**: a component that fetches data, manages state, and renders presentation should be split into a hook (data + state) + a presentational component.
- **Prefer derived state in render** over `useEffect` + `setState`: if `B = f(A)`, just compute `B` from `A` in the render body — don't store it as state.
- **Lift state up** to the closest common ancestor only when ≥2 children need it. Premature lifting bloats parent components and creates unnecessary re-renders.

### Concurrent rendering (React 18+)

- **Automatic batching**: state updates inside Promises, setTimeouts, native event handlers are now batched (pre-18 they weren't). Don't write code that relied on the older behavior.
- **`useTransition`** for non-urgent state updates (filter changes, large list re-sorts) — keeps the UI responsive while the heavy update happens off the main lane.
- **`useDeferredValue`** for derived values you want to lag the input (debounced search, expensive derivations).
- **Suspense** for declarative async — works with libraries that support it (relay, react-router 6.4+, Next.js App Router); not yet first-class for arbitrary fetch.

### Forms + controlled inputs

- **Controlled by default** — every input's value comes from state, every change updates state. Predictable, testable.
- **Uncontrolled with `useRef`** for form fields you don't need to validate mid-typing (file inputs, integration with non-React widgets).
- **Form libraries** (react-hook-form, formik) for non-trivial forms — handle validation, dirty tracking, submission state out of the box.

### Data fetching

- **Don't roll your own** — use Tanstack Query (react-query), SWR, Relay, or framework-native data loaders (Next.js App Router, Remix). They handle caching, dedup, refetch-on-focus, optimistic updates.
- **Loading + error states are mandatory**, not afterthoughts. Show skeletons or progress; never blank the screen mid-fetch.
- **Server components** (Next.js App Router, RSC) move fetching to the server — render-only props on the client. Reserves client bundle for interactivity.

### Performance

- **Profile before optimizing**: React DevTools Profiler shows actual render times. Don't assume — measure.
- **Common wins**: memoize expensive children with `React.memo`; stabilize callbacks with `useCallback`; virtualize long lists (react-window, react-virtual); split routes for code-splitting.
- **Common traps**: passing new object/array literals as props on every render breaks `React.memo`; non-stable keys in lists destroy reconciliation efficiency; `useEffect` with missing deps causes stale-closure bugs.

### Accessibility (a11y)

- **Semantic HTML first** — `<button>` not `<div onClick>`; `<nav>` / `<main>` / `<aside>` for landmarks; `<label>` linked to inputs.
- **Focus management**: when a modal opens, focus moves into it; when it closes, focus returns to the trigger. Use `inert` on background; trap focus inside.
- **Keyboard nav**: every interaction reachable via Tab + Enter/Space; visible focus rings (don't `outline: none` without an `:focus-visible` replacement).
- **ARIA only when semantic HTML can't express it** — `aria-label` for icon buttons, `aria-live` for status updates, `role="dialog"` for modals.
- **Tools**: axe DevTools, eslint-plugin-jsx-a11y, lighthouse a11y audit. CI-gate the lighthouse score.

### TypeScript + React

- **Function component types**: use return-type inference; avoid `React.FC` (issues with implicit children). Type props explicitly: `function Card({ title, children }: { title: string; children: React.ReactNode })`.
- **Hooks**: most hooks infer return types correctly. For `useState`, when the initial value is `null`/`undefined`, supply a type explicitly: `useState<User | null>(null)`.
- **Event handlers**: use the React-namespaced types: `React.MouseEvent<HTMLButtonElement>`, `React.ChangeEvent<HTMLInputElement>`. They're tighter than the DOM types.

See `kb:web-dev/typescript-react-patterns` for deeper TS+React idioms.

## Common pitfalls

1. **`useEffect` for derived state** — if you compute B from A inside an effect that runs every time A changes, you've added a useless render cycle. Just compute B in the render body.
2. **Stale closures in event handlers** — `useEffect(() => { listener.on('event', () => setCount(count + 1)) })` will use the count from when the effect ran, not the latest. Use functional updates: `setCount(c => c + 1)`.
3. **Object literals as props on every render** — `<Child config={{ foo: 'bar' }} />` creates a new object every render, breaking `React.memo`. Move it outside the component or memoize.
4. **Missing keys on list items** — React falls back to index, which breaks reconciliation when items reorder, get inserted, or removed. Use stable IDs from your data model.
5. **Calling hooks conditionally** — eslint catches this; the underlying issue is React tracks hooks by call order, not name. Conditional calls = misaligned state.
6. **Missing dep array on `useEffect`** — runs every render. Almost never what you want; usually a sign the effect should be a render-time computation instead.
7. **Hydration mismatches in SSR** — server renders one tree, client renders a different one (e.g., using `Date.now()` in render). Use `useEffect` to set client-only values after mount.

## Sources

- React reference: https://react.dev/reference/react (canonical source per `kb:hets/canonical-skill-sources` H.6.7 registry)
- Hooks reference: https://react.dev/reference/react/hooks
- Rules of React: https://react.dev/reference/rules
- Server Components docs (Next.js App Router): https://nextjs.org/docs/app
- jsx-a11y plugin: https://github.com/jsx-eslint/eslint-plugin-jsx-a11y

## When to forge specialized sub-skills

If a task surfaces a sub-domain not adequately covered above (state libraries beyond useState/useReducer — Redux/Zustand/Jotai patterns; styling libraries — styled-components, emotion, vanilla-extract; testing — RTL idioms beyond basic), surface a `request: forge-skill` via missing-capability-signal back to root. Don't try to cover everything here — this skill is the React-baseline; specialists go in their own skill files.
