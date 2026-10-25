# Native input-method verification — 25 October 2026

Status: **experimental; actual Codex compatibility is not yet confirmed.** The companion/MCP integration and this native input method are separate deliverables.

## Installed build

The user-local input source is installed at `~/Library/Input Methods/Prompt Enhance.app`. The current build is **9 / version 0.4.1**, ad-hoc signed and passing strict signature verification. Registration and enabling succeeded. System Settings → Keyboard → Text Input lists **Prompt Enhance**, and the input menu is enabled. Registration does not select it as the current keyboard.

The helper connects directly to the existing loopback API; running the companion frontend is unnecessary for the native workflow.

## Passed checks

- Strict Objective-C ARC/MRC compilation, app build, property-list validation and whitespace checks.
- Completion engine: stale replies, Unicode/UTF-16, sampling after the host has applied a key, exact composition ownership, changed-prefix rejection, Tab acceptance, dismissal and guarded restore.
- API client: invalid/missing protocol fields (including missing revision at revision zero), bounded Unicode-heavy history pages, remote URL/redirect rejection and safe errors.
- Real AppKit text system: inline marked text, exact original-draft preservation after dismissal, acceptance once, and native textbox replacement.
- Coordinator with a real `NSTextView` and controlled backend/menu dependencies: save an unaccepted base and suffix separately, keep it unaccepted, render actionable history, restore exact saved content, refuse stale restore.
- InputMethodKit bridge: an MRC fake owner supplies fresh ephemeral autoreleased client proxies. Queries and a delayed engine snapshot use fresh proxies; invalidation prevents later access.
- Opt-in live API history test: create one uniquely named record, verify separate base/suffix and paginated listing, then remove that exact test UUID.

The earlier live-history command was:

```bash
PROMPT_ENHANCE_LIVE_TESTS=1 native/macos/test.sh
```

That input-method baseline had five native test groups. The current `native/macos/test.sh` runs **six** groups, including Accessibility, and passes. A macOS CI workflow runs the offline native tests and bundle build.

## Build 9: permission and toolbar fixes

The user supplied a screenshot showing no autocomplete and a stranded toolbar. The helper's sanitized report showed Accessibility denied, so the prior input-method fallback could not read a usable draft. Build 9 keeps completion requests off until permission is granted and replaces unusable history controls with an actionable **Enable Accessibility** bar.

The Accessibility adapter now takes caret geometry only from the authorized, directly focused field. It does not prefer InputMethodKit's placeholder coordinates. The coordinator rejects nonfinite, sentinel and offscreen positions; valid zero-width carets remain supported. Toolbar buttons explicitly accept the first click without taking keyboard focus. Its caption and surface support dragging, and updates preserve the user-selected position.

Setup 1.1.0 queries the running input helper's own permission through a separate, content-free status report, and accepts only a fresh report matching the installed build. The explicit **Allow Accessibility…** button asks the input helper itself to show the macOS prompt. Setup never grants permission or requests permission for itself. **Show helper in Finder** reveals the exact bundle to add if it is absent from macOS settings.

All six groups and the strict signed build pass, including regression checks for invalid geometry, the first-click button contract, retained drag position, denial without draft reads or model requests, and native history save/restore. Actual Codex autocomplete, clock interaction, restore, undo and send remain a manual host check after permission is granted. No Codex UI or draft was inspected during automated verification.

A separate test-owned AppKit fixture used the production palette and deterministic HTTP replies. A real computer-use mouse click reached the history button, completed one history fetch, and opened the actual native menu. Instrumented `menuWillOpen` fired once; `menuDidClose` remained zero until explicit Escape dismissal. Real caption dragging moved the toolbar and subsequent typing preserved its chosen position. The main-window screenshot omitted this separate popup; this verifies mouse dispatch and menu opening, not visual selection or Codex restoration. No production UI class was replaced for the test and no extra Gemini calls were made.

## Visible native fixture

The test-owned AppKit composer showed real Gemini-generated completions as gray underlined text inside its `NSTextView`. Tab committed a shown suffix; right-click dismissal preserved the base. Saving the accepted draft through the native menu persisted a real database record. This verifies native text composition and storage, not Codex's editor.

The fixture's separate system-input mode disables its direct coordinator, allowing the installed macOS input method itself to be tested without two engines competing. It requires selecting that input source. No Codex UI automation was used.

## Manual Codex results

The first host test reported no completion or clock. The helper's own crash reports identified a dangling input-session client proxy after a debounce delay. The bridge now obtains the controller's current autoreleased client separately for every call. The dedicated MRC regression above covers that defect.

The repaired 0.3.1 host retry still reported neither control. Build 0.3.2 adds a private capability report to distinguish application scoping, unavailable document ranges and unavailable caret geometry. The report contains only sanitized build/bundle metadata, capability booleans, a generic error and timestamp; it contains no prompt, suggestion, selection text, positions, lengths, credentials or keystroke history. Fixtures cannot overwrite the live report.

The current report is written atomically with mode `0600` to `~/Library/Logs/Prompt Enhance/native-status.json`. Host activation and the remaining Codex save/restore/right-click/send/undo checks are pending. Do not describe the native Codex requirement as complete until those checks succeed.
