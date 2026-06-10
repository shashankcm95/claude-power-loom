---
skill: typescript
status: active
domain: web-dev
canonical_source: https://www.typescriptlang.org/docs/handbook/intro.html
forged_via: v2.8.3-run1-bootstrap (tech-stack-analyzer Step 6)
related_kb: [web-dev/typescript-react-patterns, web-dev/react-essentials]
notes: |
  Style/convention skill — no validation_sources per canonical-skill-sources registry
  (subjective design choices, not academic claims). Focused on Next.js 14/15 App Router +
  Drizzle ORM + Claude SDK + zod stack. Bootstrap context: v2.8.3-run1 PDF→Tutorial.
---

# TypeScript

Specialist skill for any HETS persona working in TypeScript. Loaded on demand via the `Skill` tool when the spawn prompt lists `typescript` as required. Codifies the idioms that show up in Next.js 14/15 + Node + React projects with Drizzle ORM and zod.

## When to use this skill

Trigger when:
- Writing or modifying `.ts` / `.tsx` files where the type-level work matters (not just `: string`)
- Designing types for API boundaries, DB row shapes, or LLM response shapes
- Deciding between `interface` / `type` / `class` / `enum` / discriminated union
- Debugging "why is this `any`" / "why is narrowing not working" / generic inference failures

**Skip** when the work is pure logic with trivial types (a quick utility function), or when the change is non-type-bearing (formatting, comments, dead-code removal).

## Core competencies

### tsconfig — strict mode is the floor, not the ceiling

Always enable:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true
  }
}
```

- `strict: true` is a meta-flag that enables `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `noImplicitThis`, `alwaysStrict`, `useUnknownInCatchVariables` (TS 4.4+). Skipping it disables half the type system's value. `useUnknownInCatchVariables` is the reason catch-clause variables are `unknown` under strict mode — pairs directly with the narrowing + zod idioms below.
- `noUncheckedIndexedAccess` makes `arr[i]` typed as `T | undefined` — forces you to handle the boundary. Catches array-out-of-bounds and `Record` key-miss bugs at compile time.
- `exactOptionalPropertyTypes` distinguishes `{ x?: number }` (key may be absent) from `{ x: number | undefined }` (key present, value may be undefined). Matters at API boundaries where `JSON.stringify` drops `undefined` values.

Source: TS Handbook — [tsconfig reference](https://www.typescriptlang.org/tsconfig).

### Discriminated unions — model state, not data

Use a literal-type discriminator field to make exhaustiveness-checkable variants:

```ts
type FetchState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error };

function render<T>(s: FetchState<T>) {
  switch (s.status) {
    case 'idle': return 'Idle';
    case 'loading': return 'Loading…';
    case 'success': return `Got ${s.data}`;
    case 'error': return `Failed: ${s.error.message}`;
    default: {
      const _exhaustive: never = s;  // compile error if a case is missed
      return _exhaustive;
    }
  }
}
```

The `never` assertion in `default` makes adding a new variant a type error until every consumer is updated. This is the single highest-leverage pattern for modeling state machines, API response shapes, and parser results.

Source: TS Handbook — [Narrowing → Discriminated unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions).

### `satisfies` operator — keep narrow inference, gain shape check

`as` casts and explicit type annotations both lose inference precision. `satisfies` (TS 4.9+) checks shape conformance WITHOUT widening:

```ts
// Loses literal types — config.dev is `string` not `'http://localhost:3000'`
const config: Record<string, string> = {
  dev: 'http://localhost:3000',
  prod: 'https://api.example.com',
};

// Narrow inference preserved — config.dev is `'http://localhost:3000'`
const config = {
  dev: 'http://localhost:3000',
  prod: 'https://api.example.com',
} satisfies Record<string, string>;
```

Use `satisfies` for: config objects, enum-replacement constants, route maps, error catalogs. Use `as const` together with `satisfies` for readonly literal preservation.

Source: TS 4.9 release notes — [satisfies operator](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator).

### Zod schema-derived types — single source of truth

Define the schema once; derive the type:

```ts
import { z } from 'zod';

export const ProfileDataSchema = z.object({
  userId: z.string().uuid(),
  bookSlug: z.string().min(1),
  chaptersCompleted: z.number().int().nonnegative(),
  quizScores: z.array(z.object({
    chapterIdx: z.number().int(),
    score: z.number().min(0).max(1),
  })),
});

export type ProfileData = z.infer<typeof ProfileDataSchema>;
```

Then **always validate at boundaries** (HTTP request body, LLM JSON response, DB row from raw query):

```ts
const result = ProfileDataSchema.safeParse(input);
if (!result.success) return { ok: false, error: result.error };
const profile: ProfileData = result.data;  // narrowed, validated
```

Never `as ProfileData` from untrusted input — that's a type-system lie. The whole point of zod is to make the lie impossible.

Source: Zod docs — [Type inference](https://zod.dev/?id=type-inference).

### Branded (nominal) types — make IDs unmixable

TypeScript is structural; two `string`s are interchangeable even when one is a user ID and the other is a book slug. Brand them:

```ts
type Brand<T, B> = T & { readonly __brand: B };

export type UserId = Brand<string, 'UserId'>;
export type BookSlug = Brand<string, 'BookSlug'>;

const asUserId = (s: string): UserId => s as UserId;
const asBookSlug = (s: string): BookSlug => s as BookSlug;

function getProgress(userId: UserId, bookSlug: BookSlug) { /* ... */ }

const uid = asUserId('u_123');
const slug = asBookSlug('intro-to-stats');

getProgress(uid, slug);    // ok
getProgress(slug, uid);    // type error — branded types unmixable
```

The `__brand` field is phantom — it doesn't exist at runtime. Cost: one cast per ingest site (the `asUserId` factory). Benefit: impossible to swap argument order without a type error.

Source: TS Handbook — [type compatibility](https://www.typescriptlang.org/docs/handbook/type-compatibility.html); pattern is community-canonical, not a built-in.

### Type narrowing — let the compiler think for you

```ts
function process(v: string | string[] | null) {
  if (v === null) return [];
  if (typeof v === 'string') return [v];
  return v;
}
```

Built-in narrowing: `typeof`, `instanceof`, `in`, equality (`===` / `!==`), truthy checks. **User-defined type guards** for custom shapes:

```ts
function isError(x: unknown): x is Error {
  return x instanceof Error;
}

try { /* ... */ } catch (e) {
  if (isError(e)) console.error(e.message);
  else console.error('unknown error', e);
}
```

**Assertion functions** for invariants:

```ts
function assertDefined<T>(v: T | undefined, msg: string): asserts v is T {
  if (v === undefined) throw new Error(msg);
}

const row = await db.query.users.findFirst({ where: eq(users.id, id) });
assertDefined(row, `user ${id} not found`);
// row is now T, not T | undefined
```

Source: TS Handbook — [Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html).

### Generic constraints — bound the type parameter

A naked `<T>` accepts anything. Constrain to make APIs strict and inference work:

```ts
// Accepts any object that has an `id` field
function findById<T extends { id: string }>(items: T[], id: string): T | undefined {
  return items.find((x) => x.id === id);
}

// Conditional default — defaults to a specific type if caller doesn't specify
function fetch<T = unknown>(url: string): Promise<T> { /* ... */ }
```

**Inference hints** with `const T extends` (TS 5.0+) to preserve literal types in generic args:

```ts
function route<const T extends string>(path: T): { path: T } { return { path }; }
const r = route('/api/users');  // r.path is '/api/users', not just string
```

Source: TS Handbook — [Generics](https://www.typescriptlang.org/docs/handbook/2/generics.html); [TS 5.0 const type params](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html#const-type-parameters).

### Utility types you'll reach for daily

| Util | Use when |
|---|---|
| `Pick<T, K>` | API DTOs from internal types (drop sensitive fields) |
| `Omit<T, K>` | Same, but exclude rather than include |
| `Partial<T>` | PATCH payloads, defaultable config |
| `Required<T>` | Internal use after a hydration step |
| `Readonly<T>` | Function args you must not mutate (paired with `as const`) |
| `Record<K, V>` | Lookup tables, indexed by literal-union keys |
| `Awaited<P>` | Unwrapping `Promise<T>` (especially `ReturnType<typeof asyncFn>` chains) |
| `ReturnType<F>`, `Parameters<F>` | Building wrappers / decorators around existing functions |
| `NonNullable<T>` | Stripping `null \| undefined` after a guard |

```ts
type GetUserReturn = Awaited<ReturnType<typeof getUser>>;
// If getUser is `async (id: string) => User | null`, this is `User | null`.
```

Source: TS Handbook — [Utility Types](https://www.typescriptlang.org/docs/handbook/utility-types.html).

### Drizzle ORM type idioms

Drizzle schemas double as types. Infer row + insert types via the table-property form (Drizzle v0.29+ primary API):

```ts
import { users } from './schema';

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

The older named-import form still works (`import { InferSelectModel, InferInsertModel } from 'drizzle-orm'`) and is equivalent — older codebases use it, but new code should prefer `$inferSelect` / `$inferInsert` per the current docs.

Pair with zod for boundary validation: schema is the SQL truth; zod is the HTTP truth; the two never need to be hand-synced if you derive both from a single field list (or use `drizzle-zod`).

Source: Drizzle docs — [Schema declaration → Inferring types](https://orm.drizzle.team/docs/sql-schema-declaration#inferring-types).

## Anti-patterns

- **`any`** — exit hatch from the type system; use `unknown` instead and narrow explicitly.
- **`as` without context** — type cast lies. Only use `as` when you have out-of-band knowledge the compiler doesn't (e.g., post-zod validation, immediately after a guard).
- **`!` non-null assertion** — same risk as `as`. Prefer `assertDefined()` / narrowing.
- **Enums** — they generate runtime code and have multiple subtle gotchas (numeric enums are bidirectional, string enums aren't, `const enum` doesn't survive isolatedModules). Use `as const` object literals + derived union types instead:
  ```ts
  const Role = { admin: 'admin', user: 'user' } as const;
  type Role = typeof Role[keyof typeof Role];  // 'admin' | 'user'
  ```
- **`Function` type** — too broad. Use a specific signature: `(x: number) => string` not `Function`.
- **`object` type** — also too broad. Use `Record<string, unknown>` for "some object" or define the shape.

## See also

- `next-js` skill — for TS constraints at the Server/Client boundary: serializable props across `"use client"`, Server Action signature constraints, route-handler request/response typing.
- `react` skill — for component-type idioms (`React.ReactNode`, `ComponentProps<typeof X>`, generic component patterns).

## Sources

- TypeScript Handbook (canonical): https://www.typescriptlang.org/docs/handbook/intro.html
- TypeScript tsconfig reference: https://www.typescriptlang.org/tsconfig
- TypeScript 4.9 release notes (`satisfies`): https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html
- TypeScript 5.0 release notes (`const` type params): https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html
- Zod docs: https://zod.dev/
- Drizzle docs (Schema declaration → Inferring types): https://orm.drizzle.team/docs/sql-schema-declaration#inferring-types
