/* global chrome, PromptEnhanceCore, PromptEnhanceEditor, PromptEnhanceGhost */
(() => {
  'use strict';
  if (globalThis.__promptEnhanceMounted || !PromptEnhanceCore.isChatGPT(location.href)) return;
  globalThis.__promptEnhanceMounted = true;
  const C = PromptEnhanceCore, E = PromptEnhanceEditor;
  const CSS = /* BUILD_CSS */ "";
  let editor = null, observedText = '', url = location.href;
  let enabled = false, composing = false, revision = 0, timer, pending = null, suggestion = null;
  let status = 'Paused', dismissed = null, view = null, viewEpoch = 0, saving = false, selectedChoice = null;
  let scheduled = false, applying = false, alive = true;
  const host = document.createElement('div');
  host.id = 'prompt-enhance-extension';
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = CSS;
  const region = document.createElement('section'); region.setAttribute('aria-label', 'Prompt Enhance');
  const dock = document.createElement('div'); dock.className = 'dock'; dock.setAttribute('aria-label', 'Prompt Enhance controls');
  const panel = document.createElement('div'); panel.className = 'panel';
  region.append(dock, panel); shadow.append(style, region);
  const ghost = PromptEnhanceGhost.create(region, accept);
  document.body.append(host);
  async function send(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || 'Extension unavailable. Reload ChatGPT.');
    return response.data;
  }
  function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function button(label, action, className) {
    const el = node('button', label, className);
    el.type = 'button'; el.addEventListener('click', action);
    return el;
  }
  function errorText(error) {
    return /Extension context invalidated/i.test(error.message) ? 'Extension updated. Reload ChatGPT.' : error.message;
  }
  function invalidate(nextStatus = enabled ? 'Ready' : 'Paused') {
    revision++;
    clearTimeout(timer);
    if (pending) send({ type: 'cancel', id: pending.id }).catch(() => {});
    pending = null; suggestion = null; selectedChoice = null; status = nextStatus; ghost.clear();
  }
  function matching(snapshot) {
    return alive && !composing && editor === snapshot.editor && editor?.isConnected && E.find() === editor && location.href === snapshot.url && E.text(editor) === snapshot.text && revision === snapshot.revision;
  }
  function position() {
    if (!editor?.isConnected || !editor.getClientRects().length) { host.hidden = true; return; }
    const rect = (editor.closest('[data-composer-body]') || editor).getBoundingClientRect();
    host.hidden = rect.bottom <= 0 || rect.top >= innerHeight;
    dock.style.left = `${Math.max(8, Math.min(rect.right - dock.offsetWidth, innerWidth - dock.offsetWidth - 8))}px`;
    dock.style.top = `${Math.min(innerHeight - dock.offsetHeight - 4, rect.bottom + 5)}px`;
    panel.style.width = `${Math.min(420, innerWidth - 24)}px`;
    panel.style.left = `${Math.max(12, Math.min(rect.right - panel.offsetWidth, innerWidth - panel.offsetWidth - 12))}px`;
    panel.style.top = `${Math.max(8, rect.top - panel.offsetHeight - 10)}px`;
    ghost.position();
  }
  function render() {
    if (!alive) return;
    panel.replaceChildren(); dock.replaceChildren();
    const continuation = inlineSuggestion();
    const indicator = node('span', status === 'Suggestion' && continuation ? (selectedChoice ? `${selectedChoice.label}. Preview in composer. Press Tab to accept.` : 'Suggestion available. Press Tab to accept.') : status, 'sr-only');
    indicator.setAttribute('role', 'status'); indicator.setAttribute('aria-live', 'polite');
    indicator.title = status;
    dock.append(indicator);
    const historyButton = button('History', () => loadHistory(0), 'quiet');
    historyButton.setAttribute('aria-expanded', String(Boolean(view)));
    historyButton.title = 'Prompt history'; historyButton.setAttribute('aria-label', 'History');
    historyButton.replaceChildren(icon('history'));
    const saveButton = button('', save, 'quiet'); saveButton.setAttribute('aria-label', suggestion?.result.type === 'autocomplete' ? 'Save version' : 'Save draft');
    saveButton.title = saving ? 'Saving…' : (suggestion?.result.type === 'autocomplete' ? 'Save draft and suggestion' : 'Save draft');
    saveButton.append(icon('save')); saveButton.disabled = saving || !editor || !E.text(editor).trim();
    const toggleButton = button(enabled ? 'Pause' : 'Enable', toggle, 'quiet toggle');
    toggleButton.title = enabled ? 'Pause Prompt Enhance' : 'Enable suggestions · sends this draft to your local backend and Gemini';
    dock.append(historyButton, saveButton, toggleButton);
    if (pending) dock.append(node('span', '···', 'working'));
    if (status === 'Saved') dock.append(node('span', 'Saved', 'feedback'));
    if (status.length > 40) { const retry = button('Retry', () => { dismissed = null; editor?.focus(); queue(); }, 'quiet'); retry.title = status; dock.append(retry); }
    ghost.update(!view && continuation && matching(suggestion.snapshot) ? editor : null, continuation?.text, continuation ? !continuation.append : false);
    panel.hidden = !view && suggestion?.result.type !== 'multiple_choice';
    if (view) renderHistory();
    else if (suggestion?.result.type === 'multiple_choice') renderQuestion();
    position();
  }
  function icon(kind) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', kind === 'history' ? 'M3 11a9 9 0 1 1 2.6 7M3 4v7h7M12 7v5l3 2' : 'M6 3h12v18l-6-4-6 4z');
    svg.append(path); return svg;
  }
  function renderQuestion() {
    const current = suggestion;
    const body = node('div', undefined, 'body question'); body.setAttribute('aria-label', 'Clarifying question');
    const heading = node('div', undefined, 'history-heading');
    heading.append(node('strong', current.result.question), button('Dismiss', dismiss, 'quiet')); body.append(heading);
    const options = node('div', undefined, 'options'); options.setAttribute('role', 'radiogroup'); options.setAttribute('aria-label', current.result.question);
    for (const [index, option] of current.result.options.entries()) {
      const choice = button(`${index + 1}. ${option.label}`, () => { selectedChoice = option; render(); shadow.querySelector(`[data-option="${index}"]`)?.focus(); }, 'option');
      choice.dataset.option = String(index); choice.setAttribute('role', 'radio'); choice.setAttribute('aria-checked', String(selectedChoice?.id === option.id));
      options.append(choice);
    }
    body.append(options);
    body.append(node('span', selectedChoice ? 'Preview in composer · Tab to accept · Esc to dismiss' : 'Choose an option to preview inline · Esc to dismiss', 'muted'));
    panel.append(body);
  }
  function inlineSuggestion() {
    if (suggestion?.result.type === 'autocomplete') return { text: suggestion.result.text, append: true };
    if (suggestion?.result.type !== 'multiple_choice' || !selectedChoice) return null;
    const base = suggestion.snapshot.text, proposed = selectedChoice.text;
    return proposed.startsWith(base) ? { text: proposed.slice(base.length), append: true } : { text: proposed, append: false };
  }
  async function toggle() {
    try { const value = await send({ type: 'set-enabled', enabled: !enabled }); enabled = value.enabled; invalidate(); view = null; viewEpoch++; render(); queue(); }
    catch (error) { status = errorText(error); render(); }
  }
  function dismiss() { dismissed = editor ? E.text(editor) : null; invalidate(); render(); }
  function accept() {
    const current = suggestion, continuation = inlineSuggestion();
    if (!current || !continuation || !matching(current.snapshot)) { invalidate('Draft changed. Try again.'); render(); return false; }
    applying = true;
    ghost.clear();
    const ok = E.write(editor, current.snapshot.text, continuation.text, continuation.append);
    applying = false;
    observedText = E.text(editor); dismissed = observedText;
    invalidate(ok ? 'Accepted' : 'Could not insert into this editor. Select and paste the suggestion instead.');
    render(); return ok;
  }
  function queue() {
    clearTimeout(timer);
    if (!enabled || composing || view || !editor || !E.atEnd(editor) || document.hidden) return;
    const text = E.text(editor);
    if (text.length < 12 || text.length > C.MAX_PROMPT || text === dismissed || !C.validString(text) || editor.querySelector('[contenteditable="false"], img, table')) return;
    timer = setTimeout(request, 150);
  }
  async function request() {
    if (!enabled || composing || view || !editor || !E.atEnd(editor) || document.hidden) return;
    const text = E.text(editor);
    if (text.length < 12 || text.length > C.MAX_PROMPT || !text.trim()) return;
    const snapshot = { id: 'chrome_' + crypto.randomUUID(), revision, text, editor, url: location.href };
    pending = snapshot; status = 'Thinking…'; render();
    try {
      const data = await send({ type: 'enhance', id: snapshot.id, revision: snapshot.revision, prompt: snapshot.text });
      if (pending !== snapshot || !enabled || !matching(snapshot)) return;
      if (!E.atEnd(editor) || document.hidden) { pending = null; status = 'Ready'; render(); return; }
      const result = C.validateReply(data, snapshot);
      pending = null;
      if (result.type === 'none') { status = 'Nothing to add'; dismissed = text; }
      else { suggestion = { snapshot, result }; status = 'Suggestion'; }
      render();
    } catch (error) {
      if (pending !== snapshot || !matching(snapshot)) return;
      pending = null; status = errorText(error); render();
    }
  }
  async function save() {
    if (saving || !editor) return;
    const text = E.text(editor);
    try { C.prompt(text); } catch (error) { status = error.message; render(); return; }
    const suffix = suggestion?.result.type === 'autocomplete' && matching(suggestion.snapshot) ? suggestion.result.text : null;
    saving = true; status = 'Saving…'; render();
    try { await send({ type: 'save', prompt: text, suggestion: suffix }); status = 'Saved'; }
    catch (error) { status = errorText(error); }
    finally { saving = false; render(); }
  }
  async function loadHistory(offset) {
    invalidate();
    const epoch = ++viewEpoch;
    view = { type: 'loading', offset }; render();
    try {
      const page = await send({ type: 'history', offset });
      if (epoch !== viewEpoch) return;
      view = { type: 'history', offset, ...page }; render();
    } catch (error) {
      if (epoch !== viewEpoch) return;
      view = { type: 'error', message: errorText(error), offset }; render();
    }
  }
  function closeHistory() { view = null; viewEpoch++; render(); editor?.focus({ preventScroll: true }); }
  function preview(text, title, previousSnapshot) {
    const snapshot = previousSnapshot || { text: E.text(editor), editor, url: location.href, revision };
    view = { type: 'preview', text, title, snapshot }; viewEpoch++;
    render();
    shadow.querySelector('.replace')?.focus();
  }
  function restore() {
    const selected = view;
    if (selected?.type !== 'preview' || !matching(selected.snapshot)) { status = 'Draft changed. Reopen the saved version before replacing.'; render(); return; }
    applying = true;
    const ok = E.write(editor, selected.snapshot.text, selected.text, false);
    applying = false;
    observedText = E.text(editor); dismissed = observedText;
    invalidate(ok ? 'Restored · not sent' : 'Could not replace this editor. Select and paste the preview instead.');
    view = null; viewEpoch++; render();
  }
  function renderHistory() {
    const body = node('div', undefined, 'body history');
    const heading = node('div', undefined, 'history-heading');
    heading.append(node('strong', view.type === 'preview' ? 'Preview version' : 'Prompt history'), button('Close', closeHistory, 'quiet'));
    body.append(heading);
    if (view.type === 'loading') body.append(node('p', 'Loading saved versions…'));
    if (view.type === 'error') { body.append(node('p', view.message)); body.append(button('Retry', () => loadHistory(view.offset))); }
    if (view.type === 'history') {
      if (!view.items.length) body.append(node('p', 'No saved versions yet. Save a draft or a suggestion to keep it here.'));
      const list = node('div', undefined, 'versions');
      for (const item of view.items) {
        const row = button('', () => preview(item.saved_text, item.title || 'Saved prompt'), 'version');
        row.append(node('strong', item.title || item.prompt.slice(0, 70)), node('span', item.saved_text.slice(0, 130)));
        list.append(row);
      }
      body.append(list);
      const page = node('div', undefined, 'actions');
      const newer = button('Newer', () => loadHistory(view.offset - 10)); newer.disabled = view.offset === 0;
      const older = button('Older', () => loadHistory(view.offset + 10)); older.disabled = view.offset + view.items.length >= view.total;
      page.append(newer, node('span', `${view.total} saved`, 'muted'), older); body.append(page);
    }
    if (view.type === 'preview') {
      body.append(node('p', view.title, 'muted'), node('pre', view.text, 'preview'));
      const unchanged = matching(view.snapshot);
      body.append(node('p', unchanged ? 'Replaces the current draft. Nothing is sent.' : 'Draft changed. Reopen this version to review it again.', 'muted'));
      const actions = node('div', undefined, 'actions');
      const replace = button('Replace current draft', restore, 'primary replace'); replace.disabled = !unchanged;
      actions.append(replace, button('Back to history', () => loadHistory(0), 'quiet')); body.append(actions);
    }
    panel.append(body);
  }
  function sync() {
    scheduled = false;
    const next = E.find();
    if (next !== editor || url !== location.href) {
      invalidate(); view = null; viewEpoch++; composing = false; dismissed = null;
      editor = next; url = location.href; observedText = editor ? E.text(editor) : '';
      resize.disconnect(); resize.observe(panel);
      if (editor) { resize.observe(editor); resize.observe(editor.closest('[data-composer-body]') || editor.parentElement); }
      render();
      return; // Existing drafts are read only after focus/input, never on navigation.
    }
    if (!editor) { host.hidden = true; return; }
    const text = E.text(editor);
    if (text !== observedText && !applying) { observedText = text; invalidate(); render(); queue(); }
    position();
  }
  function scheduleSync() { if (!scheduled && alive) { scheduled = true; requestAnimationFrame(sync); } }
  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  const resize = new ResizeObserver(position); resize.observe(panel);
  document.addEventListener('input', event => {
    if (event.target !== editor || applying) return;
    const text = E.text(editor), current = suggestion, continuation = inlineSuggestion();
    const added = text.startsWith(observedText) ? text.slice(observedText.length) : '';
    if (!composing && continuation?.append && current.snapshot.editor === editor && current.snapshot.url === location.href && current.snapshot.revision === revision && current.snapshot.text === observedText && added && C.validString(added) && continuation.text.startsWith(added) && E.atEnd(editor)) {
      const remaining = continuation.text.slice(added.length);
      if (C.validString(remaining)) {
        observedText = text; revision++; clearTimeout(timer); selectedChoice = null;
        suggestion = remaining ? { snapshot: { ...current.snapshot, text, revision }, result: { type: 'autocomplete', text: remaining } } : null;
        status = remaining ? 'Suggestion' : 'Ready'; if (!remaining) dismissed = text;
        render(); return;
      }
    }
    observedText = text; invalidate(); render(); queue();
  }, true);
  document.addEventListener('focusin', event => { scheduleSync(); if (event.target === editor) queue(); }, true);
  document.addEventListener('compositionstart', event => { if (event.target === editor) { composing = true; invalidate('Composing…'); render(); } }, true);
  document.addEventListener('compositionend', event => { if (event.target === editor) { composing = false; observedText = E.text(editor); invalidate(); render(); queue(); } }, true);
  document.addEventListener('selectionchange', () => {
    if (editor && document.activeElement === editor && !applying) {
      if (!E.atEnd(editor)) { invalidate(); render(); } else if (!suggestion && !pending) queue();
    }
  });
  document.addEventListener('keydown', event => {
    if (event.target !== editor || event.isComposing || composing) return;
    if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && inlineSuggestion() && E.atEnd(editor) && matching(suggestion.snapshot)) {
      event.preventDefault(); event.stopImmediatePropagation(); accept();
    } else if (event.key === 'Escape') { if (view) closeHistory(); else dismiss(); }
    else if (event.key === 'Enter') { dismissed = E.text(editor); invalidate(); render(); }
  }, true);
  shadow.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); if (view) closeHistory(); else dismiss(); editor?.focus({ preventScroll: true }); }
    if (suggestion?.result.type !== 'multiple_choice' || view || event.altKey || event.ctrlKey || event.metaKey) return;
    const options = suggestion.result.options, index = options.findIndex(option => option.id === selectedChoice?.id);
    if (selectedChoice && event.target.getAttribute('role') === 'radio' && (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey))) { event.preventDefault(); accept(); return; }
    let next = -1;
    if (/^[1-6]$/.test(event.key)) next = Number(event.key) - 1;
    else if (event.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (event.key === 'ArrowUp') next = (index + options.length - 1) % options.length;
    if (next >= 0 && next < options.length) { event.preventDefault(); selectedChoice = options[next]; render(); shadow.querySelector(`[data-option="${next}"]`)?.focus(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { invalidate(); render(); } });
  addEventListener('popstate', scheduleSync);
  addEventListener('resize', position);
  addEventListener('scroll', position, true);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.enabled) { enabled = changes.enabled.newValue === true; invalidate(); render(); queue(); }
  });
  addEventListener('pagehide', () => { invalidate(); observer.disconnect(); resize.disconnect(); alive = false; host.remove(); });
  addEventListener('pageshow', event => {
    if (!event.persisted || alive) return;
    alive = true; enabled = false; editor = null; view = null; viewEpoch++;
    document.body.append(host);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    resize.observe(panel);
    sync();
    const restoredRevision = revision;
    send({ type: 'settings' }).then(value => {
      const editedWhileLoading = revision !== restoredRevision;
      enabled = value.enabled === true; invalidate(); sync();
      if (editedWhileLoading) queue();
    }).catch(error => { status = errorText(error); render(); });
  });
  send({ type: 'settings' }).then(value => { enabled = value.enabled === true; invalidate(); sync(); }).catch(error => { status = errorText(error); sync(); });
})();
