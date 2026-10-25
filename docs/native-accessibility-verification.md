# Accessibility helper verification

Build: 0.4.1 (9), macOS 14+; Setup 1.1.0 (2).

The prior InputMethodKit-only build could obtain a Codex caret but not the full draft. This build adds a permission-gated Accessibility adapter and an external gray preview. Tab and history restoration require the same focused element, full draft and collapsed end caret immediately before writing.

## Completed checks

- All six native test groups pass: completion engine, backend client, Accessibility adapter, real AppKit composition, coordinator/history restoration and the MRC InputMethodKit bridge.
- Strict native compilation (`-Wall -Wextra -Werror`), ad-hoc signing and signature verification pass.
- An independent chat copied the final source to an isolated directory and reproduced the six passing groups and signed build without modifying it.
- Failed setters do not move the caret. A no-op native insertion fallback restores the original selection after verifying that focus and draft are unchanged.
- Only the exact focused text area is eligible. A child control never escalates to a parent text area.
- Accessibility geometry comes only from the authorized focused field, so native placeholder caret coordinates cannot place controls at a screen edge. Nonfinite and offscreen coordinates are rejected; zero-width carets work.
- A real mouse click in a deterministic test-owned AppKit fixture reached the production history button, loaded one page and opened the actual native menu. It stayed open until explicit Escape dismissal. Real caption dragging moved the production toolbar, and typing afterward preserved its chosen position. No production panel class was substituted for these checks.
- Missing permission keeps the completion engine inert and shows **Enable Accessibility** with an actionable setup button. Setup queries the actual input helper's own, build-matched permission state; only the user's **Allow Accessibility…** click requests the macOS prompt from that helper.
- The installed build 9 helper and Setup 1.1.0 were relaunched. Its real content-free permission report refreshed within one second and correctly reported access denied; the visible Setup changed from **Checking** to **Off**. No permission prompt or grant was automated.
- The upstream latency changes were merged while retaining prompt history, MCP tools and the native workaround. Frontend verification passed 109 tests, type checking, a production Webpack build and desktop/mobile offline history journeys. Focused backend verification passed 72 fast-path tests and 19 database/history checks (one optional check skipped). MCP verification passed 18 tests (three optional checks skipped).

## Manual host check still required

In Setup, click **Allow Accessibility…**, then enable `~/Library/Input Methods/Prompt Enhance.app` in macOS settings. **Show helper in Finder** locates the correct app if it must be added using **+**. Wait for Setup to show **Allowed**, activate/reconnect the Prompt Enhance input source, and test in the Codex composer. Verify automatic preview after typing, Tab acceptance, two-finger right-click save, and clock-menu restoration. Codex UI automation is unavailable in this environment; mocked AX tests and an AppKit fixture do not establish Codex end-to-end success.

The helper stores only capability booleans and generic failures in its diagnostic report; it does not log draft text, selection positions or API credentials. Gemini credentials remain in the existing backend.

The existing backend was restarted on the merged code while preserving its private configuration and Tiger Cloud database. One actual Gemini 3.5 Flash Lite request returned a nonempty, schema-valid autocomplete in 1.15 seconds; health reported the database ready.
