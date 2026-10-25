import { test, expect, chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const suffix = ' with bounded backoff.';
let server, context, profile, testExtension, extensionId, requests = [], versions = [], delay = 0, responseMode = 'normal';
const fixture = (textarea = false) => `<!doctype html><html><head><meta charset="utf-8"><title>ChatGPT composer compatibility fixture</title><style>
body{font:16px system-ui;background:#f7f7f8;margin:0;color:#243248}main{max-width:720px;margin:9vh auto}h1{font-size:28px;font-weight:500}[data-composer-body]{position:fixed;bottom:60px;left:15%;width:70%;box-sizing:border-box;border:1px solid #ccd3dd;border-radius:20px;background:white;padding:20px}[role=textbox],textarea{min-height:65px;outline:none;width:100%;box-sizing:border-box;font:16px/1.5 system-ui;white-space:pre-wrap}p{margin:0}small{color:#62728b}</style></head><body><main><small>LOCAL TEST FIXTURE</small><h1>What would you like to work on?</h1></main><div data-composer-body><form>
${textarea ? '<textarea id="prompt-textarea" aria-label="Ask ChatGPT"></textarea>' : '<div data-composer-markdown contenteditable="true" role="textbox" aria-label="Ask ChatGPT" class="ProseMirror"><p><br class="ProseMirror-trailingBreak"></p></div>'}
<button type="submit">Send</button></form></div><script>
window.sends=0;window.model='';const editor=document.querySelector('[contenteditable],textarea');
editor.addEventListener('input',()=>window.model=editor.value??editor.innerText);
document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();window.sends++});
editor.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();document.querySelector('form').requestSubmit()}});
</script></body></html>`;

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
    const url = new URL(req.url, 'http://127.0.0.1:8000');
    requests.push({ path: url.pathname, method: req.method, body });
    const reply = data => { if (!res.destroyed) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); } };
    // Deliberately no Access-Control-Allow-Origin: the MV3 worker must use its
    // narrowly scoped localhost permission instead of webpage fetch/CORS.
    if (url.pathname === '/v1/health') return reply({ status: 'ok', db: 'ok', gemini: 'unchecked' });
    if (url.pathname === '/v1/prompt-history' && req.method === 'POST') {
      const value = { ...body, id: randomUUID(), saved_text: body.prompt + (body.suggestion_text || ''), created_at: new Date().toISOString() }; versions.unshift(value); return reply(value);
    }
    if (url.pathname === '/v1/prompt-history') { const offset = Number(url.searchParams.get('offset')); return reply({ items: versions.slice(offset, offset + 10), total: versions.length }); }
    if (url.pathname === '/v1/enhance') {
      const mode = responseMode;
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      const common = { schema_version: 1, request_id: body.request_id, prompt_revision: body.prompt_revision };
      if (mode === 'choice' || mode === 'rewrite') return reply({ ...common, type: 'multiple_choice', question: 'Choose the retry style', options: ['bounded', 'exponential'].map(id => ({ id, label: id, edits: [{ start: mode === 'rewrite' ? 0 : body.prompt.length, end: body.prompt.length, text: (mode === 'rewrite' ? 'Implement retries' : '') + ' using ' + id + ' backoff.' }] })) });
      if (mode === 'invalid') return reply({ ...common, type: 'autocomplete', insert_at: 0, text: suffix });
      return reply({ ...common, type: 'autocomplete', insert_at: body.cursor, text: mode === 'html' ? ' <img src=x onerror=alert(1)>' : mode === 'long' ? ' with React and TypeScript, featuring a game board state, win-checking logic, and a restart button. Start with the core component structure and win conditions.' : suffix });
    }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  // Use a private copy on an ephemeral port. The installed extension and real
  // backend remain untouched, and personal drafts cannot reach the test server.
  testExtension = await mkdtemp(path.join(tmpdir(), 'prompt-enhance-test-build-'));
  await cp(path.join(root, 'dist'), testExtension, { recursive: true });
  const workerPath = path.join(testExtension, 'background.js');
  await writeFile(workerPath, (await readFile(workerPath, 'utf8')).replace('http://127.0.0.1:8000/v1', `http://127.0.0.1:${server.address().port}/v1`));
  profile = await mkdtemp(path.join(tmpdir(), 'prompt-enhance-extension-test-'));
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 1200, height: 850 }, args: [`--disable-extensions-except=${testExtension}`, `--load-extension=${testExtension}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
  const bundle = await build({ entryPoints: [path.join(root, 'tests/prosemirror-fixture.js')], bundle: true, write: false, format: 'iife' });
  await context.route('https://chatgpt.com/**', route => {
    const url = route.request().url();
    if (url.endsWith('/fixture.js')) return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text });
    let html = fixture(url.includes('textarea'));
    if (url.includes('prosemirror')) html = html.replace('</body>', '<script src="/fixture.js"></script></body>');
    return route.fulfill({ contentType: 'text/html', body: html });
  });
  await context.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture() }));
});
test.afterAll(async () => { await context?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } if (profile) await rm(profile, { recursive: true, force: true }); if (testExtension) await rm(testExtension, { recursive: true, force: true }); });
test.beforeEach(async () => {
  requests = []; versions = []; delay = 0; responseMode = 'normal';
  const worker = context.serviceWorkers()[0];
  await worker.evaluate(() => chrome.storage.local.set({ enabled: false }));
});
test.afterEach(async () => { for (const page of context.pages()) await page.close(); });

async function open(url = 'https://chatgpt.com/') {
  const page = await context.newPage(); await page.goto(url);
  const panel = page.getByRole('region', { name: 'Prompt Enhance', exact: true });
  await expect(panel.getByRole('button', { name: 'Enable', exact: true })).toBeVisible();
  return { page, panel, editor: page.getByRole('textbox', { name: 'Ask ChatGPT' }) };
}
async function suggest(ui, text = 'Add retry logic to the API client') {
  await ui.panel.getByRole('button', { name: 'Enable', exact: true }).click();
  await ui.editor.fill(text); await ui.editor.press('End');
  await expect(ui.panel.getByRole('button', { name: 'Accept suggestion', exact: true })).toBeVisible();
  return text;
}
test('starts paused, accepts through the editor input/undo path, never sends', async () => {
  const ui = await open(); const draft = 'Add retry logic to the API client 🚀';
  await ui.editor.fill(draft); await ui.page.waitForTimeout(850);
  expect(requests.filter(r => r.path.endsWith('/enhance'))).toHaveLength(0);
  await ui.panel.getByRole('button', { name: 'Enable', exact: true }).click();
  await ui.editor.click(); await ui.editor.press('End');
  await expect(ui.panel.getByRole('button', { name: 'Accept suggestion' })).toBeVisible();
  await ui.editor.press('Tab');
  await expect(ui.editor).toHaveText(draft + suffix);
  expect(await ui.page.evaluate(() => window.model)).toBe(draft + suffix);
  expect(await ui.page.evaluate(() => window.sends)).toBe(0);
  await ui.editor.press('ControlOrMeta+z'); await expect(ui.editor).toHaveText(draft);
  await ui.editor.press('Enter'); expect(await ui.page.evaluate(() => window.sends)).toBe(1);
});
test('saving preserves base + suffix without accepting; history previews before replacement', async () => {
  const ui = await open(); const draft = await suggest(ui);
  await ui.panel.getByRole('button', { name: 'Save version' }).click();
  await expect(ui.panel.getByRole('status')).toHaveText('Saved');
  await expect(ui.editor).toHaveText(draft);
  expect(versions[0].prompt).toBe(draft); expect(versions[0].suggestion_text).toBe(suffix);
  await ui.panel.getByRole('button', { name: 'History', exact: true }).click();
  await ui.panel.locator('.version').click();
  await expect(ui.editor).toHaveText(draft);
  await ui.panel.getByRole('button', { name: 'Replace current draft' }).click();
  await expect(ui.editor).toHaveText(draft + suffix);
  expect(await ui.page.evaluate(() => window.sends)).toBe(0);
});
test('edited drafts discard delayed suggestions and cancel on pause', async () => {
  delay = 1200; const ui = await open();
  await ui.panel.getByRole('button', { name: 'Enable', exact: true }).click();
  await ui.editor.fill('First draft with retries');
  await expect.poll(() => requests.filter(r => r.path.endsWith('/enhance')).length).toBe(1);
  await ui.editor.fill('New');
  await ui.page.waitForTimeout(1400);
  await expect(ui.panel.getByRole('button', { name: 'Accept suggestion' })).toHaveCount(0);
  await ui.editor.fill('Another draft for cancellation');
  await expect.poll(() => requests.filter(r => r.path.endsWith('/enhance')).length).toBe(2);
  await ui.panel.getByRole('button', { name: 'Pause', exact: true }).click();
  await ui.page.waitForTimeout(1400);
  await expect(ui.panel.getByRole('button', { name: 'Accept suggestion' })).toHaveCount(0);
  await expect(ui.editor).toHaveText('Another draft for cancellation');
});
test('IME composition does not transmit partial text or intercept Tab', async () => {
  const ui = await open(); await ui.panel.getByRole('button', { name: 'Enable', exact: true }).click();
  await ui.editor.focus(); await ui.editor.dispatchEvent('compositionstart');
  await ui.editor.fill('A draft in composition mode');
  await ui.page.waitForTimeout(900); expect(requests.filter(r => r.path.endsWith('/enhance'))).toHaveLength(0);
  await ui.editor.dispatchEvent('compositionend');
  await expect(ui.panel.getByRole('button', { name: 'Accept suggestion' })).toBeVisible();
});
test('moving the caret invalidates a suggestion; SPA replacement clears it', async () => {
  const ui = await open(); const draft = await suggest(ui);
  await ui.editor.press('Home'); await expect(ui.panel.getByRole('button', { name: 'Accept suggestion' })).toHaveCount(0);
  await ui.editor.press('End'); await expect(ui.panel.getByRole('button', { name: 'Accept suggestion' })).toBeVisible();
  await ui.page.evaluate(() => { history.pushState({}, '', '/c/new-chat'); const old = document.querySelector('[data-composer-markdown]'); const next = old.cloneNode(false); next.textContent = ''; old.replaceWith(next); });
  await expect(ui.panel.getByRole('button', { name: 'Accept suggestion' })).toHaveCount(0);
  await expect(ui.editor).toHaveText(''); expect(await ui.page.evaluate(() => window.sends)).toBe(0);
});
test('history restore refuses to replace a draft edited after preview', async () => {
  const ui = await open(); await suggest(ui);
  await ui.panel.getByRole('button', { name: 'Save version' }).click(); await expect(ui.panel.getByRole('status')).toHaveText('Saved');
  await ui.panel.getByRole('button', { name: 'History', exact: true }).click(); await ui.panel.locator('.version').click();
  await ui.editor.fill('A changed draft I want to keep');
  await expect(ui.panel.getByRole('button', { name: 'Replace current draft' })).toBeDisabled();
  await expect(ui.editor).toHaveText('A changed draft I want to keep');
});
test('legacy textarea receives normal input; choices require preview and explicit acceptance', async () => {
  const ui = await open('https://chatgpt.com/?textarea'); const draft = await suggest(ui);
  await ui.panel.getByRole('button', { name: 'Accept suggestion' }).click(); await expect(ui.editor).toHaveValue(draft + suffix);
  expect(await ui.page.evaluate(() => window.model)).toBe(draft + suffix);
  responseMode = 'choice'; await ui.editor.fill('Implement retry logic with safe defaults'); await ui.editor.press('End');
  await ui.panel.getByRole('radio', { name: '1. bounded', exact: true }).click();
  await expect(ui.editor).toHaveValue('Implement retry logic with safe defaults');
  await ui.panel.getByRole('button', { name: 'Accept suggestion', exact: true }).click();
  await expect(ui.editor).toHaveValue('Implement retry logic with safe defaults using bounded backoff.');
});
test('suggestions are rendered as text, layout fits a narrow viewport, other sites stay untouched', async () => {
  responseMode = 'html'; const ui = await open(); await ui.page.setViewportSize({ width: 390, height: 844 }); await suggest(ui);
  await expect(ui.panel.locator('img')).toHaveCount(0); await expect(ui.panel.locator('.ghost-text')).toHaveText(' <img src=x onerror=alert(1)>');
  const box = await ui.panel.locator('.ghost-layer').boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
  await ui.page.screenshot({ path: path.join(root, 'test-results/extension-mobile.png') });
  await ui.page.goto('https://example.com'); await expect(ui.page.locator('#prompt-enhance-extension')).toHaveCount(0);
});
test('popup controls settings and verifies backend health', async () => {
  const page = await context.newPage(); await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.getByRole('button', { name: 'Enable suggestions' }).click();
  await expect(page.getByRole('button', { name: 'Pause suggestions' })).toBeVisible();
  await page.getByRole('button', { name: 'Check connection' }).click();
  await expect(page.locator('#status')).toContainText('Connected');
});
test('back/forward cache restoration remounts exactly one working panel', async () => {
  const ui = await open(); await suggest(ui);
  await ui.page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(ui.panel).toHaveCount(0);
  await ui.page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(ui.panel).toHaveCount(1);
  await ui.editor.fill('A new draft after returning'); await ui.editor.press('End');
  await expect(ui.panel.getByRole('button', { name: 'Accept suggestion' })).toBeVisible();
});
test('malformed replies do not modify the editor and can be retried', async () => {
  responseMode = 'invalid'; const ui = await open();
  await ui.panel.getByRole('button', { name: 'Enable', exact: true }).click();
  await ui.editor.fill('A draft that must remain unchanged');
  await expect(ui.panel.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(ui.panel.getByRole('button', { name: 'Accept suggestion' })).toHaveCount(0);
  await expect(ui.editor).toHaveText('A draft that must remain unchanged');
  responseMode = 'normal'; await ui.panel.getByRole('button', { name: 'Retry' }).click();
  await expect(ui.panel.getByRole('button', { name: 'Accept suggestion' })).toBeVisible();
});
test('normal desktop suggestion preview remains clear and keyboard accessible', async () => {
  const ui = await open(); await suggest(ui);
  await expect(ui.panel.getByRole('status')).toHaveText('Suggestion available. Press Tab to accept.');
  await ui.page.screenshot({ path: path.join(root, 'test-results/extension-desktop.png') });
  await ui.editor.press('Escape'); await expect(ui.panel.getByRole('button', { name: 'Accept suggestion' })).toHaveCount(0);
  await expect(ui.editor).toHaveText('Add retry logic to the API client');
});
test('real ProseMirror document state accepts suggestions and undo restores the draft', async () => {
  const ui = await open('https://chatgpt.com/?prosemirror'); const draft = await suggest(ui, 'Explain retries with an example 🚀');
  await ui.page.evaluate(() => window.closeUndoGroup());
  await ui.editor.press('Tab');
  await expect.poll(() => ui.page.evaluate(() => window.model)).toBe(draft + suffix);
  await ui.editor.press('ControlOrMeta+z');
  await expect.poll(() => ui.page.evaluate(() => window.model)).toBe(draft);
});
test('multiline ProseMirror drafts preserve newlines in saved and accepted versions', async () => {
  const ui = await open('https://chatgpt.com/?prosemirror');
  await ui.panel.getByRole('button', { name: 'Enable', exact: true }).click();
  await ui.editor.fill('Explain retry logic'); await ui.editor.press('Shift+Enter'); await ui.editor.pressSequentially('Include a short example');
  await expect(ui.panel.getByRole('button', { name: 'Accept suggestion' })).toBeVisible();
  const original = await ui.page.evaluate(() => window.model);
  const request = requests.filter(r => r.path.endsWith('/enhance')).at(-1);
  expect(request.body.prompt).toBe(original);
  await ui.editor.press('Tab');
  await expect.poll(() => ui.page.evaluate(() => window.model)).toBe(original + suffix);
});
async function inlineGeometry(page) {
  return page.evaluate(() => {
    const editor = document.querySelector('[data-composer-markdown]');
    const root = document.querySelector('#prompt-enhance-extension').shadowRoot;
    const caret = getSelection().getRangeAt(0).getBoundingClientRect();
    const ghost = root.querySelector('.ghost-text');
    const start = document.createRange(); start.setStart(ghost.firstChild, 0); start.setEnd(ghost.firstChild, 1);
    const first = start.getBoundingClientRect(), bounds = editor.getBoundingClientRect();
    return { x: first.left - caret.left, y: first.top - caret.top, lastBottom: ghost.getBoundingClientRect().bottom, editorBottom: bounds.bottom, editorText: editor.innerText, containsGhost: editor.contains(ghost), minHeight: editor.style.minHeight };
  });
}
test('autocomplete is inline at the caret, reserves composer space and never opens a card', async () => {
  const ui = await open('https://chatgpt.com/?prosemirror');
  await suggest(ui, 'Add retries to the client');
  await expect(ui.panel.locator('.panel')).toBeHidden();
  await expect.poll(async () => Math.abs((await inlineGeometry(ui.page)).x)).toBeLessThan(2);
  const geometry = await inlineGeometry(ui.page);
  expect(Math.abs(geometry.y)).toBeLessThan(2);
  expect(geometry.containsGhost).toBe(false);
  expect(geometry.editorText).toBe('Add retries to the client');
  expect(geometry.lastBottom).toBeLessThanOrEqual(geometry.editorBottom + 1);
  await ui.editor.press('Escape');
  expect(await ui.editor.evaluate(editor => editor.style.minHeight)).toBe('');
  await expect(ui.panel.locator('.ghost-layer')).toBeHidden();
});
test('inline text wraps inside narrow composers and realigns after resize', async () => {
  const ui = await open('https://chatgpt.com/?prosemirror');
  await ui.page.setViewportSize({ width: 390, height: 844 });
  await suggest(ui, 'Write a Python function that retries failed HTTP requests');
  await expect.poll(async () => Math.abs((await inlineGeometry(ui.page)).x)).toBeLessThan(2);
  let geometry = await inlineGeometry(ui.page); expect(Math.abs(geometry.y)).toBeLessThan(2); expect(geometry.lastBottom).toBeLessThanOrEqual(geometry.editorBottom + 1);
  await ui.page.screenshot({ path: path.join(root, 'test-results/inline-mobile.png') });
  await ui.page.setViewportSize({ width: 1200, height: 850 });
  await expect.poll(async () => Math.abs((await inlineGeometry(ui.page)).x)).toBeLessThan(2);
  geometry = await inlineGeometry(ui.page); expect(Math.abs(geometry.y)).toBeLessThan(2);
  await ui.page.screenshot({ path: path.join(root, 'test-results/inline-desktop.png') });
});
test('typing through a real ProseMirror ghost preserves its remainder without another request', async () => {
  const ui = await open('https://chatgpt.com/?prosemirror'); const draft = await suggest(ui);
  const count = requests.filter(request => request.path.endsWith('/enhance')).length;
  await ui.editor.pressSequentially(' with bounded');
  await expect(ui.panel.locator('.ghost-text')).toHaveText(' backoff.');
  await ui.page.waitForTimeout(850);
  expect(requests.filter(request => request.path.endsWith('/enhance')).length).toBe(count);
  await ui.editor.press('Tab');
  await expect.poll(() => ui.page.evaluate(() => window.model)).toBe(draft + suffix);
});
test('questions show only choices; the selected answer previews inline and Tab accepts', async () => {
  responseMode = 'choice'; const ui = await open('https://chatgpt.com/?prosemirror');
  await ui.panel.getByRole('button', { name: 'Enable', exact: true }).click(); await ui.editor.fill('Implement safe retry logic');
  await expect(ui.panel.locator('.question')).toBeVisible(); await expect(ui.panel.locator('.ghost-layer')).toBeHidden();
  await expect(ui.panel.getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0);
  await ui.panel.getByRole('radio', { name: '1. bounded', exact: true }).click();
  await expect(ui.panel.locator('.preview')).toHaveCount(0);
  await expect(ui.panel.locator('.ghost-layer')).toBeVisible();
  await expect(ui.panel.locator('.ghost-text')).toHaveText(' using bounded backoff.');
  await expect(ui.editor).toHaveText('Implement safe retry logic');
  await ui.panel.getByRole('radio', { name: '1. bounded', exact: true }).press('ArrowDown');
  await expect(ui.panel.locator('.ghost-text')).toHaveText(' using exponential backoff.');
  await ui.panel.getByRole('radio', { name: '2. exponential', exact: true }).press('ArrowUp');
  await ui.page.screenshot({ path: path.join(root, 'test-results/question-inline.png') });
  await ui.panel.getByRole('radio', { name: '1. bounded', exact: true }).press('Tab');
  await expect.poll(() => ui.page.evaluate(() => window.model)).toBe('Implement safe retry logic using bounded backoff.');
  await expect(ui.panel.locator('.panel')).toBeHidden();
  expect(await ui.page.evaluate(() => window.sends)).toBe(0);
});

test('question corrections preview in the composer without changing its document and dismiss restores styles', async () => {
  responseMode = 'rewrite'; const ui = await open('https://chatgpt.com/?prosemirror');
  await ui.editor.evaluate(editor => editor.style.setProperty('-webkit-text-fill-color', 'rgb(20, 30, 40)', 'important'));
  await ui.panel.getByRole('button', { name: 'Enable', exact: true }).click(); await ui.editor.fill('Implement safe retry logic');
  await ui.panel.getByRole('radio', { name: '1. bounded', exact: true }).click();
  await expect(ui.panel.locator('.ghost-text')).toHaveText('Implement retries using bounded backoff.');
  expect(await ui.page.evaluate(() => window.model)).toBe('Implement safe retry logic');
  expect(await ui.editor.evaluate(editor => getComputedStyle(editor).webkitTextFillColor)).toBe('rgba(0, 0, 0, 0)');
  await ui.panel.getByRole('radio', { name: '1. bounded', exact: true }).press('Escape');
  expect(await ui.editor.evaluate(editor => editor.style.getPropertyValue('-webkit-text-fill-color'))).toBe('rgb(20, 30, 40)');
  expect(await ui.editor.evaluate(editor => editor.style.getPropertyPriority('-webkit-text-fill-color'))).toBe('important');
  await expect(ui.panel.locator('.ghost-layer')).toBeHidden();
  await ui.editor.fill('Implement retry logic carefully');
  await ui.panel.getByRole('radio', { name: '1. bounded', exact: true }).click();
  await ui.page.evaluate(() => window.closeUndoGroup());
  await ui.panel.getByRole('radio', { name: '1. bounded', exact: true }).press('Enter');
  await expect.poll(() => ui.page.evaluate(() => window.model)).toBe('Implement retries using bounded backoff.');
  expect(await ui.editor.evaluate(editor => getComputedStyle(editor).webkitTextFillColor)).toBe('rgb(20, 30, 40)');
  await ui.editor.press('ControlOrMeta+z');
  await expect.poll(() => ui.page.evaluate(() => window.model)).toBe('Implement retry logic carefully');
  expect(await ui.page.evaluate(() => window.sends)).toBe(0);
});

test('ChatGPT single-line important rules do not clip wrapped ghost text; original sizing returns on dismiss', async () => {
  responseMode = 'long'; const ui = await open('https://chatgpt.com/?prosemirror');
  await ui.page.evaluate(() => {
    const editor = document.querySelector('[data-composer-markdown]');
    const wrapper = document.createElement('div'); wrapper.dataset.composerInputLayout = 'single-line';
    editor.before(wrapper); wrapper.append(editor);
    const style = document.createElement('style');
    style.textContent = '[data-composer-input-layout]{display:flex;height:26px;overflow:hidden;margin:5px 0;line-height:26px} [data-composer-input-layout] > .ProseMirror{height:100%!important;min-height:0!important;overflow:hidden;line-height:26px;flex:1}';
    document.head.append(style);
    editor.style.setProperty('min-height', '0px', 'important'); wrapper.style.minHeight = '0px';
  });
  await ui.page.setViewportSize({ width: 1000, height: 800 });
  await suggest(ui, 'I want to build a tic tac toe app');
  const clipped = () => ui.page.evaluate(() => {
    const editor = document.querySelector('[data-composer-markdown]'), wrapper = editor.parentElement;
    const root = document.querySelector('#prompt-enhance-extension').shadowRoot;
    const ghost = root.querySelector('.ghost-layer').getBoundingClientRect();
    return { overflow: ghost.bottom - Math.min(editor.getBoundingClientRect().bottom, wrapper.getBoundingClientRect().bottom), height: ghost.height, x: ghost.left - editor.getBoundingClientRect().left };
  });
  await expect.poll(async () => (await clipped()).overflow).toBeLessThanOrEqual(1);
  expect((await clipped()).height).toBeGreaterThan(26);
  await ui.page.screenshot({ path: path.join(root, 'test-results/chatgpt-wrapped-inline.png') });
  await ui.page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await clipped()).overflow).toBeLessThanOrEqual(1);
  await ui.editor.press('Escape');
  expect(await ui.editor.evaluate(editor => editor.style.minHeight)).toBe('0px');
  expect(await ui.editor.evaluate(editor => editor.style.getPropertyPriority('min-height'))).toBe('important');
  expect(await ui.editor.evaluate(editor => editor.parentElement.style.minHeight)).toBe('0px');
  expect(await ui.editor.evaluate(editor => editor.parentElement.style.getPropertyPriority('min-height'))).toBe('');
});
