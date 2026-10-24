---
kind: skill
title: Stripe webhook handling with idempotency
---
# Stripe webhook handling with idempotency

Use when implementing or reviewing an endpoint that receives Stripe events (checkout.session.completed, invoice.paid, payment_intent.succeeded, customer.subscription.updated).

## Verify before trusting
- Read the **raw request body** (bytes), not re-serialised JSON, and verify the `Stripe-Signature` header with `stripe.Webhook.construct_event(payload, sig_header, endpoint_secret)`. Reject with 400 on failure.
- Keep the endpoint secret in configuration, one per endpoint and environment. Never log the secret or full payloads.

## Be idempotent
Stripe delivers at least once and may retry for days, and events can arrive out of order.
- Store `event.id` in a `processed_stripe_events` table with a UNIQUE constraint. Insert it in the same database transaction as the business change; if the insert conflicts, return 200 and do nothing.
- Make handlers state-based rather than event-based: fetch the current object from the Stripe API (or compare `created` timestamps) so an old `subscription.updated` cannot overwrite newer state.
- Use idempotency keys (`Idempotency-Key` header, or `idempotency_key=` in the SDK) on every request you make to Stripe that creates something, derived from your own stable identifiers (e.g. `order-{order_id}-charge`).

## Respond quickly
- Return 2xx within a few seconds. Do slow work (emails, provisioning) in a background job queue after persisting the event.
- Return non-2xx only for genuine failures you want retried (database down). Unknown event types should return 200.

## Test
- Use the Stripe CLI: `stripe listen --forward-to localhost:8000/webhooks/stripe` and `stripe trigger checkout.session.completed`.
- Write tests for: bad signature, duplicate delivery of the same event id, out-of-order events, and handler failure followed by a successful retry.
