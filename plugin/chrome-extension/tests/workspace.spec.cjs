const fs = require('node:fs/promises');
const path = require('node:path');
const frontend = path.resolve(__dirname, '../../../frontend');
const { test, expect } = require(require.resolve('@playwright/test', { paths: [frontend] }));
const extension = path.resolve(__dirname, '..');

// Offline fixture: the real host adapter and the real compiled React workspace,
// with an isolated Chrome runtime mock. No API key, network AI, or user profile.
test('shared editor, questions, theme and ChatGPT composer integration', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    // Playwright cannot target a closed shadow tree. Only expose it to this test;
    // all production event handling and composer code still run.
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
    const stored = {};
    const changed = [];
    window.__qaCalls = [];
    window.chrome = {
      runtime: {
        id: 'offline-qa',
        getURL: name => new URL(String(name).replace(/^\//, ''), 'https://fixture.test/').href,
        onMessage: { addListener() {}, removeListener() {} },
        sendMessage: async message => {
          window.__qaCalls.push(message);
          if (message.type === 'health') return { ready: true, model: 'offline-fixture', knowledge_items: 0 };
          if (message.type !== 'api') return {};
          const url = new URL(message.path, 'https://fixture.test');
          const pathname = url.pathname;
          const body = message.body || {};
          const method = message.method || 'GET';
          const ok = (data, status = 200) => ({ status, data });
          if (pathname === '/v1/settings') return ok({ trigger_delay_ms: 60, autocomplete_enabled: true, questions_enabled: true, max_options: 3, retention_days: 30, store_payloads: false });
          if (pathname === '/v1/enhance') {
            const base = { schema_version: 1, request_id: body.request_id, prompt_revision: body.prompt_revision };
            if (body.prompt === 'Clarify the output') return ok({ ...base, type: 'multiple_choice', question: 'Which output format?', options: [
              { id: 'table', label: 'Markdown table', edits: [{ start: body.prompt.length, end: body.prompt.length, text: '. Return a Markdown table.' }] },
              { id: 'list', label: 'Short bullet list', edits: [{ start: body.prompt.length, end: body.prompt.length, text: '. Return a short bullet list.' }] },
            ] });
            if (body.prompt === 'Retry with backoff') return ok({ ...base, type: 'autocomplete', insert_at: body.prompt.length, text: ' and jitter.' });
            return ok({ ...base, type: 'none' });
          }
          if (pathname === '/v1/outcomes') return ok(null, 204);
          if (pathname.startsWith('/v1/traces/')) return ok({ error: { code: 'not_found', message: 'No trace in offline fixture' } }, 404);
          if (pathname === '/v1/knowledge') return ok({ items: [], total: 0 });
          if (pathname === '/v1/tags') return ok([]);
          if (pathname === '/v1/logs') return ok({ items: [], total: 0 });
          if (pathname === '/v1/stats') return ok({ suggestions: 0, accepted_pct: 0, declined_pct: 0, p50_latency_ms: null, classifier: null, log_entries: 0, log_bytes: 0 });
          if (pathname === '/v1/health') return ok({ status: 'ok', latency_ms: 1, db: 'ok', gemini: 'unchecked' });
          if (pathname === '/v1/analytics/status') return ok({ last_export_at: null, last_export_count: null, classifier: null });
          return ok({ error: { code: 'not_found', message: `Offline route missing: ${pathname}` } }, 404);
        },
      },
      storage: {
        local: {
          get: async key => typeof key === 'string' ? { [key]: stored[key] } : { ...stored },
          set: async data => { const delta = {}; for (const [key, value] of Object.entries(data)) { delta[key] = { oldValue: stored[key], newValue: value }; stored[key] = value; } changed.forEach(fn => fn(delta, 'local')); },
          remove: async key => { delete stored[key]; },
        },
        onChanged: { addListener: fn => changed.push(fn), removeListener: fn => { const index = changed.indexOf(fn); if (index !== -1) changed.splice(index, 1); } },
      },
    };
  });
  await page.route('https://fixture.test/**', async route => {
    const file = path.resolve(extension, decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\//, ''));
    if (!file.startsWith(extension + path.sep)) return route.abort();
    try {
      const body = await fs.readFile(file);
      const contentType = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
      await route.fulfill({ body, contentType });
    } catch { await route.fulfill({ status: 404, body: 'Missing fixture asset' }); }
  });
  await page.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><style>body{font:16px/1.5 system-ui;margin:32px;background:white;color:#111}main{max-width:760px;margin:auto}[contenteditable]{min-height:80px;border:1px solid #ddd;border-radius:20px;padding:18px}</style></head><body><main><h1>Offline ChatGPT composer fixture</h1><div><div data-composer-body><div data-composer-input><div contenteditable="true" data-composer-markdown role="textbox" aria-label="Ask ChatGPT"><p>Retry with backoff</p></div></div></div></div></main></body></html>` }));
  await page.goto('https://chatgpt.com/');
  await page.addScriptTag({ content: await fs.readFile(path.join(extension, 'dist/workspace-host.js'), 'utf8') });
  await page.addScriptTag({ content: await fs.readFile(path.join(extension, 'native-autocomplete.js'), 'utf8') });
  await page.addScriptTag({ content: await fs.readFile(path.join(extension, 'content.js'), 'utf8') });
  await page.getByRole('button', { name: 'Skill Issue', exact: true }).click();
  const workspace = page.locator('#prompt-enhance-extension');
  const editor = workspace.getByRole('textbox', { name: 'Prompt', exact: true });
  await expect(editor).toHaveValue('Retry with backoff');
  await expect(workspace.getByTestId('ghost-text')).toContainText('and jitter.');
  await editor.press('Escape');
  await expect(workspace.getByRole('dialog', { name: 'Prompt Enhance workspace', exact: true })).toBeVisible();
  await expect(workspace.getByTestId('ghost-text')).toHaveCount(0);
  await workspace.getByRole('button', { name: 'Suggest', exact: true }).click();
  await expect(workspace.getByTestId('ghost-text')).toContainText('and jitter.');
  await editor.press('Tab');
  await expect(editor).toHaveValue('Retry with backoff and jitter.');
  await workspace.getByRole('button', { name: 'Apply to ChatGPT', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Ask ChatGPT', exact: true })).toHaveText('Retry with backoff and jitter.');
  await expect(workspace.getByRole('dialog', { name: 'Prompt Enhance workspace', exact: true })).toBeHidden();
  await expect(page.getByText('Draft updated', { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.postMessage({ source: 'prompt-enhance-workspace', type: 'apply-draft', prompt: 'Untrusted page message' }, '*'));
  await expect(page.getByRole('textbox', { name: 'Ask ChatGPT', exact: true })).toHaveText('Retry with backoff and jitter.');

  // Reopen after the host confirms and closes its workspace.
  await page.getByRole('button', { name: 'Skill Issue', exact: true }).click();
  await editor.fill('Clarify the output');
  await expect(workspace.getByRole('heading', { name: 'Which output format?' })).toBeVisible();
  await workspace.getByRole('radio', { name: /Markdown table/ }).click();
  await expect(workspace.getByTestId('diff-preview')).toContainText('Return a Markdown table.');
  await workspace.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(editor).toHaveValue('Clarify the output. Return a Markdown table.');

  await page.getByRole('textbox', { name: 'Ask ChatGPT', exact: true }).fill('Changed outside the workspace');
  await workspace.getByRole('button', { name: 'Apply to ChatGPT', exact: true }).click();
  await expect(page.locator('#prompt-enhance-extension').locator('#notice')).toHaveText('Your ChatGPT draft changed. Reopen Prompt Enhance to use the current draft.');
  await expect(page.getByRole('textbox', { name: 'Ask ChatGPT', exact: true })).toHaveText('Changed outside the workspace');

  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await expect(workspace.locator('.extension-workspace')).toHaveCSS('background-color', 'rgb(33, 33, 33)');
  await expect(editor).toHaveValue('Clarify the output. Return a Markdown table.');
  await page.screenshot({ path: `/tmp/prompt-enhance-extension-${info.project.name}-refine.png`, animations: 'disabled' });
  await workspace.getByRole('link', { name: 'Knowledge', exact: true }).click();
  await expect(workspace.getByRole('heading', { name: 'Knowledge', exact: true })).toBeVisible();
  await workspace.getByRole('link', { name: 'Activity', exact: true }).click();
  await expect(workspace.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible();
  await workspace.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(workspace.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await workspace.getByRole('link', { name: 'Refine', exact: true }).click();
  await expect(editor).toHaveValue('Clarify the output. Return a Markdown table.');
  expect(errors).toEqual([]);
  await page.screenshot({ path: `/tmp/prompt-enhance-extension-${info.project.name}.png`, animations: 'disabled' });
});
