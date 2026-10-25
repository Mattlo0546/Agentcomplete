# Prompt Enhance for ChatGPT

This Chrome Manifest V3 extension embeds the repository's existing companion interface in ChatGPT. It reuses the Refine, Knowledge, Activity, and Settings views, with adapters for ChatGPT navigation, theme, API transport, and applying a refined prompt to the composer. It includes ghost-text suggestions and multiple-choice clarification previews. The companion version on `main` has no named-version history, so this extension does not add or advertise that feature.

## Build and start

From `frontend/`, run `pnpm build:extension` (or `node extension/build.mjs`) after installing the frontend dependencies. This builds `plugin/chrome-extension/dist/workspace-host.js`, which the manifest loads as an isolated content script.

Start the local bridge from the repository root with `OPENAI_API_KEY` available in the process environment:

```sh
backend/.venv/bin/python plugin/chrome-extension/server.py
```

The bridge uses the repository's existing backend configuration and database. Set `OPENAI_MODEL` to override the default `gpt-4.1-mini` model. Keep the bridge running while using the extension.

In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `plugin/chrome-extension/`. After rebuilding, reload the extension and refresh ChatGPT.

## Use

In ChatGPT, type a prompt and wait for the configured quiet period to see a gray inline continuation. Press **Tab** to accept the suggestion or **Escape** to dismiss it. The extension also provides a **Skill Issue** button below the composer; it opens the companion workspace with the current draft. Refine the prompt, apply a multiple-choice clarification when one is available, then choose **Apply to ChatGPT** to update the composer without submitting it. If the ChatGPT draft changes while the workspace is open, reopen the workspace to apply the current draft.

The workspace includes the existing Knowledge, Activity, and Settings views. The extension toolbar popup can reopen it on the active ChatGPT tab.

## Architecture and data

The local adapter in `backend_adapter.py` creates the original FastAPI application and calls its existing pipeline. It adapts local transport authentication, per-request native response mode, and the structured-model provider. The repository's retrieval, validation, knowledge, traces, and database implementation remain the source of those behaviors; no backend source changes are required for the extension.

The extension calls a loopback bridge at `127.0.0.1`. Its runtime token and bridge configuration are not web-accessible. The workspace reads the current ChatGPT composer text only when opened and writes text only after **Apply to ChatGPT**. It does not read conversation history or attachments.

## Focused verification

From the repository root:

```sh
backend/.venv/bin/python -m pytest plugin/chrome-extension/tests/test_architecture_adapter.py plugin/chrome-extension/tests/test_openai_provider.py -q
node --test plugin/chrome-extension/tests/background.test.cjs
node frontend/node_modules/@playwright/test/cli.js test -c plugin/chrome-extension/tests/playwright.config.cjs
```
