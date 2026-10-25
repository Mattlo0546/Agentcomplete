# Prompt Enhance for ChatGPT

A Manifest V3 Chrome extension for the ChatGPT web composer. Autocomplete appears as **gray inline text directly after the caret**, with a small clickable **Tab** hint. Typing through the proposed text keeps the remaining suffix. A separate card appears only for clarifying questions; saved-version history opens when requested. It never presses Send. No macOS input method, Accessibility grant, Codex account update or native helper is needed.

Version 0.2.1 uses the companion's 150 ms typing debounce, Tab/Esc behavior and exact-prefix continuation. Questions show only selectable options; choosing one previews its answer directly in the composer. **Tab** accepts and **Esc** dismisses. There is no separate proposed-draft box or Apply step. Corrections within the existing text also preview in place without changing the underlying draft before acceptance.

## Install locally

1. Run `pnpm install --frozen-lockfile` then `pnpm build` in this directory. Alternatively, download the `prompt-enhance-chatgpt` artifact from a successful **ChatGPT extension** Actions run and unzip it into a permanent folder. `pnpm package` also produces a local `prompt-enhance-chatgpt.zip`.
2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and select `dist` (or the unzipped folder containing `manifest.json`). Keep that folder in place.
3. Start the existing backend using its configured repository-root `.env`:

   ```sh
   cd backend
   uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
   ```

   This is run from the repository root, not the extension directory. Backend startup applies pending migrations; it needs the project's existing PostgreSQL and Gemini configuration. The frontend and native helper are not required.

4. Reload an open `https://chatgpt.com` tab. The extension starts **paused**. Press **Enable**, then type a draft of at least 12 characters with the caret at the end. Requests start after a 150 ms typing pause, followed by the backend response time. The extension popup has a **Check connection** button.

Press **Esc** to dismiss a suggestion. The small bookmark button below the composer (**Save version**) keeps the original draft and proposed continuation separately without inserting anything. The clock button (**History**) opens saved versions; selecting one previews it, and **Replace current draft** requires a further click. Editing the draft after preview disables replacement. History lives in the backend; its API also supports deletion and metadata updates.

Pause using the toolbar or popup. To remove it, use **Remove** in Chrome's extension manager. After updating files, press **Reload** on the extension card and reload ChatGPT.

## Access and data

- The content script runs only on `https://chatgpt.com/*` and legacy `https://chat.openai.com/*`, in the top frame. It reads the visible draft, not conversation messages. Ambiguous or unsupported editors fail closed.
- Enabling sends the current draft to `http://127.0.0.1:8000/v1/enhance`; the existing backend uses Gemini and the project's configured services. Saving explicitly persists the draft and optional continuation in the backend database. Pausing cancels pending requests but does not delete saved versions.
- The only Chrome permissions are `storage` (the enabled/paused setting) and the loopback host. Chrome host patterns cannot restrict ports; the worker itself fixes all requests to port 8000 and a small set of API routes. It omits credentials, rejects redirects, checks message sender origins and limits response size. There are no API keys or downloaded executable scripts in the extension.
- No clipboard, native messaging, browsing-history, all-sites or OS Accessibility permission is requested. The extension is independent of the disabled Codex plugin and macOS helper.

## Development and checks

Requires Node 22+, pnpm 10, and Chrome/Chromium 124+. Runtime code has no npm dependencies. ProseMirror, esbuild and Playwright are development-only test dependencies and are excluded from the distributable.

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm build
pnpm test
pnpm test:browser
pnpm package
```

The browser suite launches an isolated Chromium profile with a temporary copy of the unpacked extension. Its worker points to a private, ephemeral loopback port serving deterministic responses; the installed extension and real backend stay untouched. Tests cover ProseMirror document state and undo, multiline/emoji drafts, stale responses, IME composition, pause/cancellation, navigation, history preservation and restore guards, malformed responses, popup health, plain-text rendering and narrow layouts. Inline-specific checks measure the first ghost character against the caret, reproduce ChatGPT's single-line `!important` sizing rules, ensure wrapped text stays inside the composer after resize, verify typing through the suffix without another request, and verify inline question previews and keyboard acceptance. No personal Chrome profile or ChatGPT conversations are used by the tests.

With the real configured backend running, `pnpm test:live` opts into a Gemini request and a temporary saved-version round trip through the extension. It uses a generated test draft in an isolated ProseMirror fixture, then deletes only that test version's UUID.

## Compatibility boundary

ChatGPT's current composer markup was inspected in Chrome on 2026-10-25: `[data-composer-markdown][contenteditable="true"][role="textbox"]`. Legacy `#prompt-textarea` variants are also supported. A separate, non-editable ghost layer matches the caret's font metrics, wrapping and scroll clipping. The editor and its single-line wrapper temporarily reserve space for wrapped text, overriding the host's important minimum-height rules; original values and priorities are restored when the suggestion disappears. Replacement previews temporarily hide the original glyphs while keeping the actual document intact. Ghost text is never inserted into ProseMirror's document until accepted. Acceptance uses Chromium's normal text-editing path so ProseMirror observes input and maintains undo; it does not patch React state or replace the editor's DOM.

Automated ProseMirror tests are not a guarantee against future ChatGPT DOM changes. The browser automation policy blocks access to Chrome's extension-management page, so local installation must be performed by the user.

Validation on 2026-10-25 included 32 automated extension tests and a real Gemini/history smoke check. On an actual signed-in ChatGPT page, selecting the Gemini option “React and Next.js web app” displayed its continuation inside the composer without clipping or a separate preview box. Tab acceptance, undo and replacement previews passed in isolated ProseMirror tests. No prompt was sent to ChatGPT during verification.

Chrome architecture references: [content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [extension network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests), and [runtime messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging).
