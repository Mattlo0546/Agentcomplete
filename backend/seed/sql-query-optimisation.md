---
kind: skill
title: SQL query optimisation with EXPLAIN
---
# SQL query optimisation with EXPLAIN (PostgreSQL)

Use when a query is slow or a table scan appears in a hot path.

## Method
1. Reproduce with realistic data volume; tiny tables hide problems.
2. Run `EXPLAIN (ANALYZE, BUFFERS, VERBOSE) <query>`. Compare estimated vs actual rows: large mismatches mean stale statistics (`ANALYZE table`) or correlated columns (`CREATE STATISTICS`).
3. Find the node with the most actual time. Look for `Seq Scan` on big tables, `Sort` spilling to disk, nested loops with huge outer rows, and many `Heap Fetches`.
4. Change one thing at a time and re-measure.

## Fixes
- **Indexes**: match the filter and sort order. Composite index order is equality columns first, then range, then sort. Partial indexes (`WHERE status = 'open'`) shrink hot sets. Covering indexes with `INCLUDE` enable index-only scans.
- **Functions on columns** (`lower(email)`, `date(created_at)`) block plain indexes; use an expression index or rewrite as a range.
- **Pagination**: replace `OFFSET n` with keyset pagination (`WHERE (created_at, id) < (%s, %s) ORDER BY created_at DESC, id DESC LIMIT 50`).
- **N+1**: batch with `WHERE id = ANY(%s)` or a join.
- **Counting**: avoid `count(*)` on huge tables in request paths; use estimates or cached counters.
- **Joins**: `EXISTS` instead of `IN (SELECT ...)` with duplicates; avoid `SELECT *`; filter before joining.
- **Leading wildcards** (`ILIKE '%x%'`) need `pg_trgm` GIN indexes.

## Safety
Create indexes with `CONCURRENTLY`, check write overhead and size, and drop unused ones (`pg_stat_user_indexes`).
