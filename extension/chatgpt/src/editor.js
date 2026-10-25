(() => {
  'use strict';
  const selectors = '[data-composer-markdown][contenteditable="true"][role="textbox"], #prompt-textarea[contenteditable="true"], textarea#prompt-textarea';
  function find() {
    const editors = [...document.querySelectorAll(selectors)].filter(el => el.getClientRects().length && !el.closest('[hidden], [aria-hidden="true"]') && !el.disabled);
    return editors.length === 1 ? editors[0] : null;
  }
  function text(editor) {
    if (editor instanceof HTMLTextAreaElement) return editor.value;
    return editor.innerText.replace(/\r\n/g, '\n').replace(/\n$/, editor.lastElementChild?.matches('p:has(> br.ProseMirror-trailingBreak:only-child)') ? '' : '\n');
  }
  function atEnd(editor) {
    if (document.activeElement !== editor) return false;
    if (editor instanceof HTMLTextAreaElement) return editor.selectionStart === editor.value.length && editor.selectionEnd === editor.value.length;
    const selection = window.getSelection();
    if (!selection?.isCollapsed || !selection.rangeCount || !editor.contains(selection.anchorNode)) return false;
    const after = selection.getRangeAt(0).cloneRange();
    after.setEnd(editor, editor.childNodes.length);
    return !after.toString() && !after.cloneContents().querySelector('[contenteditable="false"], img');
  }
  function write(editor, expected, value, append) {
    if (!editor?.isConnected || find() !== editor || text(editor) !== expected) return false;
    if (editor.querySelector('[contenteditable="false"], img, table')) return false;
    editor.focus({ preventScroll: true });
    if (editor instanceof HTMLTextAreaElement) {
      editor.setSelectionRange(append ? editor.value.length : 0, editor.value.length);
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(editor, append ? expected + value : value);
      editor.setSelectionRange(editor.value.length, editor.value.length);
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    } else {
      const range = document.createRange(); range.selectNodeContents(editor);
      if (append) range.collapse(false);
      const selection = window.getSelection();
      const previous = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
      selection.removeAllRanges(); selection.addRange(range);
      // Enters Chromium's normal editing/undo path, including ProseMirror's
      // input handling. Never replace its DOM with innerHTML/textContent.
      const inserted = document.execCommand('insertText', false, value);
      if (!inserted && previous && text(editor) === expected) { selection.removeAllRanges(); selection.addRange(previous); }
    }
    return text(editor) === (append ? expected + value : value);
  }
  globalThis.PromptEnhanceEditor = Object.freeze({ find, text, atEnd, write });
})();
