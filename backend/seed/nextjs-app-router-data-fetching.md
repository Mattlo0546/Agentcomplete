---
kind: skill
title: Next.js App Router data fetching and caching
---
# Next.js App Router data fetching and caching

Use for Next.js 13-16 projects using the `app/` directory with Server Components.

## Where to fetch
- Default to **Server Components**: make the component `async`, `await` your data (fetch, ORM, SQL) directly, and pass plain props down. No `useEffect` fetching for initial data.
- Fetch in parallel: start promises first and `await Promise.all([...])`, or split into components wrapped in `<Suspense fallback={...}>` so slow parts stream. Avoid sequential waterfalls.
- Use Client Components (`'use client'`) only for interactivity. For client-side server state (polling, mutations, optimistic UI) use TanStack Query or SWR with route handlers or server actions.
- Check the Next.js version's docs in `node_modules/next/dist/docs/` for caching defaults: they changed between 14, 15 and 16 (e.g. `fetch` is no longer cached by default in 15+).

## Mutations
Use Server Actions (`'use server'`) for form posts; validate input with zod on the server, authorise inside the action, then call `revalidatePath` / `revalidateTag` (or `updateTag`) to refresh cached data.

## Route params
`params` and `searchParams` are Promises in recent versions: `const { id } = await params`. Use `notFound()` for missing records and `error.tsx` / `loading.tsx` for boundaries.

## Rules of thumb
- Never fetch your own route handlers from Server Components; call the data function directly.
- Keep secrets in Server Components; only `NEXT_PUBLIC_` variables reach the browser.
- Dedupe repeated reads in a request with `React.cache`.
- Make data functions typed and colocated (`lib/data/*.ts`), returning serialisable values.
