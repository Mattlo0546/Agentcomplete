(() => {
  'use strict';
  const MAX_PROMPT = 20000, MAX_SUFFIX = 4000;
  const allowedOrigins = new Set(['https://chatgpt.com', 'https://chat.openai.com']);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function isChatGPT(url) { try { return allowedOrigins.has(new URL(url).origin); } catch { return false; } }
  function validString(value, max = MAX_PROMPT) { return typeof value === 'string' && value.length <= max && value.isWellFormed(); }
  function prompt(value) {
    if (!validString(value) || !value.trim()) throw new Error('Enter a draft of 1–20,000 characters.');
    return value;
  }
  function boundary(text, index) {
    return index === 0 || index === text.length || !(text.charCodeAt(index - 1) >= 0xd800 && text.charCodeAt(index - 1) <= 0xdbff && text.charCodeAt(index) >= 0xdc00 && text.charCodeAt(index) <= 0xdfff);
  }
  function applyEdits(text, edits) {
    if (!Array.isArray(edits) || !edits.length || edits.length > 100) throw new Error('Invalid edits.');
    let end = 0, result = '';
    for (const edit of edits) {
      if (!edit || !Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start < end || edit.end < edit.start || edit.end > text.length || !boundary(text, edit.start) || !boundary(text, edit.end) || !validString(edit.text)) throw new Error('Invalid edits.');
      result += text.slice(end, edit.start) + edit.text;
      end = edit.end;
    }
    return prompt(result + text.slice(end));
  }
  function validateReply(data, snapshot) {
    if (!data || data.schema_version !== 1 || data.request_id !== snapshot.id || data.prompt_revision !== snapshot.revision) throw new Error('The suggestion did not match this draft.');
    if (data.type === 'none') return { type: 'none' };
    if (data.type === 'autocomplete' && data.insert_at === snapshot.text.length && validString(data.text, MAX_SUFFIX) && data.text.length && snapshot.text.length + data.text.length <= MAX_PROMPT) return { type: data.type, text: data.text };
    if (data.type === 'multiple_choice' && validString(data.question, 2000) && Array.isArray(data.options) && data.options.length >= 2 && data.options.length <= 6) {
      const ids = new Set();
      const options = data.options.map(option => {
        if (!validString(option.id, 40) || !option.id || ids.has(option.id) || !validString(option.label, 120) || !option.label) throw new Error('Invalid suggestion options.');
        ids.add(option.id);
        return { id: option.id, label: option.label, text: applyEdits(snapshot.text, option.edits) };
      });
      return { type: data.type, question: data.question, options };
    }
    throw new Error('The backend returned an unsupported suggestion.');
  }
  function validateVersion(value) {
    if (!value || !uuid.test(value.id) || !validString(value.prompt) || !validString(value.suggestion_text ?? '', MAX_SUFFIX) || value.saved_text !== value.prompt + (value.suggestion_text ?? '') || !validString(value.saved_text) || !validString(value.title ?? '', 120)) throw new Error('Invalid saved version.');
    return value;
  }
  function validateMessage(message) {
    if (!message || typeof message !== 'object') throw new Error('Invalid extension request.');
    const { type } = message;
    if (['settings', 'health', 'cancel'].includes(type)) return message;
    if (type === 'set-enabled' && typeof message.enabled === 'boolean') return message;
    if (type === 'enhance') {
      prompt(message.prompt);
      if (!validString(message.id, 64) || !message.id || !Number.isInteger(message.revision) || message.revision < 0) throw new Error('Invalid draft revision.');
      return message;
    }
    if (type === 'save') {
      prompt(message.prompt);
      if (!validString(message.suggestion ?? '', MAX_SUFFIX) || message.prompt.length + (message.suggestion?.length ?? 0) > MAX_PROMPT) throw new Error('Saved version is too long.');
      return message;
    }
    if (type === 'history' && Number.isInteger(message.offset) && message.offset >= 0 && message.offset <= 1000000) return message;
    throw new Error('Unsupported extension request.');
  }
  globalThis.PromptEnhanceCore = Object.freeze({ MAX_PROMPT, MAX_SUFFIX, isChatGPT, validString, prompt, validateReply, validateVersion, validateMessage, applyEdits });
})();
