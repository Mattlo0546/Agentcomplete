/* global PromptEnhanceEditor */
(() => {
  'use strict';
  const typography = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariant', 'letterSpacing', 'wordSpacing', 'textTransform', 'tabSize', 'direction'];
  const number = value => parseFloat(value) || 0;
  function create(parent, accept) {
    const layer = document.createElement('div'); layer.className = 'ghost-layer'; layer.hidden = true;
    const prefix = document.createElement('span'); prefix.className = 'ghost-prefix'; prefix.setAttribute('aria-hidden', 'true');
    const suffix = document.createElement('span'); suffix.className = 'ghost-text'; suffix.setAttribute('aria-hidden', 'true');
    const hint = document.createElement('button'); hint.className = 'tab-hint'; hint.textContent = 'Tab'; hint.type = 'button'; hint.tabIndex = -1;
    hint.setAttribute('aria-label', 'Accept suggestion'); hint.title = 'Accept suggestion · Tab';
    hint.addEventListener('mousedown', event => event.preventDefault()); hint.addEventListener('click', accept);
    layer.append(prefix, suffix, hint); parent.append(layer);
    let target = null, baseHeight = 0, latest = '', positioning = false, replacement = false;
    const overrides = [];
    function override(element, property, value) {
      let entry = overrides.find(item => item.element === element && item.property === property);
      if (!entry) {
        entry = { element, property, original: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) };
        overrides.push(entry);
      }
      entry.owned = value;
      if (element.style.getPropertyValue(property) !== value || element.style.getPropertyPriority(property) !== 'important') element.style.setProperty(property, value, 'important');
    }
    function clear() {
      layer.hidden = true; latest = '';
      for (const { element, property, original, priority, owned } of overrides.splice(0)) {
        if (element.style.getPropertyValue(property) === owned && element.style.getPropertyPriority(property) === 'important') {
          if (original) element.style.setProperty(property, original, priority); else element.style.removeProperty(property);
        }
      }
      target = null; replacement = false;
    }
    function caret(editor) {
      if (editor instanceof HTMLTextAreaElement) return null;
      const selection = getSelection();
      let range;
      if (selection?.rangeCount && selection.isCollapsed && editor.contains(selection.anchorNode)) range = selection.getRangeAt(0).cloneRange();
      else { range = document.createRange(); range.selectNodeContents(editor); range.collapse(false); }
      let rect = [...range.getClientRects()].at(-1);
      let element = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
      if (!rect?.height) {
        let last = editor;
        while (last.lastChild) last = last.lastChild;
        range = document.createRange();
        if (last.nodeType === Node.TEXT_NODE && last.length) {
          range.setStart(last, last.length - 1); range.setEnd(last, last.length);
          const end = range.getBoundingClientRect();
          const rtl = getComputedStyle(last.parentElement).direction === 'rtl';
          rect = { left: rtl ? end.left : end.right, right: rtl ? end.left : end.right, top: end.top, height: end.height };
        } else { range.selectNode(last); rect = range.getBoundingClientRect(); }
        element = last.nodeType === Node.ELEMENT_NODE ? last : last.parentElement;
      }
      return rect?.height ? { rect, style: getComputedStyle(element) } : null;
    }
    function position() {
      if (!target || !latest || positioning) return;
      if (!target.isConnected || PromptEnhanceEditor.find() !== target) { clear(); return; }
      positioning = true;
      try {
        const bounds = target.getBoundingClientRect(), computed = getComputedStyle(target);
        const insetLeft = number(computed.borderLeftWidth) + number(computed.paddingLeft);
        const insetRight = number(computed.borderRightWidth) + number(computed.paddingRight);
        const contentLeft = bounds.left + insetLeft, width = bounds.width - insetLeft - insetRight;
        const point = caret(target);
        const font = point?.style || computed;
        for (const name of typography) layer.style[name] = font[name];
        const lineHeight = number(font.lineHeight) || number(font.fontSize) * 1.5;
        layer.style.lineHeight = `${lineHeight}px`;
        layer.style.width = `${Math.max(1, width)}px`;
        layer.style.left = `${contentLeft}px`;
        layer.style.clipPath = '';
        layer.hidden = false;
        let top;
        if (replacement) {
          prefix.style.cssText = 'display:none'; prefix.textContent = '';
          top = bounds.top + number(computed.borderTopWidth) + number(computed.paddingTop) - target.scrollTop;
        } else if (target instanceof HTMLTextAreaElement) {
          // The textarea's transparent mirror follows the same wrapping and scroll.
          prefix.style.cssText = 'display:inline'; prefix.textContent = target.value;
          top = bounds.top + number(computed.borderTopWidth) + number(computed.paddingTop) - target.scrollTop;
        } else if (point) {
          prefix.textContent = '';
          const advance = font.direction === 'rtl' ? contentLeft + width - point.rect.right : point.rect.left - contentLeft;
          prefix.style.cssText = `display:inline-block;width:${Math.max(0, Math.min(width, advance))}px;height:0`;
          top = point.rect.top - (lineHeight - point.rect.height) / 2;
        } else { layer.hidden = true; return; }
        layer.style.top = `${top}px`;
        const height = layer.getBoundingClientRect().height;
        // Reserve display space by changing only the editor's box. No ghost text,
        // nodes or attributes are inserted into ProseMirror's document.
        const required = top - bounds.top + target.scrollTop + height + number(computed.paddingBottom) + number(computed.borderBottomWidth);
        const minHeight = Math.ceil(Math.max(baseHeight, Math.min(required, innerHeight * 0.45)));
        const cssHeight = computed.boxSizing === 'border-box' ? minHeight : minHeight - number(computed.paddingTop) - number(computed.paddingBottom) - number(computed.borderTopWidth) - number(computed.borderBottomWidth);
        override(target, 'min-height', `${Math.max(0, cssHeight)}px`);
        // ChatGPT's single-line wrapper fixes its height to one line and applies
        // !important min-height:0 to the editor. Reserve space in BOTH boxes,
        // preserving each inline value and priority for dismissal/acceptance.
        const wrapper = target.closest('[data-composer-input-layout], [data-rich-text-layout]');
        if (wrapper && wrapper !== target) override(wrapper, 'min-height', `${minHeight}px`);
        // Respect editor/ancestor scroll clipping; never draw over message text or
        // the composer's send controls when the draft is scrolled out of view.
        let clipTop = 0, clipBottom = innerHeight;
        for (let ancestor = target; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
            const rect = ancestor.getBoundingClientRect();
            clipTop = Math.max(clipTop, rect.top); clipBottom = Math.min(clipBottom, rect.bottom);
          }
        }
        layer.style.clipPath = `inset(${Math.max(0, clipTop - top)}px 0 ${Math.max(0, top + height - clipBottom)}px 0)`;
        layer.hidden = bounds.bottom <= 0 || bounds.top >= innerHeight || width < 20;
      } finally { positioning = false; }
    }
    function update(editor, text, replace = false) {
      if (!editor || !text) { clear(); return; }
      if (editor !== target || replace !== replacement) {
        clear(); target = editor; replacement = replace;
        baseHeight = editor.getBoundingClientRect().height;
      }
      // For a correction within the draft, preview the proposed text in place.
      // Keep the real document and undo history untouched until explicit accept.
      if (replacement) override(editor, '-webkit-text-fill-color', 'transparent');
      latest = text; suffix.textContent = text; position();
    }
    return Object.freeze({ update, position, clear });
  }
  globalThis.PromptEnhanceGhost = Object.freeze({ create });
})();
