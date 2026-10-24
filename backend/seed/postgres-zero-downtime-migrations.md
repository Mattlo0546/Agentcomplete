---
kind: skill
title: Zero-downtime PostgreSQL schema migrations
---
# Zero-downtime PostgreSQL schema migrations

Use when writing migrations for a live PostgreSQL database that serves traffic during deploys.

## Principles
- Old and new application versions run side by side during a deploy, so every migration must be compatible with the previous app version (expand, migrate, contract).
- Set `lock_timeout` (e.g. `SET lock_timeout = '3s'`) and retry on failure; a migration waiting for a lock blocks all later queries on that table.

## Safe patterns
- **Add column**: `ADD COLUMN x type NULL` is instant. Adding a column with a constant DEFAULT is also instant on PostgreSQL 11+. Add NOT NULL later.
- **NOT NULL**: add `CHECK (x IS NOT NULL) NOT VALID`, then `VALIDATE CONSTRAINT` (only takes a weak lock), then `SET NOT NULL` (skips the scan since PG 12), then drop the check.
- **Indexes**: `CREATE INDEX CONCURRENTLY` (outside a transaction block). If it fails it leaves an INVALID index; drop and retry.
- **Foreign keys**: `ADD CONSTRAINT ... FOREIGN KEY ... NOT VALID`, then `VALIDATE CONSTRAINT` separately.
- **Rename / type change**: do not rename in place. Add a new column, dual-write, backfill in batches, switch reads, then drop the old column in a later release.
- **Backfills**: batches of 1k-10k rows by primary key range, commit between batches, sleep briefly, never one giant UPDATE.
- **Drop**: stop reading and writing the column in code first, deploy, then drop in a later migration.

## Avoid
- `ALTER COLUMN TYPE` that rewrites the table, `VACUUM FULL`, `CREATE INDEX` without CONCURRENTLY, `ADD COLUMN ... DEFAULT volatile_function()`, and long transactions mixing DDL with data changes.

## Checklist
Lock level of each statement, idempotency (`IF NOT EXISTS`), a tested rollback or forward-fix, and a check on a production-size copy for statements that scan.
