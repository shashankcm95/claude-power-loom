---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/*.ts"
  - "**/*.js"
---
# React / Next.js Rules

## Server vs Client Components

- Default to Server Components — add `"use client"` only when needed (state, effects, browser APIs)
- Never use `useState`/`useEffect` in Server Components
- Fetch data in Server Components; pass as props to Client Components
- Keep Client Components as leaf nodes in the tree

## Hooks Discipline

- Complete dependency arrays in `useEffect`/`useMemo`/`useCallback`
- No state updates during render (causes infinite loops)
- Watch for stale closures in event handlers

## Lists and Keys

- Never use array index as key for dynamic/reorderable lists
- Use stable unique identifiers (database IDs, UUIDs)

## Prop Drilling

- If props pass through 3+ component levels, use Context or composition
- Prefer composition (children, render props) over deep Context nesting

## Data Fetching

- Always provide loading and error states for async operations
- Use Suspense boundaries and error boundaries in App Router
- Handle empty states explicitly

## Images

- Use `next/image` for automatic optimization
- Always set width/height or use `fill` to prevent layout shift

## API Routes

- Validate request body with Zod schemas
- Check authentication on every protected route
- Add rate limiting to public endpoints
- Return generic error messages to clients; log details server-side
- Use appropriate HTTP status codes
