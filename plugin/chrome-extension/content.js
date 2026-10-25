(() => {
  const ID = 'prompt-enhance-extension';
  if (document.getElementById(ID)) return;
  const host = document.createElement('div');
  host.id = ID;
  const root = host.attachShadow({mode: 'open'});
  root.innerHTML = `<style>
    :host{all:initial;display:block;width:100%;font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;--pe-bg:#fff;--pe-ink:#0d0d0d;--pe-muted:#6b6b6b;--pe-border:#e5e5e5;--pe-hover:#f5f5f5}
    :host([data-theme=dark]){--pe-bg:#212121;--pe-ink:#ececec;--pe-muted:#b4b4b4;--pe-border:#424242;--pe-hover:#303030;color-scheme:dark}
    *{box-sizing:border-box}button{font:inherit;cursor:pointer;color:var(--pe-ink)}
    .dock{display:flex;align-items:center;justify-content:center;gap:10px;padding:8px 2px 0;min-height:44px}
    .launch{display:inline-flex;align-items:center;gap:7px;min-height:36px;padding:7px 12px;font-size:13px;font-weight:500;background:var(--pe-bg);border:1px solid var(--pe-border);border-radius:999px;transition:background 120ms ease-out}
    .launch:hover,.launch[aria-expanded=true]{background:var(--pe-hover)}.launch:focus-visible,.fallback-close:focus-visible{outline:2px solid var(--pe-ink);outline-offset:3px}
    svg{width:16px;height:16px;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
    #notice{font-size:12px;line-height:18px;color:var(--pe-muted);overflow-wrap:anywhere;max-width:420px}#notice:empty{display:none}
    #workspace-dialog{position:fixed;z-index:2147483000;right:24px;top:72px;width:min(820px,calc(100vw - 48px));height:min(800px,calc(100dvh - 96px));border:1px solid var(--pe-border);border-radius:22px;overflow:clip;background:var(--pe-bg);box-shadow:0 16px 56px -16px #0003;animation:enter 150ms cubic-bezier(.2,0,0,1)}
    #workspace-dialog[hidden]{display:none}#workspace-dialog.expanded{inset:24px;width:auto;height:auto}
    .workspace-root{display:block;width:100%;height:100%;background:var(--pe-bg)}
    .loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:16px;background:var(--pe-bg);color:var(--pe-muted);font-size:14px}
    .fallback-close{border:1px solid var(--pe-border);background:var(--pe-bg);border-radius:999px;padding:7px 12px;min-height:36px}
    @keyframes enter{from{transform:translateY(5px);opacity:.85}to{transform:none;opacity:1}}
    @media(prefers-reduced-motion:reduce){#workspace-dialog{animation:none}.launch{transition:none}}
    @media(max-width:600px){.dock{padding-top:6px}#workspace-dialog,#workspace-dialog.expanded{inset:56px 8px 8px;width:auto;height:auto;border-radius:18px}.launch{min-height:40px}}
  </style><div class="dock"><span id="notice" role="status" aria-live="polite"></span><button id="open-workspace" class="launch" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="workspace-dialog"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 3 5 5-12 12H4v-5Z"/><path d="m13 6 5 5M4 4h4M6 2v4"/></svg>Skill Issue</button></div><section id="workspace-dialog" role="dialog" aria-modal="false" aria-label="Prompt Enhance workspace" hidden></section>`;
  const launch = root.getElementById('open-workspace');
  const dialog = root.getElementById('workspace-dialog');
  const notice = root.getElementById('notice');
  let editor = null, workspace = null, nativeAutocomplete = null, base = '';
  const read = () => editor ? (editor instanceof HTMLTextAreaElement ? editor.value : editor.innerText).replace(/\u200b/g, '').replace(/\n$/, '') : '';
  function theme() {
    const html = document.documentElement;
    const dark = html.classList.contains('dark') || html.dataset.theme === 'dark' || getComputedStyle(html).colorScheme === 'dark';
    host.dataset.theme = dark ? 'dark' : 'light';
    return dark ? 'dark' : 'light';
  }
  function close() {
    workspace?.unmount(); workspace = null;
    dialog.replaceChildren(); dialog.hidden = true;
    launch.setAttribute('aria-expanded','false'); launch.focus(); nativeAutocomplete?.refresh();
  }
  function open() {
    if (!dialog.hidden) return;
    if (!editor?.isConnected) {notice.textContent = 'Click the ChatGPT composer, then try again.'; return;}
    notice.textContent = ''; base = read(); nativeAutocomplete?.dismiss();
    dialog.hidden = false; launch.setAttribute('aria-expanded','true');
    const container = document.createElement('div'); container.className = 'workspace-root';
    dialog.append(container);
    try {
      if (!globalThis.PromptEnhanceWorkspace?.mountWorkspace) throw new Error('Build the extension and reload it in Chrome.');
      workspace = globalThis.PromptEnhanceWorkspace.mountWorkspace(container, {
        prompt: base, theme: theme(),
        onApply: async text => write(text),
        onClose: close,
      });
    } catch (error) {
      dialog.replaceChildren();
      const loading = document.createElement('div'); loading.className = 'loading';
      const text = document.createElement('span'); text.setAttribute('role','alert'); text.textContent = error.message || 'Workspace could not open.';
      const cancel = document.createElement('button'); cancel.className = 'fallback-close'; cancel.textContent = 'Close'; cancel.addEventListener('click',close);
      loading.append(text,cancel);dialog.append(loading);
    }
  }
  function write(text) {
    if (typeof text !== 'string' || text.length > 12000) throw new Error('Use a draft under 12,000 characters.');
    if (!editor?.isConnected || read() !== base) {
      notice.textContent = 'Your ChatGPT draft changed. Reopen Prompt Enhance to use the current draft.';
      throw new Error(notice.textContent);
    }
    editor.focus();
    let ok = true;
    if (editor instanceof HTMLTextAreaElement) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(editor,text);
      editor.dispatchEvent(new Event('input',{bubbles:true}));
    } else {
      const selection = window.getSelection(), range = document.createRange(); range.selectNodeContents(editor);
      selection.removeAllRanges(); selection.addRange(range);
      ok = document.execCommand('insertText',false,text);
    }
    if (!ok) throw new Error('Could not update ChatGPT. Copy your refined draft instead.');
    base = text;
    setTimeout(() => {close();editor?.focus();notice.textContent='';},0);
  }
  launch.addEventListener('click',() => dialog.hidden ? open() : close());
  document.addEventListener('keydown',event => {if(event.key === 'Escape' && !dialog.hidden && !event.isComposing && !event.defaultPrevented && !event.composedPath().includes(dialog)){close();}});
  chrome.runtime.onMessage.addListener((message,sender,respond) => {
    if (sender.id === chrome.runtime.id && message?.type === 'open-workspace') {open();respond({ok:!dialog.hidden});}
  });
  function attach() {
    const next = document.querySelector('#prompt-textarea[contenteditable="true"], textarea#prompt-textarea, [data-composer-markdown][contenteditable="true"], [data-composer-input] [contenteditable="true"], form [contenteditable="true"][data-lexical-editor="true"]');
    if (!next) {nativeAutocomplete?.dispose();nativeAutocomplete=null;host.remove(); if(!dialog.hidden) close(); editor=null; return;}
    if (next === editor && host.isConnected) return;
    if (editor && editor !== next && !dialog.hidden) close();
    nativeAutocomplete?.dispose();
    editor = next;
    nativeAutocomplete = globalThis.SkillIssueAutocomplete?.attach(editor,{isWorkspaceOpen:() => !dialog.hidden});
    const anchor = editor.closest('form') || editor.closest('[data-composer-body]')?.parentElement || editor.parentElement;
    anchor.insertAdjacentElement('afterend',host); theme();
  }
  new MutationObserver(attach).observe(document.body,{childList:true,subtree:true});
  new MutationObserver(() => {const value=theme();workspace?.setTheme(value);}).observe(document.documentElement,{attributes:true,attributeFilter:['class','data-theme','style']});
  attach();
})();
