# Fixture — Scenario 02 (security-heavy)

Tiny auth helper with intentional security smells. Used by `bench/scenarios/02-security-audit/task.md`.

| File | Purpose |
|---|---|
| `auth.js` | Auth helpers with 3 intentional smells (md5 for passwords, placeholder secret pattern, timing-attack-prone comparison) |
| `auth.test.js` | Smoke runner |

## Test

```bash
node auth.test.js
```

Expected: `3 passed, 0 failed`

## Intentional smells (for security-auditor to flag)

1. **`hashPassword` uses md5** — weak; should be argon2/bcrypt/scrypt
2. **`API_KEY_FALLBACK` placeholder pattern** — CONTROL: looks like a secret but matches the `your_*_here` carve-out in validate-no-bare-secrets (SEC-3). Hook should APPROVE this. If it BLOCKS, false-positive rules need tightening.
3. **`checkToken` uses `===`** — timing-attack-prone; should use `crypto.timingSafeEqual`
