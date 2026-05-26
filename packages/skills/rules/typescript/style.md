---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---
# TypeScript Style

## Type Discipline

- Add explicit types to exported functions, shared utilities, and public class methods
- Let TypeScript infer obvious local variable types
- Extract repeated inline object shapes into named types or interfaces
- Use `interface` for object shapes that may be extended; `type` for unions, intersections, mapped types
- Prefer string literal unions over `enum`

## Avoid `any`

- Use `unknown` for external/untrusted input, then narrow safely
- Use generics when a value's type depends on the caller

## React Props

- Define component props with a named `interface` or `type`
- Type callback props explicitly
- Do not use `React.FC` unless there is a specific reason

## Immutability

- Use spread operator for immutable updates
- Prefer `Readonly<T>` for function parameters that should not be mutated
- Use `as const` for literal type inference

## Error Handling

- Use async/await with try-catch
- Narrow `unknown` errors safely: check `instanceof Error` before accessing `.message`
- Wrap errors with context before re-throwing

## Validation

- Use Zod for schema-based validation at system boundaries
- Infer TypeScript types from Zod schemas (`z.infer<typeof schema>`)
- Share schemas between client and server

## No console.log

- No `console.log` in production code
- Use structured logging libraries for server-side logging
