---
kind: skill
title: PostgreSQL-backed web session store
---
# PostgreSQL-backed web session store

Use when storing login sessions in PostgreSQL instead of Redis or signed cookies.

## Schema
```sql
CREATE TABLE session (
  id          text PRIMARY KEY,            -- sha256 of the opaque token, never the token itself
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX session_user_idx ON session (user_id);
CREATE INDEX session_expires_idx ON session (expires_at);
```

## Token handling
- Generate the cookie value with `secrets.token_urlsafe(32)`; store only its SHA-256 hash so a database leak does not leak live sessions.
- Cookie flags: `HttpOnly`, `Secure`, `SameSite=Lax`, a `Path=/`, and an explicit `Max-Age`.
- Rotate the id on login and privilege change (prevents fixation). Delete the row on logout.

## Reads and writes
- Look up by hash and `expires_at > now()`. Update `last_seen` at most once per few minutes to avoid a write per request (`WHERE last_seen < now() - interval '5 minutes'`).
- Use an absolute lifetime plus a sliding idle timeout.
- Keep `data` small; put large or hot data elsewhere.

## Cleanup
Delete expired rows on a schedule (`DELETE FROM session WHERE expires_at < now()` in batches, or `pg_cron`). Consider `UNLOGGED` only if losing sessions on crash is acceptable.

## Pitfalls
Missing index on `expires_at`, storing raw tokens, long idle transactions holding session rows, and forgetting to revoke all of a user's sessions on password change.
