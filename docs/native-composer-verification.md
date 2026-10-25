# Native input-method verification — 25 October 2026

Status: **experimental; actual Codex compatibility is not yet confirmed.** The companion/MCP integration and this native input method are separate deliverables.

## Installed build

The user-local input source is installed at `~/Library/Input Methods/Prompt Enhance.app`. Build 5 / version 0.3.2 is ad-hoc signed and passes strict signature verification. Registration and enabling succeeded. System Settings → Keyboard → Text Input lists **Prompt Enhance**, and the input menu is enabled. Registration does not select it as the current keyboard.

The helper connects directly to the existing loopback API; running the companion frontend is unnecessary for the native workflow.

## Passed checks

- Strict Objective-C ARC/MRC compilation, app build, property-list validation and whitespace checks.
- Completion engine: stale replies, Unicode/UTF-16, sampling after the host has applied a key, exact composition ownership, changed-prefix rejection, Tab acceptance, dismissal and guarded restore.
- API client: invalid/missing protocol fields (including missing revision at revision zero), bounded Unicode-heavy history pages, remote URL/redirect rejection and safe errors.
- Real AppKit text system: inline marked text, exact original-draft preservation after dismissal, acceptance once, and native textbox replacement.
- Coordinator with a real `NSTextView` and controlled backend/menu dependencies: save an unaccepted base and suffix separately, keep it unaccepted, render actionable history, restore exact saved content, refuse stale restore.
- InputMethodKit bridge: an MRC fake owner supplies fresh ephemeral autoreleased client proxies. Queries and a delayed engine snapshot use fresh proxies; invalidation prevents later access.
- Opt-in live API history test: create one uniquely named record, verify separate base/suffix and paginated listing, then remove that exact test UUID.

The final command was:

```bash
PROMPT_ENHANCE_LIVE_TESTS=1 native/macos/test.sh
```

All five native test groups passed. A macOS CI workflow runs the offline native tests and bundle build.

## Visible native fixture

The test-owned AppKit composer showed real Gemini-generated completions as gray underlined text inside its `NSTextView`. Tab committed a shown suffix; right-click dismissal preserved the base. Saving the accepted draft through the native menu persisted a real database record. This verifies native text composition and storage, not Codex's editor.

The fixture's separate system-input mode disables its direct coordinator, allowing the installed macOS input method itself to be tested without two engines competing. It requires selecting that input source. No Codex UI automation was used.

## Manual Codex results

The first host test reported no completion or clock. The helper's own crash reports identified a dangling input-session client proxy after a debounce delay. The bridge now obtains the controller's current autoreleased client separately for every call. The dedicated MRC regression above covers that defect.

The repaired 0.3.1 host retry still reported neither control. Build 0.3.2 adds a private capability report to distinguish application scoping, unavailable document ranges and unavailable caret geometry. The report contains only sanitized build/bundle metadata, capability booleans, a generic error and timestamp; it contains no prompt, suggestion, selection text, positions, lengths, credentials or keystroke history. Fixtures cannot overwrite the live report.

The current report is written atomically with mode `0600` to `~/Library/Logs/Prompt Enhance/native-status.json`. Host activation and the remaining Codex save/restore/right-click/send/undo checks are pending. Do not describe the native Codex requirement as complete until those checks succeed.
