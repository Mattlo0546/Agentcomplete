# Accessibility helper verification

Build: 0.4.0 (7), macOS 14+.

The prior InputMethodKit-only build could obtain a Codex caret but not the full draft. This build adds a permission-gated Accessibility adapter and an external gray preview. Tab and history restoration require the same focused element, full draft and collapsed end caret immediately before writing.

## Completed checks

- All six native test groups pass: completion engine, backend client, Accessibility adapter, real AppKit composition, coordinator/history restoration and the MRC InputMethodKit bridge.
- Strict native compilation (`-Wall -Wextra -Werror`), ad-hoc signing and signature verification pass.
- An independent chat copied the final source to an isolated directory and reproduced the six passing groups and signed build without modifying it.
- Failed setters do not move the caret. A no-op native insertion fallback restores the original selection after verifying that focus and draft are unchanged.
- The upstream latency changes were merged while retaining prompt history, MCP tools and the native workaround. Frontend verification passed 109 tests, type checking, a production Webpack build and desktop/mobile offline history journeys. Focused backend verification passed 72 fast-path tests and 19 database/history checks (one optional check skipped). MCP verification passed 18 tests (three optional checks skipped).

## Manual host check still required

The user must enable Accessibility for `~/Library/Input Methods/Prompt Enhance.app`, activate/reconnect the Prompt Enhance input source, and test in the Codex composer. Verify automatic preview after typing, Tab acceptance, two-finger right-click save, and clock-menu restoration. Codex UI automation is unavailable in this environment; mocked AX tests and an AppKit fixture do not establish Codex end-to-end success.

The helper stores only capability booleans and generic failures in its diagnostic report; it does not log draft text, selection positions or API credentials. Gemini credentials remain in the existing backend.
