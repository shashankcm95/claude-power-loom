---
name: deploy-checklist
description: Verification workflow before shipping to production. Tests / lints / migrations / rollback plan / env config / secret rotation / observability spot-check — gated steps with explicit user approval before destructive actions.
---

# Pre-Deployment Checklist

Verification workflow before shipping to production.

## Checklist

### Code Quality
- [ ] Full test suite passes (`npm test` / `npm run test:ci`)
- [ ] No `console.log` or `debugger` statements in production code
- [ ] No TODO/FIXME without associated issue tickets
- [ ] TypeScript compiles with no errors (`npx tsc --noEmit`)
- [ ] Linter passes with no warnings (`npm run lint`)

### Data & Infrastructure
- [ ] Database migrations tested and reversible
- [ ] Environment variables set in target environment
- [ ] API keys rotated if any were exposed during development
- [ ] Cache invalidation strategy verified

### Performance
- [ ] Bundle size checked — no regressions (`npx next build` output)
- [ ] Images optimized (next/image, WebP, lazy loading)
- [ ] No N+1 queries in new data paths

### User-Facing
- [ ] Critical user paths tested end-to-end
- [ ] Error states render correctly
- [ ] Loading states present for async operations
- [ ] Mobile responsive (if applicable)

### Operations
- [ ] Rollback plan documented
- [ ] Monitoring and alerting verified for new endpoints
- [ ] Release tagged in git
- [ ] Changelog or PR description updated
