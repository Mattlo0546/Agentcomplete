/* global chrome, importScripts, PromptEnhanceCore */
importScripts('core.js');
(() => {
  'use strict';
  const C = PromptEnhanceCore;
  const API = 'http://127.0.0.1:8000/v1';
  const requests = new Map();
  let settingsEpoch = 0;
  const settings = () => chrome.storage.local.get({ enabled: false });
  function abortAll() {
    settingsEpoch++;
    for (const value of requests.values()) value.controller.abort();
    requests.clear();
  }
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.enabled) abortAll(); });
  function allowed(sender) {
    return sender.id === chrome.runtime.id && ((sender.tab && sender.frameId === 0 && C.isChatGPT(sender.url) && C.isChatGPT(sender.tab.url)) || sender.url === chrome.runtime.getURL('popup.html'));
  }
  async function api(path, method = 'GET', body, signal) {
    let response;
    const timeout = AbortSignal.timeout(25000);
    try {
      response = await fetch(API + path, { method, credentials: 'omit', cache: 'no-store', redirect: 'error', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch {
      if (signal?.aborted) throw new Error('Request cancelled.');
      if (timeout.aborted) throw new Error('The backend took too long. Try again.');
      throw new Error('Backend offline. Start Prompt Enhance on 127.0.0.1:8000.');
    }
    if (!response.ok) throw new Error(response.status === 404 ? 'Update the backend to the prompt-history version.' : `Backend returned ${response.status}. Try again.`);
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let text = '', bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 2 * 1024 * 1024) throw new Error('The backend response was too large.');
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      return JSON.parse(text);
    } finally { await reader.cancel().catch(() => {}); }
  }
  async function handle(raw, sender) {
    if (!allowed(sender)) throw new Error('This extension only works in the ChatGPT composer.');
    const message = C.validateMessage(raw);
    if (message.type === 'settings') return settings();
    if (message.type === 'set-enabled') { abortAll(); await chrome.storage.local.set({ enabled: message.enabled }); return { enabled: message.enabled }; }
    if (message.type === 'health') return api('/health');
    if (!sender.tab || !C.isChatGPT(sender.url)) throw new Error('Open ChatGPT to use this action.');
    const key = sender.tab.id;
    if (message.type === 'cancel') {
      const current = requests.get(key);
      if (current && (!message.id || message.id === current.id)) current.controller.abort();
      return {};
    }
    if (message.type === 'history') {
      const page = await api(`/prompt-history?limit=10&offset=${message.offset}`);
      if (!Array.isArray(page.items) || page.items.length > 10 || !Number.isInteger(page.total) || page.total < 0) throw new Error('Invalid history response.');
      return { items: page.items.map(C.validateVersion), total: page.total };
    }
    if (message.type === 'save') return C.validateVersion(await api('/prompt-history', 'POST', { prompt: message.prompt, suggestion_text: message.suggestion || null, title: message.prompt.trim().slice(0, 80).replace(/[\uD800-\uDBFF]$/, ''), description: 'Saved explicitly from the ChatGPT Chrome extension.' }));
    const epoch = settingsEpoch;
    if (!(await settings()).enabled || epoch !== settingsEpoch) throw new Error('Suggestions are paused.');
    requests.get(key)?.controller.abort();
    const request = { id: message.id, controller: new AbortController() };
    requests.set(key, request);
    try { return await api('/enhance', 'POST', { request_id: message.id, prompt: message.prompt, prompt_revision: message.revision, cursor: message.prompt.length }, request.controller.signal); }
    finally { if (requests.get(key) === request) requests.delete(key); }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    handle(message, sender).then(data => respond({ ok: true, data })).catch(error => respond({ ok: false, error: error.message }));
    return true;
  });
})();
