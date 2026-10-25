(() => {
  const ROOT_ID = 'skill-issue-native-ghost';
  const api = (path, body) => chrome.runtime.sendMessage({type: 'api', path, method: body ? 'POST' : 'GET', ...(body ? {body} : {})});
  const requestId = () => `native_${crypto.randomUUID().replaceAll('-', '')}`;

  function attach(editor, {isWorkspaceOpen = () => false, onError} = {}) {
    const shared = globalThis.PromptEnhanceWorkspace;
    if (!shared?.createNativeStateController) throw new Error('Build the shared frontend before attaching native autocomplete.');
    const existing = document.getElementById(ROOT_ID);
    existing?.remove();
    const overlay = document.createElement('div');
    overlay.id = ROOT_ID;
    overlay.setAttribute('aria-hidden', 'false');
    overlay.style.cssText = 'position:fixed;z-index:2147482000;pointer-events:none;display:none;overflow:hidden;contain:layout paint;';
    const shadow = overlay.attachShadow({mode: 'open'});
    shadow.innerHTML = `<style>
      :host{all:initial}*{box-sizing:border-box}.ghost{color:#858585;white-space:pre-wrap;overflow-wrap:break-word;pointer-events:none;padding-right:34px}
      .tab{position:absolute;right:0;top:1px;padding:0 5px;border:1px solid #a4a4a4;border-radius:4px;color:#737373;background:#fff;font:11px/18px ui-sans-serif,system-ui,sans-serif;white-space:nowrap}
      .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    </style><span class="ghost" data-testid="native-ghost-text" aria-hidden="true"></span><kbd class="tab" aria-hidden="true">Tab</kbd><span class="sr-only" role="status" aria-live="polite"></span>`;
    const ghost = shadow.querySelector('.ghost');
    const hint = shadow.querySelector('.tab');
    const live = shadow.querySelector('[role="status"]');
    document.body.append(overlay);
    let disposed = false, composing = false, timer = 0, frame = 0, pending = false;
    let delay = 1200, enabled = true, lastRequested = '', busyRetries = 0, previousRequestId = null;
    let dismissedDraft = null, lastInputAt = 0, configurationKey = null;
    const read = () => (editor instanceof HTMLTextAreaElement ? editor.value : editor.innerText)
      .replace(/\u200b/g, '').replace(/\n$/, '');
    const core = shared.createNativeStateController(read());
    const focused = () => document.activeElement === editor || editor.contains(document.activeElement);
    const endSelection = () => {
      if (editor instanceof HTMLTextAreaElement) return editor.selectionStart === editor.value.length && editor.selectionEnd === editor.value.length;
      const selection = window.getSelection();
      if (!selection?.isCollapsed || !editor.contains(selection.anchorNode)) return false;
      const after = document.createRange();
      after.selectNodeContents(editor);
      try { after.setStart(selection.anchorNode, selection.anchorOffset); } catch { return false; }
      return after.toString().replace(/\u200b/g, '').length === 0;
    };
    function offsets() {
      const length = read().length;
      if (editor instanceof HTMLTextAreaElement) return {selectionStart: editor.selectionStart, selectionEnd: editor.selectionEnd};
      if (endSelection()) return {selectionStart: length, selectionEnd: length};
      const selection = window.getSelection();
      if (!selection?.rangeCount || !editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode)) return null;
      const selected = selection.getRangeAt(0), before = document.createRange();
      before.selectNodeContents(editor); before.setEnd(selected.startContainer, selected.startOffset);
      const start = Math.min(length, before.toString().replace(/\u200b/g, '').length);
      before.setEnd(selected.endContainer, selected.endOffset);
      return {selectionStart: start, selectionEnd: Math.min(length, before.toString().replace(/\u200b/g, '').length)};
    }
    function syncSelection() {
      const selection = offsets();
      if (!selection) { core.dispatch({type: 'cancel'}); return; }
      const before = core.state;
      const after = core.dispatch({type: 'change', prompt: read(), ...selection});
      if (after !== before) lastRequested = '';
    }
    const eligible = () => !disposed && editor.isConnected && enabled && !composing && !isWorkspaceOpen() && focused() && endSelection() && read().trim().length >= 3 && read().length <= 12000;
    // The native editor is normally a single-line box. Reserve real space for
    // its complete uncommitted suffix instead of shortening the shared result.
    const reservedStyles = new Map();
    let baseLayout = null;
    function ownedStyle(node, property, value) {
      if (!node) return;
      let properties = reservedStyles.get(node);
      if (!properties) { properties = new Map(); reservedStyles.set(node, properties); }
      let saved = properties.get(property);
      if (!saved) {
        saved = {value: node.style.getPropertyValue(property), priority: node.style.getPropertyPriority(property), owned: null};
        properties.set(property, saved);
      }
      if (node.style.getPropertyValue(property) !== value || node.style.getPropertyPriority(property) !== 'important') node.style.setProperty(property, value, 'important');
      saved.owned = node.style.getPropertyValue(property);
    }
    function restoreLayout() {
      for (const [node, properties] of reservedStyles) {
        for (const [property, saved] of properties) {
          // Do not overwrite a value subsequently changed by ChatGPT/React.
          if (node.style.getPropertyValue(property) !== saved.owned || node.style.getPropertyPriority(property) !== 'important') continue;
          if (saved.value) node.style.setProperty(property, saved.value, saved.priority);
          else node.style.removeProperty(property);
        }
      }
      reservedStyles.clear();
      if (baseLayout && editor.scrollTop === baseLayout.ownedScrollTop) editor.scrollTop = baseLayout.scrollTop;
      baseLayout = null;
    }
    function reserveLayout(requiredHeight, suffixHeight, lineHeight) {
      const style = getComputedStyle(editor);
      const wrapper = editor.closest('[data-composer-input-layout], [data-rich-text-layout]') || editor;
      const footer = editor.closest('[data-composer-footer-responsive]');
      const body = editor.closest('[data-composer-body]');
      if (!baseLayout) {
        const bodyHeight = body?.getBoundingClientRect().height || Infinity;
        const footerHeight = footer?.getBoundingClientRect().height || bodyHeight;
        const radiusLimit = Math.min(bodyHeight, footerHeight) / 2;
        const bodyStyle = body ? getComputedStyle(body) : null;
        const bodyRadii = bodyStyle ? ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'].map(property => [
          property,
          bodyStyle.getPropertyValue(property).split(/\s+/).map(value => {
            const radius = Number.parseFloat(value);
            return `${Math.min(Number.isFinite(radius) ? radius : radiusLimit, radiusLimit)}px`;
          }).join(' '),
        ]) : [];
        baseLayout = {
          height: editor.getBoundingClientRect().height,
          bodyRadii,
          wrapperHeight: wrapper.getBoundingClientRect().height,
          paddingBottom: Number.parseFloat(style.paddingBottom) || 0,
          scrollTop: editor.scrollTop,
          ownedScrollTop: editor.scrollTop,
        };
      }
      const viewportLimit = Math.max(lineHeight * 3, Math.min(680, window.innerHeight - 120));
      const height = Math.min(Math.max(requiredHeight, baseLayout.height), viewportLimit);
      for (const [property, value] of baseLayout.bodyRadii) ownedStyle(body, property, value);
      ownedStyle(wrapper, 'height', `${height}px`);
      ownedStyle(wrapper, 'min-height', `${height}px`);
      ownedStyle(wrapper, 'max-height', 'none');
      ownedStyle(wrapper, 'overflow', 'visible');
      ownedStyle(editor, 'height', `${height}px`);
      ownedStyle(editor, 'min-height', `${height}px`);
      ownedStyle(editor, 'max-height', `${height}px`);
      ownedStyle(editor, 'box-sizing', 'border-box');
      ownedStyle(editor, 'overflow-y', 'auto');
      ownedStyle(editor, 'padding-bottom', `${baseLayout.paddingBottom + Math.max(0, suffixHeight - lineHeight)}px`);
      if (footer) {
        ownedStyle(footer, 'align-items', 'end');
        let cell = editor.closest('[data-composer-input]') || wrapper;
        while (cell.parentElement && cell.parentElement !== footer) cell = cell.parentElement;
        if (cell.parentElement === footer) ownedStyle(cell, 'align-self', 'start');
      }
      // A long existing draft may already scroll. Padding reserves the suffix
      // after its caret; scroll that reservation into the editor's viewport.
      if (editor.scrollHeight > editor.clientHeight + 1) {
        editor.scrollTop = Math.max(0, editor.scrollHeight - editor.clientHeight);
        baseLayout.ownedScrollTop = editor.scrollTop;
      }
      return height;
    }
    function hide() {
      overlay.style.display = 'none';
      ghost.textContent = '';
      live.textContent = '';
      restoreLayout();
    }
    function dismiss() {
      clearTimeout(timer); timer = 0;
      dismissedDraft = read(); core.dispatch({type: 'dismiss'});
      hide();
    }
    function caretRect() {
      if (editor instanceof HTMLTextAreaElement) {
        // Native textareas need a mirror for caret metrics; this mirror never enters the editor.
        const style = getComputedStyle(editor), rect = editor.getBoundingClientRect();
        const mirror = document.createElement('div');
        mirror.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;white-space:pre-wrap;overflow-wrap:break-word;';
        for (const name of ['font', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'padding', 'border', 'boxSizing', 'tabSize']) mirror.style[name] = style[name];
        mirror.style.width = `${rect.width}px`; mirror.style.left = `${rect.left}px`; mirror.style.top = `${rect.top - editor.scrollTop}px`;
        mirror.textContent = editor.value;
        const marker = document.createElement('span'); marker.textContent = '\u200b'; mirror.append(marker);
        document.body.append(mirror); const result = marker.getBoundingClientRect(); mirror.remove(); return result;
      }
      const selection = window.getSelection();
      if (!selection?.rangeCount) return null;
      const range = selection.getRangeAt(0).cloneRange();
      const rect = range.getClientRects()[0] || range.getBoundingClientRect();
      if (rect.height) return rect;
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      let text, last;
      while ((text = walker.nextNode())) if (text.nodeValue.length) last = text;
      if (!last) return null;
      range.setStart(last, Math.max(0, last.length - 1)); range.setEnd(last, last.length);
      const end = range.getBoundingClientRect();
      return {left: end.right, right: end.right, top: end.top, bottom: end.bottom, height: end.height};
    }
    function position() {
      frame = 0;
      const text = core.ghostText();
      if (!text || core.state.prompt !== read() || !eligible()) { hide(); return; }
      let rect = editor.getBoundingClientRect(), caret = caretRect();
      const style = getComputedStyle(editor);
      if (!caret || rect.width < 40 || rect.height < 1 || caret.top < rect.top - 2 || caret.top >= rect.bottom) { hide(); return; }
      const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5;
      const lineTop = Math.max(rect.top, caret.top - Math.max(0, (lineHeight - caret.height) / 2));
      let left = rect.left + (Number.parseFloat(style.paddingLeft) || 0);
      let width = rect.right - left - (Number.parseFloat(style.paddingRight) || 0);
      for (const name of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'letterSpacing', 'wordSpacing', 'textTransform', 'direction', 'tabSize']) ghost.style[name] = style[name];
      ghost.style.display = 'block'; ghost.style.lineHeight = `${lineHeight}px`;
      ghost.style.textIndent = `${Math.max(0, caret.left - left)}px`;
      ghost.textContent = text;
      overlay.style.left = `${left}px`; overlay.style.top = `${lineTop}px`;
      overlay.style.width = `${width}px`; overlay.style.height = 'auto';
      overlay.style.display = 'block';
      const suffixHeight = Math.max(lineHeight, ghost.getBoundingClientRect().height);
      const requiredHeight = lineTop - rect.top + suffixHeight;
      reserveLayout(requiredHeight, suffixHeight, lineHeight);
      // Expanding a bottom-anchored composer moves its top and caret. Measure
      // again after layout so the ghost follows its actual, unchanged text.
      rect = editor.getBoundingClientRect(); caret = caretRect();
      if (!caret) {hide();return;}
      const top = Math.max(rect.top, caret.top - Math.max(0, (lineHeight - caret.height) / 2));
      left = rect.left + (Number.parseFloat(style.paddingLeft) || 0);
      width = rect.right - left - (Number.parseFloat(style.paddingRight) || 0);
      overlay.style.left = `${left}px`; overlay.style.top = `${top}px`;
      overlay.style.width = `${width}px`; overlay.style.height = `${suffixHeight}px`;
      ghost.style.textIndent = `${Math.max(0, caret.left - left)}px`;
      const dark = document.documentElement.classList.contains('dark') || getComputedStyle(document.documentElement).colorScheme === 'dark';
      ghost.style.color = dark ? '#a3a3a3' : '#858585';
      hint.style.color = dark ? '#b4b4b4' : '#737373'; hint.style.background = dark ? '#303030' : '#fff';
      hint.style.borderColor = dark ? '#5b5b5b' : '#b4b4b4';
      hint.style.top = `${Math.max(1, suffixHeight - lineHeight + (lineHeight - 20) / 2)}px`;
      live.textContent = `Suggestion: ${text}. Press Tab to accept the entire suggestion, or Escape to dismiss.`;
    }
    const reposition = () => { if (!frame) frame = requestAnimationFrame(position); };
    function schedule(wait = delay) {
      clearTimeout(timer); timer = 0;
      if (!eligible() || read() === dismissedDraft) { hide(); return; }
      syncSelection();
      if (core.ghostText()) {reposition(); return;}
      if (lastRequested === read()) return;
      timer = setTimeout(request, wait);
    }
    async function request() {
      timer = 0;
      if (!eligible() || read() === dismissedDraft || pending) return;
      syncSelection();
      const state = core.state;
      const snapshot = {requestId: requestId(), revision: state.revision, prompt: state.prompt, cursor: state.selectionEnd};
      const startedAt = Date.now();
      core.dispatch({type: 'request', snapshot});
      pending = true; lastRequested = snapshot.prompt;
      try {
        const result = await api('/v1/enhance', {
          request_id: snapshot.requestId, prompt: snapshot.prompt, prompt_revision: snapshot.revision,
          cursor: snapshot.cursor, autocomplete_only: true,
          ...(previousRequestId ? {previous_request_id: previousRequestId} : {}),
        });
        if (disposed) return;
        if (result?.status === 429 && result.data?.error?.code === 'busy' && busyRetries < 3 && read() === snapshot.prompt && eligible()) {
          core.dispatch({type: 'failure', requestId: snapshot.requestId, error: {status: 429, message: 'Bridge busy'}});
          busyRetries++; lastRequested = '';
          timer = setTimeout(request, 750 * 2 ** (busyRetries - 1)); return;
        }
        if (!result || result.status < 200 || result.status >= 300) throw new Error(result?.data?.error?.message || 'Suggestion unavailable.');
        const response = result.data;
        if (!response || response.request_id !== snapshot.requestId || response.prompt_revision !== snapshot.revision) return;
        busyRetries = 0;
        const before = core.state;
        if (before.retained?.requestId === snapshot.requestId) {
          core.dispatch(Date.now() - startedAt <= shared.MAX_SALVAGE_AGE_MS
            ? {type: 'retainedResponse', requestId: snapshot.requestId, response, now: Date.now()}
            : {type: 'discardRetained'});
        } else {
          core.dispatch({type: 'response', response, now: Date.now()});
        }
        const after = core.state;
        if (after !== before && after.traceId === snapshot.requestId && !after.pending && !after.error) previousRequestId = snapshot.requestId;
        if (core.ghostText() && eligible()) {clearTimeout(timer);timer = 0;reposition();}
      } catch (error) {
        core.dispatch({type: 'failure', requestId: snapshot.requestId, error: {status: 0, message: error.message || 'Suggestion unavailable.'}});
        if (!disposed) onError?.(error);
      } finally {
        pending = false;
        if (!disposed && !timer && lastRequested !== read() && eligible() && !core.ghostText()) schedule(Math.max(0, delay - (Date.now() - lastInputAt)));
      }
    }
    function input(event) {
      busyRetries = 0; lastInputAt = Date.now(); dismissedDraft = null;
      const selection = offsets() || {selectionStart: read().length, selectionEnd: read().length};
      core.dispatch({type: 'change', prompt: read(), ...selection, retainInFlight: enabled && !composing && event?.inputType === 'insertText'});
      hide();
      if (core.ghostText() && eligible()) {clearTimeout(timer);timer = 0;reposition();}
      else schedule();
    }
    function selection() {
      syncSelection();
      if (!eligible()) {hide();clearTimeout(timer);timer = 0;return;}
      if (core.ghostText()) reposition();
      else schedule();
    }
    function keydown(event) {
      if (event.isComposing || composing) return;
      if (event.key === 'Escape' && core.ghostText()) { event.preventDefault(); event.stopPropagation(); dismiss(); return; }
      if (event.key !== 'Tab' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || !core.ghostText() || overlay.style.display === 'none' || !eligible() || core.state.prompt !== read()) return;
      const text = core.ghostText();
      event.preventDefault(); event.stopImmediatePropagation();
      clearTimeout(timer);timer = 0;hide();
      core.dispatch({type: 'acceptGhost'});
      if (editor instanceof HTMLTextAreaElement) {
        const next = editor.value + text;
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(editor, next);
        editor.setSelectionRange(next.length, next.length);
        editor.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: text}));
      } else if (!document.execCommand('insertText', false, text)) {
        onError?.(new Error('Could not insert the suggestion.')); return;
      }
      // Acceptance starts another quiet period; it does not submit ChatGPT's message.
      input({inputType: 'insertText'});
    }
    const startComposition = () => { composing = true; core.dispatch({type: 'cancel'}); clearTimeout(timer); hide(); };
    const endComposition = () => { composing = false; input(); };
    const blur = () => { clearTimeout(timer); core.dispatch({type: 'cancel'}); lastRequested = ''; hide(); };
    const focus = () => schedule();
    editor.addEventListener('input', input);
    editor.addEventListener('keydown', keydown, true);
    editor.addEventListener('compositionstart', startComposition);
    editor.addEventListener('compositionend', endComposition);
    editor.addEventListener('blur', blur);
    editor.addEventListener('focus', focus);
    document.addEventListener('selectionchange', selection);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(reposition) : null;
    resize?.observe(editor);
    const storageChange = (_changes, area) => { if (area === 'local') loadSettings(); };
    chrome.storage?.onChanged?.addListener(storageChange);
    async function loadSettings() {
      try {
        const response = await api('/v1/settings');
        if (disposed || response?.status !== 200) return;
        const nextKey = JSON.stringify(response.data);
        if (configurationKey !== null && configurationKey !== nextKey) {core.dispatch({type: 'cancel'});lastRequested = '';hide();}
        configurationKey = nextKey;
        enabled = response.data?.autocomplete_enabled !== false;
        const ms = response.data?.trigger_delay_ms;
        if (Number.isFinite(ms)) delay = Math.max(0, Math.min(10000, ms));
        schedule();
      } catch { /* Existing quiet defaults remain available. */ }
    }
    loadSettings();
    return {
      dismiss,
      refresh() { core.dispatch({type: 'change', prompt: read(), ...(offsets() || {selectionStart: read().length, selectionEnd: read().length})}); previousRequestId = null; lastRequested = ''; dismissedDraft = null; hide(); loadSettings(); },
      dispose() {
        disposed = true; core.dispatch({type: 'cancel'}); clearTimeout(timer); cancelAnimationFrame(frame); resize?.disconnect(); restoreLayout(); overlay.remove();
        editor.removeEventListener('input', input); editor.removeEventListener('keydown', keydown, true);
        editor.removeEventListener('compositionstart', startComposition); editor.removeEventListener('compositionend', endComposition);
        editor.removeEventListener('blur', blur); editor.removeEventListener('focus', focus);
        document.removeEventListener('selectionchange', selection); window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true);
        chrome.storage?.onChanged?.removeListener?.(storageChange);
      },
    };
  }
  globalThis.SkillIssueAutocomplete = {attach};
})();
