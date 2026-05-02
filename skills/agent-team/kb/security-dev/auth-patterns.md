---
kb_id: security-dev/auth-patterns
version: 1
tags: [security, auth, oauth, oidc, sessions, mfa, starter]
---

## Summary

Auth patterns for HETS security-engineer personas: OAuth 2.0 for delegated authorization; OIDC for authentication on top of OAuth; JWT for stateless session tokens (audience + issuer + expiry validated); session cookies (HttpOnly + Secure + SameSite) for browser apps; MFA via TOTP / WebAuthn / push; password storage via Argon2id (never SHA-256); token rotation + refresh-token reuse detection. Stub doc — expand on use.

## Full content (starter — expand when first persona uses)

### OAuth 2.0 vs OIDC

- **OAuth 2.0**: authorization (what the bearer can do)
- **OIDC**: authentication (who the bearer is) — sits on top of OAuth via the `id_token`

Don't confuse them. OAuth alone doesn't tell you WHO the user is.

### OAuth flows (pick the right one)

| Flow | When | Notes |
|------|------|-------|
| Authorization Code + PKCE | Public clients (mobile, SPA) | Default for new apps |
| Authorization Code | Server-side web apps with client secret | Classic |
| Client Credentials | Service-to-service | No user involved |
| Device Code | TVs, IoT | User authorizes on phone, device polls |
| Implicit | (deprecated) | Avoid; use Auth Code + PKCE instead |
| Resource Owner Password | (deprecated) | Avoid; defeats the purpose of OAuth |

### JWT validation (every recipient must)

- Verify signature against issuer's public key
- Validate `iss` (issuer) matches expected
- Validate `aud` (audience) includes this service
- Validate `exp` (expiry) hasn't passed
- Validate `nbf` (not-before) has passed
- Validate `iat` (issued-at) within reasonable past

Reject tokens missing any of these. Don't trust algorithm declared in `alg` header — pin it server-side.

### Sessions for browser apps

Cookie attributes (always all of these):
- `HttpOnly` — JS can't read; defeats XSS-based theft
- `Secure` — only sent over HTTPS
- `SameSite=Lax` (or `Strict` if no third-party context) — defeats CSRF
- Reasonable `Max-Age` — short for sensitive ops, longer for low-risk

Server-side session store (Redis, DB) — never trust client-side state for auth decisions.

### MFA

| Factor | Strength | UX cost |
|--------|----------|---------|
| TOTP (authenticator app) | Strong | Low |
| WebAuthn / passkey | Strongest | Lowest (after enrollment) |
| Push notification | Medium | Low |
| SMS OTP | Weak (SIM swap) | Low |
| Email OTP | Weak | Medium |
| Hardware key (YubiKey) | Strongest | High (carrying token) |

Default to TOTP + passkey support. Deprecate SMS where possible.

### Password storage (only if you really must)

- **Argon2id** with memory ≥64 MB, iterations ≥3, parallelism ≥1
- bcrypt (cost ≥12) acceptable as fallback
- **Never**: MD5, SHA-1, SHA-256 (no salt), PBKDF2 with low iterations
- Pepper (server-side secret added to hash input) optional but valuable

### Token lifecycle

- Access tokens: short-lived (15 min – 1 hour)
- Refresh tokens: longer (days – weeks); rotate on use; detect reuse (same refresh token used twice → all sessions invalidated, suspicious)
- Logout = invalidate session server-side, not just delete client cookie

### Common pitfalls

- JWT validation skipped (anyone can forge)
- Algorithm-confusion attack (`alg: none` accepted, or HS256 forged with public key as secret)
- Refresh token never rotates (theft = persistent access)
- Password hash with no salt (rainbow table)
- Session cookie missing `Secure` (token sent over HTTP, sniffable on coffee shop wifi)
- MFA enrollment optional and unenforced for sensitive accounts
- "Forgot password" flow as a back-door (account takeover via weak email account)

### Related KB docs (planned)

- `kb:security-dev/threat-modeling-essentials`
- `kb:security-dev/owasp-top-10`
- `kb:security-dev/iam-patterns`
