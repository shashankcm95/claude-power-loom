---
kb_id: bigdata-ml-cloud/stripe-payments
version: 1
tags:
  - bigdata-ml-cloud
  - stripe
  - payments
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: stripe"
  - "The Payment Intents API (docs.stripe.com/payments/payment-intents)"
related:
  - bigdata-ml-cloud/twilio-messaging
  - bigdata-ml-cloud/saas-integrations
status: active
---

## Summary

**Concept**: Stripe server-side payments — a charge flow where the card is tokenized in the browser (never touches the server) and charged via the Stripe Java SDK, with typed exception handling.
**Key APIs**: `Stripe.apiKey` set once in `@PostConstruct`; `Charge.create(Map)` (amount in **cents**, currency, description, source=token); Checkout.js front-end tokenization (publishable key in browser); `StripeException` + `CardException`/`AuthenticationException`/etc. via `@ExceptionHandler`.
**Gotcha**: amounts are in **cents** — `50 * 100` is the off-by-100 trap; `Stripe.apiKey` is global mutable state (single credential, not multi-tenant safe).
**2026-currency**: Charges/Tokens are legacy → **PaymentIntents** (SCA/3DS); stripe-java is at v33.x (corpus's 4.2.0 ~29 majors behind); untyped `Charge.create(Map)` superseded by typed `PaymentIntentCreateParams` + `StripeClient`.
**Sources**: Baeldung `stripe` module; Stripe Payment Intents docs.

## Quick Reference

**The charge flow (card never touches the server)**:
1. **Browser**: Checkout.js tokenizes the card using the **publishable** key → returns a single-use token.
2. **Server**: set `Stripe.apiKey` (the **secret** key) once, then create the charge.

**Setup**: `Stripe.apiKey = secretKey` in a `@PostConstruct` at startup.

**Charge**: `Charge.create(Map)` with:
- `amount` — in **cents** (an integer, e.g. $5.00 = `500`)
- `currency`, `description`
- `source` — the token from Checkout.js

**Typed exceptions** (via `@ExceptionHandler`): `StripeException` (base) → `CardException`, `AuthenticationException`, `InvalidRequestException`, `APIConnectionException`, `APIException`.

**Top gotchas**:
- Amounts are in **cents** — the `50 * 100` off-by-100 mistake is the classic trap.
- `Stripe.apiKey` mutates global static state — a single credential set, not multi-tenant safe.

**Current (mid-2026)**: Charges/Tokens are **legacy**. **PaymentIntents** is the path for new integrations (handles SCA/3DS). stripe-java is at **v33.x** (corpus's 4.2.0 is ~29 majors behind); the modern surface is the typed `PaymentIntentCreateParams` builder + the `StripeClient` (introduced v23), so untyped `Charge.create(Map)` is fully superseded. The front-end is Elements / Checkout Sessions rather than the old checkout.js "stripe-button".

## Full content

The Baeldung `stripe` module demonstrates a server-side payment integration whose defining security property is that the card number never touches the application server. The browser uses Checkout.js with the Stripe **publishable** key to tokenize the card into a single-use token; only that token is sent to the server, which then charges it with the **secret** key.

On the server, `Stripe.apiKey` is set once at startup in a `@PostConstruct`, and a charge is created with `Charge.create(Map)` — passing the amount (in cents), currency, description, and the `source` token. Error handling is genuinely good here: the SDK exposes a typed exception hierarchy under `StripeException` (`CardException`, `AuthenticationException`, `InvalidRequestException`, `APIConnectionException`, `APIException`), each mapped through a Spring `@ExceptionHandler`.

Two gotchas define the module. First, **amounts are in cents**, so `50 * 100` (intending $50) is the off-by-100 trap that quietly overcharges by 100×. Second, `Stripe.apiKey` is global mutable static state — a single credential set that is not multi-tenant safe (the same class of static-global concern as Twilio's `Twilio.init`, in the sibling messaging doc). The tokenization principle (card never touches the server) is the durable, still-correct lesson.

### 2026 currency

**Charges and Tokens are legacy.** **PaymentIntents** is the recommended path for new integrations, because it handles Strong Customer Authentication / 3D Secure ([Older payment APIs (docs.stripe.com)](https://docs.stripe.com/payments/older-apis) · [The Payment Intents API (docs.stripe.com)](https://docs.stripe.com/payments/payment-intents)). stripe-java is now at **v33.x** — the corpus's pin (4.2.0) is roughly 29 majors behind — and the modern surface is the typed `PaymentIntentCreateParams` builder plus the `StripeClient` introduced in v23, so the untyped `Charge.create(Map)` map-based call is fully superseded ([PaymentIntent (stripe-java 33.0.0)](https://stripe.dev/stripe-java/com/stripe/model/PaymentIntent.html) · [stripe/stripe-java (GitHub)](https://github.com/stripe/stripe-java)). On the front end, the legacy checkout.js "stripe-button" is deprecated in favor of **Elements / Checkout Sessions**. The card-tokenization principle itself carries forward unchanged.
