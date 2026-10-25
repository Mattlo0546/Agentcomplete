// Opt-in: uses the configured running backend, Gemini and prompt-history DB.
// Only a generated test draft is sent. Its saved UUID is removed in finally.
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const api = 'http://127.0.0.1:8000/v1';
const health = await (await fetch(api + '/health?deep=1')).json();
assert.equal(health.db, 'ok'); assert.equal(health.gemini, 'ok');
const profile = await mkdtemp(path.join(tmpdir(), 'prompt-enhance-live-'));
let context, savedId;
const draft = 'Write a Python function that retries failed HTTP requests with';
try {
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${path.join(root, 'dist')}`, `--load-extension=${path.join(root, 'dist')}`] });
  const bundle = await build({ entryPoints: [path.join(root, 'tests/prosemirror-fixture.js')], bundle: true, write: false, format: 'iife' });
  await context.route('https://chatgpt.com/**', route => route.fulfill(route.request().url().endsWith('/fixture.js') ? { contentType: 'text/javascript', body: bundle.outputFiles[0].text } : { contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px system-ui;margin:60px}p{margin:0}[data-composer-body]{position:absolute;bottom:80px;width:700px;padding:20px;border:1px solid #ccc;border-radius:16px}[contenteditable]{min-height:80px;outline:none;white-space:pre-wrap}</style></head><body><h1>Local extension + live backend test</h1><p>This is a ProseMirror fixture, not a ChatGPT conversation.</p><div data-composer-body><div data-composer-markdown contenteditable="true" role="textbox" aria-label="Ask ChatGPT"></div></div><script src="/fixture.js"></script></body></html>' }));
  const page = await context.newPage(); await page.goto('https://chatgpt.com/');
  const panel = page.getByRole('region', { name: 'Prompt Enhance', exact: true });
  await panel.getByRole('button', { name: 'Enable', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Ask ChatGPT' });
  await editor.fill(draft); await editor.press('End');
  await panel.getByRole('button', { name: 'Accept suggestion' }).waitFor({ timeout: 30000 });
  const suffix = await panel.locator('.ghost-text').textContent();
  assert.ok(suffix?.trim());
  await panel.getByRole('button', { name: 'Save version' }).click();
  await page.waitForFunction(() => document.querySelector('#prompt-enhance-extension').shadowRoot.querySelector('[role=status]').textContent === 'Saved');
  const history = await (await fetch(api + '/prompt-history?limit=10&offset=0')).json();
  const saved = history.items.find(value => value.prompt === draft && value.suggestion_text === suffix && value.description === 'Saved explicitly from the ChatGPT Chrome extension.');
  assert.ok(saved); savedId = saved.id;
  assert.equal(saved.saved_text, draft + suffix);
  assert.equal(await page.evaluate(() => window.model), draft);
  await editor.press('Tab');
  await page.waitForFunction(expected => window.model === expected, draft + suffix);
  await panel.getByRole('button', { name: 'History', exact: true }).click();
  await panel.locator('.version').filter({ hasText: draft }).first().click();
  await panel.getByRole('button', { name: 'Replace current draft' }).click();
  await page.waitForFunction(expected => window.model === expected, draft + suffix);
  console.log(JSON.stringify({ db: health.db, gemini: health.gemini, realAutocomplete: true, suffixLength: suffix.length, preservedBaseAndSuffix: true, prosemirrorAcceptance: true, historyRestore: true }));
} finally {
  if (savedId) { const result = await fetch(api + '/prompt-history/' + savedId, { method: 'DELETE' }); assert.equal(result.status, 204); console.log('Removed the smoke test saved version.'); }
  await context?.close(); await rm(profile, { recursive: true, force: true });
}
