---
kind: prompt
title: Prevent stale async results in a React interaction
---
Use for search, autocomplete, filters or other React UI that issues requests as input changes.

**Goal:** Ensure `<interaction>` displays results only for its current input and settings.

**Context:** Trace input events, scheduling, request identity, response application and cleanup. Identify the existing framework or query-library mechanism before adding custom effects.

**Work:** Associate each request with the state snapshot it answers. Cancel superseded work where supported and independently reject late responses. Clean up timers and subscriptions. Preserve the newest input when completion order differs from request order. Define what happens when options change, the component unmounts or an error arrives.

**Guardrails:** Cancellation alone does not prove a result is current. Avoid suppressing legitimate failures or resetting user edits when old work finishes. Keep cache keys aligned with the inputs that change the result.

**Verification:** Use controlled promises to resolve an older request last. Test rapid typing, settings changes, unmount and retry. Assert visible results, pending state and cleanup without arbitrary sleeps.

Sources: [React effect cleanup and response races](https://react.dev/reference/react/useEffect).
