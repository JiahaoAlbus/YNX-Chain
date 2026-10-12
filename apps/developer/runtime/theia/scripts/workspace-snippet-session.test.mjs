import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire, registerHooks } from 'node:module';

// DOM surfaces only: real retained controller/session/parser/models/history,
// completion registry and context keys below are imported without substitution.
globalThis.window = { addEventListener() {}, removeEventListener() {}, location: { href: 'http://localhost/' }, document: {} };
globalThis.document = window.document;
registerHooks({ load(url, context, next) {
  return url.endsWith('.css') ? { format: 'module', source: 'export {};', shortCircuit: true } : next(url, context);
} });
const imp = path => import(new URL(`../node_modules/@theia/monaco-editor-core/esm/vs/${path}`, import.meta.url));
const [{ ModelService }, { UndoRedoService }, { Event, Emitter }, { EDITOR_MODEL_DEFAULTS }, { URI }, { Range }, { Selection },
  { SingleModelEditStackElement, MultiModelEditStackElement }, { SnippetSession }, { SnippetController2 }, { SnippetParser },
  { ILabelService }, { IWorkspaceContextService }, { LanguageFeaturesService }, { ContextKeyService }] = await Promise.all([
  imp('editor/common/services/modelService.js'), imp('platform/undoRedo/common/undoRedoService.js'), imp('base/common/event.js'),
  imp('editor/common/core/misc/textModelDefaults.js'), imp('base/common/uri.js'), imp('editor/common/core/range.js'), imp('editor/common/core/selection.js'),
  imp('editor/common/model/editStack.js'), imp('editor/contrib/snippet/browser/snippetSession.js'), imp('editor/contrib/snippet/browser/snippetController2.js'),
  imp('editor/contrib/snippet/browser/snippetParser.js'), imp('platform/label/common/label.js'), imp('platform/workspace/common/workspace.js'),
  imp('editor/common/services/languageFeaturesService.js'), imp('platform/contextkey/browser/contextKeyService.js'),
]);
const require = createRequire(import.meta.url);
const { prepareWorkspaceSnippet, adoptWorkspaceSnippet, RETAINED_MONACO_VERSION } = require('../../ynx-workbench/lib/workspace-snippet-session.js');
const monacoVersion = require('../node_modules/@theia/monaco-editor-core/package.json').version;
const dependencies = { monacoVersion, SnippetSession, SnippetController2, SnippetParser, Range, Selection };
assert.equal(monacoVersion, RETAINED_MONACO_VERSION);
let sequence = 0;
function fixture(text = 'old\nold\nold') {
  const configuration = { onDidChangeConfiguration: Event.None, getValue: key => key === 'files.restoreUndoStack' ? true : key === 'editor' ?
    { ...EDITOR_MODEL_DEFAULTS, trimAutoWhitespace: false, detectIndentation: false } : undefined };
  const undoRedo = new UndoRedoService({ prompt() { throw Error('unexpected partial workspace undo'); } }, { warn() {}, error() {} });
  const tokenization = () => ({ dispose() {}, onDidChangeLanguage: Event.None, onDidChangeFontTokens: Event.None, _hasListeners: () => false,
    handleDidChangeContent() {}, handleDidChangeLanguage() {}, handleLanguageConfigurationServiceChange() {}, getLanguageId: () => 'plaintext' });
  const models = new ModelService(configuration, { getEOL: () => '\n' }, undoRedo, {
    createInstance: (ctor, ...args) => new ctor(...args, undoRedo, { requestRichLanguageFeatures() {} }, { onDidChange: Event.None }, { createInstance: tokenization }),
  });
  const id = ++sequence;
  const model = models.createModel(text, 'plaintext', URI.parse(`file:///owned/${id}/A.sol`));
  const caller = models.createModel('old', 'plaintext', URI.parse(`file:///owned/${id}/B.sol`));
  const cursor = new Emitter(), changedModel = new Emitter();
  const context = new ContextKeyService(configuration), features = new LanguageFeaturesService(), errors = [];
  const languageConfigurationService = { getLanguageConfiguration: () => ({ comments: undefined }) };
  let current = model, selections = [new Selection(1, 1, 1, 4)], executeCount = 0, controller;
  const editor = {
    hasModel: () => !!current, getModel: () => current, getSelections: () => selections.slice(), getSelection: () => selections[0], getPosition: () => selections[0].getPosition(), getOption: () => 'spread',
    setSelections(values) { selections = values; cursor.fire({}); },
    changeDecorations: callback => current.changeDecorations(callback), removeDecorations: ids => current.deltaDecorations(ids, []),
    revealPositionInCenterIfOutsideViewport() {}, revealRange() {},
    onDidChangeModelContent: listener => current.onDidChangeContent(listener), onDidChangeModel: changedModel.event, onDidChangeCursorSelection: cursor.event,
    _onDidChangeCursorSelection: cursor, _onDidChangeModel: changedModel,
    getContribution: key => key === SnippetController2.ID ? controller : undefined,
    executeEdits(source, operations, computeCursor) {
      executeCount++;
      // CodeEditorWidget's omitted endCursorState means null, preserving the
      // cursor through the real model's tracked ranges rather than moving it
      // to every replacement (which falsely cancels native transforms).
      const ids = typeof computeCursor === 'function' ? [] : current.deltaDecorations([], selections.map(range => ({ range, options: { description: 'headless-cursor', stickiness: 0 } })));
      const result = current.pushEditOperations(selections, operations, inverse => typeof computeCursor === 'function' ? computeCursor(inverse) : null);
      const next = result ?? ids.map(id => { const range = current.getDecorationRange(id); return new Selection(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn); });
      current.deltaDecorations(ids, []);
      if (!Selection.selectionsEqual(selections, next)) editor.setSelections(next);
      return true;
    },
    invokeWithinContext: fn => fn({ get(service) {
      if (service === ILabelService) return { getUriLabel: uri => uri.fsPath };
      if (service === IWorkspaceContextService) return { getWorkspace: () => ({ folders: [{ uri: URI.parse('file:///owned'), name: 'owned' }] }), getWorkspaceFolder: () => ({ uri: URI.parse('file:///owned'), name: 'owned' }) };
      throw Error(`unexpected service ${service}`);
    } }),
  };
  controller = new SnippetController2(editor, { error: (...args) => errors.push(args) }, features, context, languageConfigurationService);
  const f = { editor, controller, model, caller, undoRedo, features, context, errors, languageConfigurationService,
    get executeCount() { return executeCount; }, switchModel(next) { current = next; changedModel.fire({}); },
    prepare(edits = [
      { range: new Range(1, 1, 1, 4), text: '${1:foo}', insertAsSnippet: true },
      { range: new Range(2, 1, 2, 4), text: '$1-${2|red,blue|}-${TM_FILENAME}-${CLIPBOARD}-$0', insertAsSnippet: true },
      { range: new Range(3, 1, 3, 4), text: '$literal\\plain', insertAsSnippet: false },
    ]) { return prepareWorkspaceSnippet({ editor, edits, dependencies, languageConfigurationService, clipboardText: 'clip' }); },
    commit(plan) {
      plan.validateBeforeCommit();
      const a = new SingleModelEditStackElement('Workspace snippet', 'ynx.snippet', model, editor.getSelections());
      const b = new SingleModelEditStackElement('Workspace snippet', 'ynx.snippet', caller, []);
      const batch = new MultiModelEditStackElement('Workspace snippet', 'ynx.snippet', [a, b]); batch.split = undefined;
      const inverse = model.applyEdits(plan.operations, true), inverseB = caller.applyEdits([{ range: new Range(1, 1, 1, 4), text: 'atomic' }], true);
      for (const [m, child, changes] of [[model, a, inverse], [caller, b, inverseB]]) child.append(m, changes.map(e => e.textChange).sort((x, y) => x.oldPosition - y.oldPosition), 0, m.getAlternativeVersionId(), []);
      return { inverse, finish() { a.append(model, [], 0, model.getAlternativeVersionId(), editor.getSelections()); batch.close(); undoRedo.pushElement(batch); } };
    },
    adopt(plan, inverse, extra = {}) { return adoptWorkspaceSnippet({ plan, editor, controller, inverseEdits: inverse, ...extra }); },
    dispose() { controller.dispose(); context.dispose(); cursor.dispose(); changedModel.dispose(); model.dispose(); caller.dispose(); models.dispose(); },
  };
  return f;
}
const selectedText = f => f.editor.getSelections().map(range => f.model.getValueInRange(range));

function integrationFixture() {
  const f = fixture(), warnings = [], documents = new Map([f.model, f.caller].map(model => [model.uri.toString(), { textEditorModel: model }]));
  const nativeEdits = [
    { range: new Range(1, 1, 1, 4), text: '${1:foo}', insertAsSnippet: true },
    { range: new Range(2, 1, 2, 4), text: '$1-${2|red,blue|}-${TM_FILENAME}-${CLIPBOARD}-$0', insertAsSnippet: true },
    { range: new Range(3, 1, 3, 4), text: '$literal\\plain' },
  ];
  const edits = () => [
    ...nativeEdits.map(textEdit => ({ resource: f.model.uri, versionId: f.model.getVersionId(), textEdit })),
    { resource: f.caller.uri, versionId: f.caller.getVersionId(), textEdit: { range: new Range(1, 1, 1, 4), text: 'atomic' } },
  ];
  let handle, minimalCalls = [], transformed = [];
  const workspace = {
    textModelService: { async createModelReference(uri) { return { object: documents.get(uri.toString()), dispose() {} }; } },
    transformSnippetStringToInsertText(edit) { transformed.push(edit.resource.toString()); if (edit.resource.toString() === f.model.uri.toString()) throw Error('active native snippet was flattened'); return edit.textEdit; },
  };
  const deps = { URI, Range, SingleModelEditStackElement, MultiModelEditStackElement, undoRedo: f.undoRedo,
    minimalEdits: async (uri, values) => { minimalCalls.push(uri.toString()); return values; },
    selections: document => document.textEditorModel === f.model ? f.editor.getSelections() : [], warn: message => warnings.push(message),
    async prepareSnippet(document, values) {
      if (document.textEditorModel !== f.model || !values.some(edit => edit.textEdit.insertAsSnippet)) return undefined;
      const native = prepareWorkspaceSnippet({ editor: f.editor, edits: values.map(edit => edit.textEdit), dependencies, languageConfigurationService: f.languageConfigurationService, clipboardText: 'clip' });
      return { operations: native.operations, validateBeforeCommit: () => native.validateBeforeCommit(),
        deferEvents: () => require('../../ynx-workbench/lib/workspace-text-edit-adapter.js').deferWorkspaceSnippetEvents(f.editor, f.controller, message => warnings.push(message)),
        adopt(inverseEdits) { handle = f.adopt(native, inverseEdits); return handle; }, dispose: () => native.dispose() };
    },
  };
  return { ...f, workspace, deps, edits, warnings, minimalCalls, transformed,
    get handle() { return handle; }, values: () => [f.model.getValue(), f.caller.getValue()],
    histories: () => [f.model, f.caller].map(model => f.undoRedo.getElements(model.uri)),
    snapshots: () => [f.model, f.caller].map(model => model.getInitialUndoRedoSnapshot()),
  };
}

test('real prepare/adopt, native Tab/Shift-Tab choices and linked typing; shared Undo/Redo', async () => {
  const f = fixture();
  try {
    const before = f.model.getVersionId(), alt = f.model.getAlternativeVersionId(), selection = f.editor.getSelections();
    const plan = f.prepare();
    assert.equal(f.model.getValue(), 'old\nold\nold'); assert.equal(f.model.getVersionId(), before); assert.equal(f.model.getAlternativeVersionId(), alt);
    assert.deepEqual(f.editor.getSelections(), selection); assert.equal(f.undoRedo.getElements(f.model.uri).past.length, 0);
    assert.deepEqual(plan.operations.map(e => e.text), ['foo', 'foo-red-A.sol-clip-', '$literal\\plain']);
    const original = SnippetSession.prototype.insert, committed = f.commit(plan), handle = f.adopt(plan, committed.inverse); committed.finish();
    assert.equal(SnippetSession.prototype.insert, original); assert.equal(f.executeCount, 0); assert.equal(handle.isActive, true);
    assert.deepEqual(selectedText(f), ['foo', 'foo']); assert.equal(f.context.getContextKeyValue('inSnippetMode'), true);
    assert.equal(f.controller._modelVersionId, alt); assert.equal(f.errors.length, 0);
    assert.equal(f.undoRedo.getElements(f.model.uri).past.length, 1);
    assert.equal(f.undoRedo.getElements(f.model.uri).past[0], f.undoRedo.getElements(f.caller.uri).past[0]);
    f.controller.next();
    assert.deepEqual(selectedText(f), ['red']);
    const provider = f.features.completionProvider.all(f.model).find(p => p._debugDisplayName === 'snippetChoiceCompletions');
    assert.ok(provider); assert.deepEqual(provider.provideCompletionItems(f.model, f.editor.getPosition()).suggestions.map(s => s.label), ['red', 'blue']);
    f.controller.prev(); assert.deepEqual(selectedText(f), ['foo', 'foo']);
    f.editor.executeEdits('type', f.editor.getSelections().map(range => ({ range, text: 'bar' })), inverse => inverse.map(e => Selection.fromPositions(e.range.getEndPosition())));
    assert.equal(f.controller.isInSnippet(), true); assert.equal(f.model.getValue(), 'bar\nbar-red-A.sol-clip-\n$literal\\plain');
    // Native typing has its own later edit history; it does not repeat adoption.
    assert.equal(f.executeCount, 1); f.model.pushStackElement(); await f.model.undo();
    assert.equal(f.model.getValue(), 'foo\nfoo-red-A.sol-clip-\n$literal\\plain');
    assert.equal(handle.onUndoDecision(false), false); assert.equal(handle.isActive, true);
    const decorations = [...f.controller._session._snippets[0]._placeholderDecorations.values()];
    assert.equal(handle.onUndoDecision(true), true); assert.equal(handle.isActive, false);
    assert.equal(f.context.getContextKeyValue('inSnippetMode'), false); assert.equal(f.features.completionProvider.all(f.model).includes(provider), false);
    assert.ok(decorations.every(id => f.model.getDecorationRange(id) === null));
    await f.caller.undo(); assert.equal(f.model.getValue(), 'old\nold\nold'); assert.equal(f.caller.getValue(), 'old');
    await f.caller.redo(); assert.equal(f.model.getValue(), 'foo\nfoo-red-A.sol-clip-\n$literal\\plain'); assert.equal(f.caller.getValue(), 'atomic'); assert.equal(handle.isActive, false);
    assert.throws(() => f.adopt(plan, committed.inverse), /consumed/);
  } finally { f.dispose(); }
});

test('stale preparation, version, exact template/model and tracked inverse are refused without adoption edits', () => {
  for (const mismatch of ['version', 'template', 'model', 'identifier', 'offset', 'range', 'text']) {
    const f = fixture();
    try {
      const plan = f.prepare(), { inverse } = f.commit(plan);
      let extra = {};
      if (mismatch === 'version') f.model.applyEdits([{ range: new Range(1, 1, 1, 1), text: 'x' }]);
      if (mismatch === 'template') extra.template = plan.template.slice();
      if (mismatch === 'model') f.switchModel(f.caller);
      if (mismatch === 'identifier') inverse[0].identifier = undefined;
      if (mismatch === 'offset') inverse[0].textChange.newPosition++;
      if (mismatch === 'range') inverse[0].range = new Range(1, 1, 1, 1);
      if (mismatch === 'text') inverse[0].textChange.newText = 'bad';
      const text = f.model.getValue(), version = f.model.getVersionId(), original = SnippetSession.prototype.insert;
      assert.throws(() => f.adopt(plan, inverse, extra), /Workspace snippet:/);
      assert.equal(f.model.getValue(), text); assert.equal(f.model.getVersionId(), version); assert.equal(f.executeCount, 0);
      assert.equal(SnippetSession.prototype.insert, original); assert.equal(f.controller.isInSnippet(), false);
    } finally { f.dispose(); }
  }
  const f = fixture(); try { const plan = f.prepare(); f.editor.setSelections([new Selection(2, 1, 2, 1)]); assert.throws(() => plan.validateBeforeCommit(), /selections changed/); plan.dispose(); assert.throws(() => f.adopt(plan, []), /unavailable/); } finally { f.dispose(); }
});

test('one-time gate preserves independent native insert and restores prototype on native failure', () => {
  const target = fixture(), other = fixture('old');
  try {
    const plan = target.prepare(), { inverse } = target.commit(plan), original = SnippetSession.prototype.insert;
    const setSelections = target.editor.setSelections;
    target.editor.setSelections = values => { other.controller.insert('${1:independent}-$0'); setSelections(values); };
    target.adopt(plan, inverse);
    assert.equal(other.model.getValue(), 'independent-'); assert.equal(other.executeCount, 1); assert.equal(other.controller.isInSnippet(), true);
    assert.equal(SnippetSession.prototype.insert, original); assert.equal(target.executeCount, 0);
  } finally { target.dispose(); other.dispose(); }
  const f = fixture();
  try {
    const plan = f.prepare(), { inverse } = f.commit(plan), original = SnippetSession.prototype.insert, ids = [];
    const change = f.editor.changeDecorations;
    f.editor.changeDecorations = fn => { const result = change(fn); ids.push(...f.controller._session._snippets[0]._placeholderDecorations.values()); return result; };
    f.editor.setSelections = () => { throw Error('headless presentation failure'); };
    const text = f.model.getValue(), version = f.model.getVersionId();
    assert.throws(() => f.adopt(plan, inverse), /headless presentation failure/);
    assert.equal(SnippetSession.prototype.insert, original); assert.equal(f.controller.isInSnippet(), false); assert.equal(f.model.getValue(), text); assert.equal(f.model.getVersionId(), version);
    assert.ok(ids.length); assert.ok(ids.every(id => f.model.getDecorationRange(id) === null)); assert.equal(f.executeCount, 0);
  } finally { f.dispose(); }
});

test('version contract, overlapping edits and existing controller session refuse safely', () => {
  const f = fixture();
  try {
    assert.throws(() => prepareWorkspaceSnippet({ editor: f.editor, edits: [], dependencies: { ...dependencies, monacoVersion: 'other' } }), /requires review/);
    assert.throws(() => f.prepare([{ range: new Range(1, 1, 1, 4), text: '$1', insertAsSnippet: true }, { range: new Range(1, 2, 1, 4), text: 'x' }]), /overlapping/);
    const plan = f.prepare(), { inverse } = f.commit(plan);
    f.controller.insert('${1:normal}-$0'); const session = f.controller._session, text = f.model.getValue();
    assert.throws(() => f.adopt(plan, inverse), /finish the current snippet/); assert.equal(f.controller._session, session); assert.equal(f.model.getValue(), text);
  } finally { f.dispose(); }
});

test('an existing native session refuses preparation before any model or history mutation', () => {
  const f = fixture();
  try {
    f.controller.insert('${1:normal}-$0');
    const session = f.controller._session, text = f.model.getValue(), version = f.model.getVersionId(), history = f.undoRedo.getElements(f.model.uri), cursor = f.editor.getSelections();
    assert.throws(() => f.prepare(), /finish the current snippet before preparing/);
    assert.equal(f.controller._session, session); assert.equal(f.controller.isInSnippet(), true);
    assert.equal(f.model.getValue(), text); assert.equal(f.model.getVersionId(), version); assert.deepEqual(f.undoRedo.getElements(f.model.uri), history); assert.deepEqual(f.editor.getSelections(), cursor);
  } finally { f.dispose(); }
});

test('native plain/final tab lifecycle and explicit cancellation before model detach', () => {
  for (const text of ['${TM_FILENAME}-$0', '${TM_FILENAME}']) {
    const f = fixture('old');
    try {
      const plan = f.prepare([{ range: new Range(1, 1, 1, 4), text, insertAsSnippet: true }]);
      const { inverse } = f.commit(plan), handle = f.adopt(plan, inverse);
      assert.equal(f.model.getValue(), text.endsWith('$0') ? 'A.sol-' : 'A.sol');
      assert.equal(handle.isActive, false); assert.equal(f.controller._session, undefined); assert.equal(f.executeCount, 0); assert.equal(f.errors.length, 0);
    } finally { f.dispose(); }
  }
  const f = fixture();
  try {
    const plan = f.prepare(), { inverse } = f.commit(plan), handle = f.adopt(plan, inverse);
    const ids = [...f.controller._session._snippets[0]._placeholderDecorations.values()];
    // Host owns model-detach ordering: cancel while old-model decorations remain
    // addressable. This is explicit lifecycle coverage, not a widget simulation.
    f.controller.cancel(); f.switchModel(f.caller);
    assert.equal(handle.isActive, false); assert.equal(f.features.completionProvider.all(f.model).length, 0);
    assert.ok(ids.every(id => f.model.getDecorationRange(id) === null));
  } finally { f.dispose(); }
});

test('placeholder transforms stay native and execute only on a later Tab', () => {
  const f = fixture('old');
  try {
    const plan = f.prepare([{ range: new Range(1, 1, 1, 4), text: '${1:foo}-${1/(.*)/${1:/upcase}/}-$0', insertAsSnippet: true }]);
    const committed = f.commit(plan), handle = f.adopt(plan, committed.inverse); committed.finish();
    assert.equal(f.executeCount, 0); assert.equal(f.model.getValue(), 'foo-foo-');
    f.controller.next();
    assert.equal(f.model.getValue(), 'foo-FOO-'); assert.equal(f.executeCount, 1); assert.equal(handle.isActive, false);
  } finally { f.dispose(); }
});

test('native finalization failures propagate for both live and trivial sessions', () => {
  for (const live of [true, false]) {
    const f = fixture('old');
    try {
      const plan = f.prepare([{ range: new Range(1, 1, 1, 4), text: live ? '${1|red,blue|}-$0' : '${TM_FILENAME}-$0', insertAsSnippet: true }]);
      const { inverse } = f.commit(plan), original = SnippetSession.prototype.insert, text = f.model.getValue(), version = f.model.getVersionId();
      if (live) f.features.completionProvider.register = () => { throw Error('completion presentation failure'); };
      else f.editor.onDidChangeModelContent = () => { throw Error('listener presentation failure'); };
      assert.throws(() => f.adopt(plan, inverse), /presentation failure/);
      assert.equal(SnippetSession.prototype.insert, original); assert.equal(f.controller._session, undefined); assert.equal(f.context.getContextKeyValue('inSnippetMode'), false);
      assert.equal(f.executeCount, 0); assert.equal(f.model.getValue(), text); assert.equal(f.model.getVersionId(), version);
      assert.throws(() => f.adopt(plan, inverse), /unavailable/);
    } finally { f.dispose(); }
  }
});

test('actual applyTextTransaction preserves tracked native edits and shares Undo/Redo from another caller', async () => {
  const { applyTextTransaction } = require('../../ynx-workbench/lib/workspace-text-edit-adapter.js'), f = integrationFixture();
  try {
    const before = f.values();
    assert.deepEqual(await applyTextTransaction(f.workspace, f.edits(), f.deps), { totalEdits: 4, totalFiles: 2 });
    assert.deepEqual(f.values(), ['foo\nfoo-red-A.sol-clip-\n$literal\\plain', 'atomic']);
    assert.deepEqual(selectedText(f), ['foo', 'foo']); assert.equal(f.handle.isActive, true);
    assert.deepEqual(f.minimalCalls, [f.caller.uri.toString()]); assert.deepEqual(f.transformed, [f.caller.uri.toString()]);
    const history = f.histories(); assert.equal(history[0].past.length, 1); assert.equal(history[0].past[0], history[1].past[0]);
    const after = f.values(); await f.caller.undo();
    assert.deepEqual(f.values(), before); assert.equal(f.handle.isActive, false); assert.equal(f.context.getContextKeyValue('inSnippetMode'), false);
    await f.model.redo(); assert.deepEqual(f.values(), after); assert.equal(f.handle.isActive, false); assert.deepEqual(f.warnings, []);
  } finally { f.dispose(); }
});

test('actual guarded workspace Undo blocked by later caller typing preserves the live snippet', async () => {
  const { applyTextTransaction } = require('../../ynx-workbench/lib/workspace-text-edit-adapter.js'), f = integrationFixture();
  try {
    const before = f.values(); await applyTextTransaction(f.workspace, f.edits(), f.deps); const applied = f.values();
    f.caller.pushStackElement(); f.caller.pushEditOperations([], [{ range: new Range(1, 1, 1, 1), text: 'user ' }], () => []); f.caller.pushStackElement();
    const typed = f.values(), histories = f.histories(); await f.model.undo();
    assert.deepEqual(f.values(), typed); assert.deepEqual(f.histories(), histories); assert.equal(f.handle.isActive, true); assert.match(f.warnings.at(-1), /later edits/);
    await f.caller.undo(); assert.deepEqual(f.values(), applied); assert.equal(f.handle.isActive, true);
    await f.caller.undo(); assert.deepEqual(f.values(), before); assert.equal(f.handle.isActive, false);
  } finally { f.dispose(); }
});

test('actual transaction native finalization failure rolls back every model, history and initial snapshot', async () => {
  const { applyTextTransaction } = require('../../ynx-workbench/lib/workspace-text-edit-adapter.js'), f = integrationFixture();
  try {
    const before = f.values(), histories = f.histories(), snapshots = f.snapshots(), ids = [], original = SnippetSession.prototype.insert;
    const change = f.editor.changeDecorations;
    f.editor.changeDecorations = fn => { const result = change(fn); ids.push(...f.controller._session._snippets[0]._placeholderDecorations.values()); return result; };
    // The first tab stop is already a choice, exercising failure after gate
    // completion in the real upstream controller's provider registration.
    const values = f.edits(); values[0].textEdit = { range: new Range(1, 1, 1, 4), text: '${1|red,blue|}', insertAsSnippet: true };
    f.features.completionProvider.register = () => { throw Error('actual native provider failure'); };
    await assert.rejects(applyTextTransaction(f.workspace, values, f.deps), /actual native provider failure/);
    assert.deepEqual(f.values(), before); assert.deepEqual(f.histories(), histories); assert.deepEqual(f.snapshots(), snapshots);
    assert.equal(SnippetSession.prototype.insert, original); assert.equal(f.controller.isInSnippet(), false);
    assert.ok(ids.length); assert.ok(ids.every(id => f.model.getDecorationRange(id) === null));
  } finally { f.dispose(); }
});

test('actual transaction stale snippet preparation leaves all texts and histories unchanged', async () => {
  const { applyTextTransaction } = require('../../ynx-workbench/lib/workspace-text-edit-adapter.js'), f = integrationFixture();
  try {
    const before = f.values(), histories = f.histories(), snapshots = f.snapshots();
    f.deps.minimalEdits = async (_uri, values) => { f.editor.setSelections([new Selection(2, 1, 2, 1)]); return values; };
    await assert.rejects(applyTextTransaction(f.workspace, f.edits(), f.deps), /selections changed/);
    assert.deepEqual(f.values(), before); assert.deepEqual(f.histories(), histories); assert.deepEqual(f.snapshots(), snapshots);
    assert.equal(f.controller.isInSnippet(), false);
  } finally { f.dispose(); }
});

test('native adoption cursor listeners see all applied files and their real typing stays a separate history entry', async () => {
  const { applyTextTransaction } = require('../../ynx-workbench/lib/workspace-text-edit-adapter.js'), f = integrationFixture();
  try {
    let seen, once = true;
    const listener = f.editor.onDidChangeCursorSelection(() => {
      if (!once) return; once = false; seen = f.caller.getValue();
      f.caller.pushStackElement(); f.caller.pushEditOperations([], [{ range: new Range(1, 1, 1, 1), text: 'user ' }], () => []); f.caller.pushStackElement();
    });
    await applyTextTransaction(f.workspace, f.edits(), f.deps);
    assert.equal(seen, 'atomic'); assert.deepEqual(f.values(), ['foo\nfoo-red-A.sol-clip-\n$literal\\plain', 'user atomic']);
    await f.caller.undo();
    assert.deepEqual(f.values(), ['foo\nfoo-red-A.sol-clip-\n$literal\\plain', 'atomic']);
    await f.caller.undo(); assert.deepEqual(f.values(), ['old\nold\nold', 'old']); listener.dispose();
  } finally { f.dispose(); }
});

test('admitted workspace Undo defers native snippet disposal decorations until every model and history is restored', async () => {
  const { applyTextTransaction } = require('../../ynx-workbench/lib/workspace-text-edit-adapter.js'), f = integrationFixture();
  try {
    await applyTextTransaction(f.workspace, f.edits(), f.deps);
    let seen, once = true;
    const listener = f.model.onDidChangeDecorations(() => {
      if (!once) return; once = false; seen = f.caller.getValue();
      f.caller.pushStackElement(); f.caller.pushEditOperations([], [{ range: new Range(1, 1, 1, 1), text: 'user ' }], () => []); f.caller.pushStackElement();
    });
    await f.caller.undo();
    assert.equal(seen, 'old'); assert.deepEqual(f.values(), ['old\nold\nold', 'user old']);
    assert.equal(f.handle.isActive, false);
    await f.caller.undo(); assert.deepEqual(f.values(), ['old\nold\nold', 'old']); listener.dispose();
  } finally { f.dispose(); }
});

// This suite proves native headless contract/lifecycles. GUI key routing, popup
// rendering, transaction guard wiring and interactive inactive-file handoff
// remain NOT_VERIFIED; this coordinator is deliberately not installed in UI.
