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

## Signing and permission mismatch investigation

The running build 9 helper reported `accessibilityTrusted: false` in its fresh, per-process permission report while the macOS Accessibility list showed Prompt Enhance enabled. Restarting the unchanged helper and toggling the existing grant did not change that result. The older build 8 native-session report was stale and did not describe the running process.

The installed development helper has a CDHash-only ad-hoc designated requirement. Backups of successive builds have different CDHashes. This is consistent with a grant referring to a previous signing identity; Apple explains that ad-hoc requirements are tied to a particular code version in [TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements). A release build should use a stable signing identity. No valid signing identity is currently available on this Mac.

The build script now accepts and validates `PROMPT_ENHANCE_SIGN_IDENTITY`. Installation preserves an identical signed bundle, and changed ad-hoc replacements explain the required permission refresh. An isolated installer regression confirms that an unchanged bundle retains its inode and avoids a replacement/backup. A coordinator regression confirms that requests resume on the first key event after permission is granted. All six native test groups pass. Diagnostics now retain a current permission-blocked Codex report rather than hiding it behind an enabled-engine guard.

These source changes do not replace the installed build 9 during permission recovery. After the stale permission entry was removed and the current app was added, its own report changed to `accessibilityTrusted: true`; Setup showed Allowed. The installed designated CDHash remained `d59b3d513a6010126c1372a45854ad6906d369c3` throughout. The source was reconnected for the final manual Codex autocomplete, saving and restoration check.

## Build 10 editor compatibility repair

The user then confirmed that build 9 still showed neither suggestion nor clock despite trusted access and the selected input source. Build 10 adds Electron's documented third-party `AXManualAccessibility` request for the exact trusted, frontmost Codex PID. Unsupported requests do not prevent using an already accessible field. It also observes changes to the authorized focused draft, so missing input-method key callbacks no longer prevent automatic requests. Initial delayed field publication and eventless edits are covered by coordinator regressions.

Missing AX selection can use a collapsed input-method caret only when two readings match across a second read of the exact same focused AX field, PID, bundle and full value. Tests reject changing carets, fields, text and out-of-bounds ranges. An eventless edit invalidates an old visible suggestion before changing its stored prefix, preventing Tab from applying a suffix to a different draft.

All six native test groups pass with these changes. Build 10 requires its own final macOS permission refresh because its development signature differs from build 9. Actual Codex preview, saving and restoration remain pending the host check.
