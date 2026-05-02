---
kb_id: web-dev/typescript-react-patterns
version: 1
tags: [web, frontend, react, typescript, starter]
---

## Summary

TypeScript + React patterns for HETS react-frontend personas: type props with explicit interfaces (not inferred from usage); discriminated unions for state machines; `as const` for literal types; `satisfies` operator for shape-checking without widening; avoid `any` and `as` casts; prefer `unknown` + narrowing for external data; React.FC out of fashion — return types inferred from JSX. Stub doc — expand on use.

## Full content (starter — expand when first persona uses)

### Component prop types

Prefer explicit interface over inferred:

```tsx
interface ButtonProps {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}

function Button({ label, onClick, variant = 'primary', disabled }: ButtonProps) {
  return <button onClick={onClick} disabled={disabled} data-variant={variant}>{label}</button>;
}
```

Avoid `React.FC<ButtonProps>` — out of fashion; doesn't add value, complicates `children` typing.

### Discriminated unions for state

State machines model better as discriminated unions than as flat shapes with optional fields:

```tsx
type FetchState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error };
```

TypeScript narrows in branches, no need for `if (state.data)` after `state.status === 'success'`.

### `as const` and `satisfies`

`as const` narrows literals:
```tsx
const ROUTES = { home: '/', profile: '/profile' } as const;
// ROUTES.home is "/", not string
```

`satisfies` validates shape without widening (TS 4.9+):
```tsx
const config = {
  api: 'https://example.com',
  timeout: 5000,
} satisfies AppConfig;
// config.api is "https://example.com", not string
```

### External data: `unknown` + narrow

Never trust external JSON. Validate at the boundary:
```tsx
import { z } from 'zod';
const UserSchema = z.object({ id: z.string(), name: z.string() });
type User = z.infer<typeof UserSchema>;

const data = UserSchema.parse(await fetch(url).then(r => r.json()));
// data: User (validated)
```

### Common pitfalls

- `as` casts everywhere (lying to the compiler; bugs land at runtime)
- `any` in component props (defeats type safety; use `unknown` + narrow)
- `useState<T | null>(null)` then accessing without null check
- Inline arrow functions as deps in `useEffect` (changes every render; effect re-runs forever)
- `useCallback` / `useMemo` over-application (cost > benefit for cheap computations)
- Generic components without proper type variance (covariant vs contravariant props)

### Related KB docs

- `kb:web-dev/react-essentials` (already shipped)

### Related KB docs (planned)

- `kb:web-dev/zod-validation-patterns`
- `kb:web-dev/next-js-app-router`
- `kb:web-dev/accessibility-a11y`
