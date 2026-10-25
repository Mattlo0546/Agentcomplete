import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const core = await readFile(new URL('../src/core.js', import.meta.url), 'utf8');
const background = await readFile(new URL('../src/background.js', import.meta.url), 'utf8');
const sender = { id: 'extension-id', url: 'https://chatgpt.com/', frameId: 0, tab: { id: 1, url: 'https://chatgpt.com/' } };
function harness({ enabled = false, fetcher = async () => Response.json({ status: 'ok' }) } = {}) {
  let listener, changed;
  const calls = [];
  const chrome = { runtime: { id: 'extension-id', getURL: file => 'chrome-extension://extension-id/' + file, onMessage: { addListener(fn) { listener = fn; } } }, storage: { local: { async get() { return { enabled }; }, async set(value) { const oldValue = enabled; enabled = value.enabled; changed({ enabled: { oldValue, newValue: enabled } }, 'local'); } }, onChanged: { addListener(fn) { changed = fn; } } } };
  const context = vm.createContext({ chrome, URL, TextDecoder, AbortController, AbortSignal, fetch: (...args) => { calls.push(args); return fetcher(...args); }, importScripts() { vm.runInContext(core, context); } });
  vm.runInContext(background, context);
  return { calls, send: (message, from = sender) => new Promise(resolve => { assert.equal(listener(message, from, resolve), true); }) };
}
const enhance = { type: 'enhance', id: 'request-1', revision: 0, prompt: 'Add retry logic to the client' };
test('rejects other extensions, origins, iframes and URL spoofing before any fetch', async () => {
  const h = harness({ enabled: true });
  for (const from of [{ ...sender, id: 'other' }, { ...sender, url: 'https://evil.test' }, { ...sender, frameId: 1 }, { ...sender, tab: { id: 1, url: 'https://evil.test' } }, { id: sender.id, url: 'chrome-extension://extension-id/other.html' }]) assert.equal((await h.send(enhance, from)).ok, false);
  assert.equal(h.calls.length, 0);
});
test('paused extension cannot transmit drafts', async () => {
  const h = harness();
  assert.match((await h.send(enhance)).error, /paused/);
  assert.equal(h.calls.length, 0);
});
test('popup can change settings and check health but cannot submit a draft', async () => {
  const h = harness(), popup = { id: sender.id, url: 'chrome-extension://extension-id/popup.html' };
  assert.equal((await h.send({ type: 'set-enabled', enabled: true }, popup)).ok, true);
  assert.equal((await h.send({ type: 'health' }, popup)).ok, true);
  assert.equal((await h.send(enhance, popup)).ok, false);
  assert.equal((await h.send({ type: 'settings' }, { ...popup, tab: { id: 3, url: popup.url } })).ok, true);
  assert.equal((await h.send(enhance, { ...popup, tab: { id: 3, url: popup.url } })).ok, false);
  assert.equal(h.calls.length, 1);
});
test('worker fixes destination and strips credentials and redirects', async () => {
  const h = harness({ enabled: true });
  await h.send({ ...enhance, url: 'https://evil.test', cursor: 0 });
  const [url, options] = h.calls[0];
  assert.equal(url, 'http://127.0.0.1:8000/v1/enhance');
  assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
  assert.deepEqual(JSON.parse(options.body), { request_id: enhance.id, prompt: enhance.prompt, prompt_revision: 0, cursor: enhance.prompt.length });
});
test('new requests cancel only the same tab; pausing cancels every in-flight request', async () => {
  const h = harness({ enabled: true, fetcher: (_, options) => new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); }) });
  const first = h.send(enhance); await new Promise(resolve => setImmediate(resolve));
  const other = h.send(enhance, { ...sender, tab: { ...sender.tab, id: 2 } }); await new Promise(resolve => setImmediate(resolve));
  const second = h.send({ ...enhance, id: 'request-2' }); await new Promise(resolve => setImmediate(resolve));
  assert.match((await first).error, /cancelled/);
  assert.equal(h.calls[1][1].signal.aborted, false);
  await h.send({ type: 'set-enabled', enabled: false });
  assert.match((await second).error, /cancelled/); assert.match((await other).error, /cancelled/);
});
test('oversized backend responses are rejected', async () => {
  const h = harness({ fetcher: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) });
  assert.match((await h.send({ type: 'health' })).error, /too large/);
});
