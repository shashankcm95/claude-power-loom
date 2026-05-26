---
name: fullstack-dev
description: Server-first development workflow for Next.js + TypeScript projects. Encodes patterns for Server Components, route handlers, type-safe data flows, and testing strategy across the front-end / back-end boundary.
---

# Full-Stack Development Workflow

Server-first development workflow for Next.js + TypeScript projects.

## Steps

### 1. Understand the Requirement
Parse the request into concrete deliverables. Ask clarifying questions if the scope is ambiguous.

### 2. Check Existing Patterns
Grep for similar implementations in the codebase. Read existing conventions for data fetching, state management, validation, and error handling. Follow what's already there.

### 3. Design Data Layer First
- Define or update database schema (Drizzle migrations, Prisma, raw SQL)
- Define Zod validation schemas that will be shared between client and server
- Infer TypeScript types from Zod schemas

### 4. Implement Server-Side
- API routes or Server Actions with input validation
- Database queries with parameterized inputs
- Auth checks on protected endpoints
- Error handling that returns safe messages to clients

### 5. Implement Client-Side
- Server Components for data fetching (default)
- Client Components only where needed (interactivity, state, browser APIs)
- Loading and error states for all async operations
- Optimistic UI where appropriate

### 6. Validate End-to-End
- Zod schemas enforce the contract at both boundaries
- Type errors caught at compile time via `z.infer`
- Runtime validation catches bad data at system boundaries

### 7. Write Tests
- Unit tests for business logic and utilities
- Integration tests for API routes and data flows
- Component tests for interactive UI

### 8. Verify in Browser
- Start the dev server
- Test the golden path (happy case)
- Test edge cases (empty states, errors, unauthorized access)
- Check for regressions in adjacent features

### 9. Self-Review
Invoke the code-reviewer agent on your own changes before marking complete.
