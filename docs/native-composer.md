# Native composer workaround for macOS

Status: **experimental; native AppKit tests and Codex host compatibility are separate checks.** Installing the MCP plugin alone does not add live autocomplete to Codex's message box.

`native/macos/` supplies a separate macOS **input method**, using Apple's public InputMethodKit API for key delivery. Codex does not expose its complete draft through that protocol. With explicit Accessibility permission for the installed Prompt Enhance input-method app, the helper instead reads the focused Codex text area through macOS's supported Accessibility API and displays a gray suggestion overlay at the caret. The draft changes only on explicit acceptance or restoration. It does not replace the editor, patch the Codex application, attach a debugger, inspect screens, synthesize keys, or use the clipboard.

This is a workaround outside the Codex plugin API. OpenAI's current [MCP extensions](https://developers.openai.com/plugins/build/extensions) provide mentions, panels and message insertion, but no documented live-draft or custom ghost-text hooks. Apple's [InputMethodKit](https://developer.apple.com/documentation/inputmethodkit) provides per-client input sessions and marked text; the installed macOS SDK documents the text and range contracts used here.

## Build and install

Requires macOS 14+, Apple's command-line developer tools, and the configured Prompt Enhance API listening on `http://127.0.0.1:8000`. Gemini and database credentials stay in the existing backend. The input method contains no secrets.

From the repository root:

```bash
native/macos/test.sh
native/macos/install.sh
```

The installer builds and ad-hoc signs `~/Library/Input Methods/Prompt Enhance.app`, registers and enables its input source, and backs up a prior installation under `native/macos/.build/backups/`. It does **not** change the current keyboard/input source. It uses the existing local backend, including its configured Gemini integration; no API key is stored in the input method or setup app.

Then run `native/macos/launcher.sh` and click **Allow Accessibility…**. That user action asks the installed input helper to show macOS's permission prompt; it does not request permission for Setup. In the macOS list, manually enable **Prompt Enhance** at `~/Library/Input Methods/Prompt Enhance.app`. If it is absent, **Show helper in Finder** reveals the exact app to add using the settings pane's **+** button. Setup checks the running input helper's own permission and displays **Allowed** only for a fresh report matching the installed build. Return to Setup and click **Activate Prompt Enhance**. If the source is already active, click **Reconnect Prompt Enhance** (it temporarily selects a regular keyboard layout, then restores Prompt Enhance after 200 ms). **Use previous keyboard** immediately disables the workaround.

Choose **Prompt Enhance** in the macOS input menu if needed. If it is absent, open **System Settings → Keyboard → Text Input → Edit → +**, search for Prompt Enhance, and add it. macOS can require restarting the destination application or logging out and in before a new input method appears.

## Use in the textbox

1. Select the Prompt Enhance input source and focus Codex's message box.
2. Type at least 12 UTF-16 units, with the caret at the end of the draft. After a 900 ms pause, the helper requests a completion from the existing backend.
3. **Tab** explicitly accepts a shown suffix. **Escape**, continued typing, clicking away, changing input sessions, and Enter discard it. Enter keeps its normal Codex behavior with the original draft.
4. The small native candidate bar beside the caret has a bookmark and a history clock. The bookmark saves the current base and any unaccepted suffix separately. Two-finger right-clicking the gray suggestion overlay offers the same save action.
5. Open the clock, choose a version, inspect its preview, and select **Replace current draft with this version**. It restores directly through the text client and never sends the prompt. Older/newer menu pages keep every saved version reachable.

The toolbar buttons accept the first click without taking keyboard focus. Drag the caption or background to move the toolbar; its chosen position is retained for that session. Missing Accessibility permission shows an **Enable Accessibility** bar with a **Set up…** action, rather than inactive history controls. Unavailable or invalid caret geometry hides ordinary controls instead of placing them at a screen edge. The authorized Accessibility path uses only the focused field's caret bounds, never InputMethodKit's placeholder geometry.

The input-source menu also exposes History, Save and Dismiss. Native saves receive a draft-derived title and time; descriptions and detailed comparisons remain editable in the existing companion History UI.

## Boundaries and recovery

- Reads and enhancement requests are allowed only for `com.openai.codex` and the test fixture's bundle ID. Other applications receive ordinary pass-through typing. InputMethodKit identifies an editable text session, not a Codex-specific composer role; while this input source is selected, another text field in the same application can also receive suggestions. Select it when composing a prompt and switch back to your usual input source when finished.
- The draft must expose supported ranges, have no selection or other active composition, and fit the existing 20,000-unit limit. When the user has granted Prompt Enhance Accessibility access, the helper may use the focused Codex field only to obtain or restore the same draft; unsupported fields fail closed. Responses must match the same client, revision, full draft and caret before being shown or accepted.
- Only autocomplete responses appear inline. Clarifying-question responses leave typing unchanged. The backend can take several seconds or return no inline suggestion.
- The Accessibility path uses a separate nonactivating preview, not IME marked text. Applying a suggestion or history version rechecks the focused element, full draft and end caret. Unsupported operations fail closed; a no-op native fallback restores the original selection if focus and text are unchanged. Codex's exact React/editor treatment, built-in composer predictions, two-finger menu routing, undo, and message sending need manual host verification. Passing an AppKit fixture does not prove these Codex behaviors.
- Switch back to the usual input source to disable the workaround immediately. It has no login daemon or keyboard event tap. To remove it, deselect/remove Prompt Enhance in Keyboard settings and move only `~/Library/Input Methods/Prompt Enhance.app` to Trash.

## Verification

`native/macos/test.sh` covers stale responses, composition ownership, Unicode/UTF-16 boundaries, explicit acceptance, dismissal, app scoping, guarded restoration, malformed API replies, and real `NSTextView` composition behavior. Accessibility mocks additionally cover permission denial, focus changes, secure-field rejection, zero-width carets, transactional writes and caret preservation after failed fallback. It uses a deterministic request handler and an HTTP protocol stub.

```bash
PROMPT_ENHANCE_LIVE_TESTS=1 native/macos/test.sh
```

The opt-in history test uses the actual backend, creates one uniquely named test record, verifies separate base/suffix persistence and listing, then removes that exact test UUID. It does not delete any existing versions.

`native/macos/fixture.sh` builds a visible, test-owned AppKit composer using the production engine, coordinator and real backend. It is a verification fixture, not the user-facing editor. Actual Codex verification must be performed by the user when desktop automation of Codex is unavailable.
