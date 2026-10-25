import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/core.js';
const C = globalThis.PromptEnhanceCore;
const snapshot = { id: 'draft-1', revision: 7, text: 'Explain retries 🚀' };
const reply = { schema_version: 1, request_id: snapshot.id, prompt_revision: 7, type: 'autocomplete', insert_at: snapshot.text.length, text: ' clearly.' };

test('only exact HTTPS ChatGPT origins are allowed', () => {
  for (const url of ['https://chatgpt.com/c/123', 'https://chat.openai.com/']) assert.equal(C.isChatGPT(url), true);
  for (const url of ['http://chatgpt.com', 'https://chatgpt.com.evil.test', 'https://evil.test/chatgpt.com', 'not a URL']) assert.equal(C.isChatGPT(url), false);
});
test('autocomplete is bound to the exact UTF-16 draft revision and end', () => {
  assert.deepEqual(C.validateReply(reply, snapshot), { type: 'autocomplete', text: ' clearly.' });
  for (const change of [{ request_id: 'old' }, { prompt_revision: 6 }, { insert_at: snapshot.text.length - 1 }, { schema_version: 2 }, { text: '' }, { text: '\ud800' }, { text: 'x'.repeat(4001) }]) assert.throws(() => C.validateReply({ ...reply, ...change }, snapshot));
});
test('edits reject overlaps, out-of-range positions and split emoji', () => {
  assert.equal(C.applyEdits('A🚀B', [{ start: 1, end: 3, text: '✨' }]), 'A✨B');
  for (const edits of [[{ start: 1, end: 2, text: '' }], [{ start: -1, end: 0, text: 'x' }], [{ start: 0, end: 5, text: 'x' }], [{ start: 0, end: 2, text: 'x' }, { start: 1, end: 3, text: 'y' }], [{ start: 0, end: 4, text: '' }]]) assert.throws(() => C.applyEdits('A🚀B', edits));
});
test('choice responses validate every edit and reject duplicate IDs', () => {
  const options = ['a', 'b'].map(id => ({ id, label: id, edits: [{ start: 0, end: 0, text: id }] }));
  const data = { ...reply, type: 'multiple_choice', question: 'Which?', options };
  assert.equal(C.validateReply(data, snapshot).options[0].text, 'a' + snapshot.text);
  assert.throws(() => C.validateReply({ ...data, options: [options[0], options[0]] }, snapshot));
});
test('saved versions must preserve the exact base and separate suffix', () => {
  const version = { id: '818a474f-7a37-4f14-9955-7290756fd60a', prompt: 'Base', suggestion_text: ' suffix', saved_text: 'Base suffix', title: 'Base' };
  assert.equal(C.validateVersion(version), version);
  assert.throws(() => C.validateVersion({ ...version, saved_text: 'Changed' }));
  assert.throws(() => C.validateVersion({ ...version, id: '../private' }));
});
test('requests reject malformed strings, invalid revisions and arbitrary routing', () => {
  for (const value of [{ type: 'fetch', url: 'https://evil.test' }, { type: 'history', offset: -1 }, { type: 'enhance', id: 'x', revision: 1.5, prompt: 'draft' }, { type: 'save', prompt: '\ud800' }, { type: 'save', prompt: 'x'.repeat(20000), suggestion: 'y' }]) assert.throws(() => C.validateMessage(value));
  assert.equal(C.validateMessage({ type: 'save', prompt: '<img src=x onerror=alert(1)>' }).type, 'save');
});
