import { schema } from 'prosemirror-schema-basic';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history, undo, closeHistory } from 'prosemirror-history';
const old = document.querySelector('[data-composer-markdown]');
const place = old.parentElement; old.remove();
const view = new EditorView(place, {
  state: EditorState.create({ schema, plugins: [history()] }),
  attributes: { 'data-composer-markdown': '', 'role': 'textbox', 'aria-label': 'Ask ChatGPT' },
  dispatchTransaction(transaction) { view.updateState(view.state.apply(transaction)); window.model = view.state.doc.textBetween(0, view.state.doc.content.size, '\n'); },
  handleKeyDown(view, event) { if ((event.metaKey || event.ctrlKey) && event.key === 'z') return undo(view.state, view.dispatch); return false; }
});
window.fixtureEditor = view;
window.closeUndoGroup = () => view.dispatch(closeHistory(view.state.tr));
