---
kind: prompt
title: Place a Next.js feature across the server and client boundary
---
Use for an existing Next.js App Router project.

**Goal:** Implement `<route or feature>` while keeping browser JavaScript and exposed data limited to what the interaction needs.

**Context:** Read the installed Next.js version and its bundled documentation, when present. Map required data, secrets, browser APIs and interactive state before deciding component boundaries.

**Work:** Keep database access and secrets on the server. Place client boundaries around the interactive parts. Inspect imports pulled into those boundaries and pass only the necessary serializable values across them. Account for Client Components also being rendered on the server during initial loading; avoid browser-only operations during that render.

**Guardrails:** Preserve `<routing and authentication contracts>`. Do not assume caching or request APIs behave like a different Next.js version. Do not expose sensitive fields merely because they can be serialized.

**Verification:** Run the production build, then exercise direct navigation and client navigation. Check hydration, loading/error states and the client bundle for unintended server dependencies.

Sources: [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components), [server/client boundary](https://nextjs.org/docs/app/guides/server-and-client-boundary).
