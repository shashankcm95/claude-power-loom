---
kb_id: web-dev/react-essentials
version: 1
tags: [web, frontend, react, javascript]
---

## Summary

React essentials for HETS web-dev personas: function components + hooks (`useState`, `useEffect`, `useContext`, `useMemo`, `useCallback`); composition over inheritance; controlled vs uncontrolled inputs; stable list keys; effect cleanup functions; Server Components for data-fetching; Suspense + Error Boundaries for async states; ref-forwarding for imperative escape hatches.

## Full content

### When to use this KB doc

This is a starter doc for the `web-dev` topic, used by `09-react-frontend` (planned) and any `04-architect` working on a React-flavored task. It's intentionally a survey, not a deep API reference — agents needing depth should resolve specific topic docs (e.g., `kb:web-dev/react-server-components` when those are authored).

### Core idioms

**Function components + hooks** are the only modern React. Class components exist in legacy code; don't author new ones.

**Composition over inheritance** — props.children, render props, and HOCs (deprecated) are all forms of composition. Inheritance is not idiomatic in React.

**Controlled inputs** wire `value` + `onChange` to component state. **Uncontrolled inputs** use `ref` + `defaultValue`. Default to controlled unless integrating with non-React form libraries.

**Stable list keys** — never use array index as key for lists that can reorder. Use stable IDs from your data.

**Effect cleanup** — `useEffect` returning a function = cleanup runs on unmount and before next effect. Required for subscriptions, timers, intervals.

### Modern patterns (React 18+)

**Server Components** — components rendered server-side; no `useState`, no event handlers. Use for data-fetching at the leaf of the tree. Client Components (`"use client"`) for interactivity.

**Suspense** wraps async components; boundary shows fallback while children load. Pair with **Error Boundaries** for error states.

**`useTransition` / `useDeferredValue`** for non-urgent state updates (search inputs, large list filters).

### Anti-patterns to flag in code review

- `useEffect(() => fetch(url), [])` without an abort controller — race conditions on rapid re-mount
- Inline objects/arrays as props (`<Foo style={{}} />`) — defeat React.memo, cause re-renders
- Conditional hook calls (`if (x) { useEffect(...) }`) — violates Rules of Hooks
- Direct DOM manipulation outside `useRef` — bypasses React's reconciler, breaks state sync
- `dangerouslySetInnerHTML` without sanitization — XSS vector

### State-management cascade (rule of thumb)

1. Local component state (`useState`) — start here
2. Lifted state to nearest common parent — when 2 components need the same data
3. Context (`useContext`) — when prop-drilling > 3 levels
4. External store (Zustand, Jotai, Redux) — when context updates cause excessive re-renders

Don't reach for an external store first. Most React apps need it less than they think.

### Routing / framework

- **Next.js (App Router)** is the current default for new apps — file-based routing, Server Components, edge functions
- **Remix** is the alternative — opinionated about loaders/actions, less migration churn from old Rails patterns
- **Vite + React Router** for SPAs without server framework

### Accessibility (always required, not optional)

- Semantic HTML first — `<button>` not `<div onClick>`
- Every interactive element has a focus state
- Image `alt` text reflects intent (decorative = `alt=""`)
- Form labels via `<label htmlFor>`, not placeholder text
- Test with keyboard navigation; if you can't tab to it, it's broken

### Related KB docs (planned)

- `kb:web-dev/typescript-react` — TS patterns specific to React
- `kb:web-dev/tailwind-essentials` — utility-class CSS for React
- `kb:web-dev/next-js-app-router` — Next.js App Router conventions
- `kb:web-dev/accessibility-a11y` — WCAG, ARIA, keyboard testing
