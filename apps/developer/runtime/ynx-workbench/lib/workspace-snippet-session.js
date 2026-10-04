'use strict';

// Opt-in coordinator only. Existing editor/workspace bindings do not install it.
// Reviewed against @theia/monaco-editor-core 1.108.201. The temporary gate lets
// the real Controller2 establish its own choices, commands and disposables.
const RETAINED_MONACO_VERSION = '1.108.201';
const plans = new WeakMap();
let adoptionInProgress = false;

function fail(message) { throw Error(`Workspace snippet: ${message}`); }
function cursorSnapshot(editor) {
  return JSON.stringify(editor.getSelections().map(s => [s.selectionStartLineNumber, s.selectionStartColumn, s.positionLineNumber, s.positionColumn]));
}
function nativeContract(dependencies) {
  const { monacoVersion, SnippetSession, SnippetController2, SnippetParser, Range, Selection } = dependencies;
  if (monacoVersion !== RETAINED_MONACO_VERSION || typeof SnippetSession?.createEditsAndSnippetsFromEdits !== 'function' ||
      typeof SnippetSession.prototype.insert !== 'function' || typeof SnippetController2?.get !== 'function' ||
      typeof SnippetController2.prototype._doInsert !== 'function' || typeof SnippetParser?.escape !== 'function' || typeof Range?.lift !== 'function' || typeof Selection?.fromPositions !== 'function')
    fail('the retained native snippet contract requires review.');
}
function record(plan) { const state = plans.get(plan); if (!state || state.disposed || state.consumed) fail('the preparation is unavailable or already consumed.'); return state; }
function dispose(state) {
  if (state.disposed || state.consumed) return;
  state.disposed = true;
  for (const snippet of state.snippets) snippet.dispose();
}
function assertEditor(state, editor) {
  if (editor !== state.editor || !editor.hasModel() || editor.getModel() !== state.model || state.model.isDisposed() || state.model.uri.toString() !== state.uri)
    fail('the editor or document changed.');
}
function validateBeforeCommit(plan) {
  const state = record(plan); assertEditor(state, state.editor);
  if (state.model.getVersionId() !== state.version || state.model.getAlternativeVersionId() !== state.beforeAlternativeVersion || state.model.getValue() !== state.before || cursorSnapshot(state.editor) !== state.cursor)
    fail('the document or selections changed during preparation.');
  return true;
}

/** Prepare all edits in the active document, including ordinary text fragments.
 * Other resources keep their own normal workspace transaction preparation.
 * Do not minimize/split these tracked operations or re-resolve this template.
 */
function prepareWorkspaceSnippet({ editor, edits, dependencies, languageConfigurationService, clipboardText, overtypingCapturer, adjustWhitespace = true }) {
  nativeContract(dependencies);
  if (!editor?.hasModel() || !Array.isArray(edits) || !edits.length || !edits.some(edit => edit.insertAsSnippet)) fail('an active document and at least one snippet are required.');
  const { SnippetSession, SnippetController2, SnippetParser, Range } = dependencies, model = editor.getModel(), controller = SnippetController2.get(editor);
  if (!(controller instanceof SnippetController2) || controller._editor !== editor) fail('the native controller is unavailable.');
  if (controller.isInSnippet() || controller._session) fail('finish the current snippet before preparing a workspace snippet.');
  const state = { editor, controller, model, uri: model.uri.toString(), version: model.getVersionId(), beforeAlternativeVersion: model.getAlternativeVersionId(),
    before: model.getValue(), eol: model.getEOL(), cursor: cursorSnapshot(editor), dependencies, snippets: [], disposed: false, consumed: false };
  try {
    const template = edits.map(edit => {
      if (typeof edit.text !== 'string' || edit.eol !== undefined || edit.keepWhitespace !== undefined && typeof edit.keepWhitespace !== 'boolean') fail('invalid snippet text/whitespace or unsupported simultaneous EOL change.');
      const range = Range.lift(edit.range), valid = model.validateRange(range);
      if (!Range.equalsRange(range, valid)) fail('an edit range is invalid.');
      return { range: Object.freeze(range), template: edit.insertAsSnippet ? edit.text : SnippetParser.escape(edit.text), ...(edit.keepWhitespace === undefined ? {} : { keepWhitespace: edit.keepWhitespace }) };
    }).sort((a, b) => Range.compareRangesUsingStarts(a.range, b.range));
    for (let i = 1; i < template.length; i++) {
      const previousEnd = model.getOffsetAt(template[i - 1].range.getEndPosition()), start = model.getOffsetAt(template[i].range.getStartPosition());
      if (previousEnd > start || previousEnd === start && template[i - 1].range.isEmpty() && template[i].range.isEmpty()) fail('overlapping or ambiguous edit ranges.');
    }
    const prepared = SnippetSession.createEditsAndSnippetsFromEdits(editor, template.slice(), false, adjustWhitespace, clipboardText, overtypingCapturer, languageConfigurationService);
    state.snippets = prepared.snippets;
    if (state.snippets.length !== 1 || prepared.edits.length !== template.length) fail('the native composite-session contract changed.');
    state.template = Object.freeze(template.map(edit => Object.freeze(edit)));
    state.operations = Object.freeze(prepared.edits.map((edit, index) => {
      if (edit.identifier?.major !== index || edit.identifier.minor !== 0 || !edit._isTracked) fail('native edit identifiers changed.');
      return Object.freeze({ ...edit, identifier: Object.freeze({ ...edit.identifier }) });
    }));
    state.offsets = state.operations.map(edit => ({ start: model.getOffsetAt(edit.range.getStartPosition()), end: model.getOffsetAt(edit.range.getEndPosition()) }));
    let expected = state.before;
    for (let i = state.operations.length - 1; i >= 0; i--) {
      const edit = state.operations[i], start = model.getOffsetAt(edit.range.getStartPosition()), end = model.getOffsetAt(edit.range.getEndPosition());
      expected = expected.slice(0, start) + edit.text.replace(/\r\n|\r|\n/g, state.eol) + expected.slice(end);
    }
    state.expected = expected;
    const plan = Object.freeze({ operations: state.operations, template: state.template, beforeAlternativeVersion: state.beforeAlternativeVersion,
      validateBeforeCommit() { return validateBeforeCommit(plan); }, dispose() { dispose(state); } });
    plans.set(plan, state); validateBeforeCommit(plan); return plan;
  } catch (error) { dispose(state); throw error; }
}

/** Adopt immediately after one applyEdits batch in this model. The caller owns
 * all-model admission, shared history, rollback and after-cursor snapshots.
 * Supply real inverse operations, then record native selections in the shared
 * history's after-cursor snapshot. No text edit or new history element occurs
 * here; native final-tab finalization can close the current stack element.
 * Cancel before detaching the model; onUndoDecision is an admission callback,
 * not a replacement for the owner's whole-workspace Undo guard.
 */
function adoptWorkspaceSnippet({ plan, editor, controller, inverseEdits, template = plan?.template }) {
  const state = record(plan);
  let adoptedSession, entered = false, matched = false, gateFinished = false, expectsLive = false;
  try {
    assertEditor(state, editor);
    const { SnippetSession, SnippetController2 } = state.dependencies;
    if (template !== state.template || controller !== state.controller || controller !== SnippetController2.get(editor) || !(controller instanceof SnippetController2) || controller._editor !== editor)
      fail('the controller or exact template does not match.');
    if (controller.isInSnippet() || controller._session) fail('finish the current snippet before adopting a workspace snippet.');
    if (state.model.getVersionId() !== state.version + 1 || state.model.getAlternativeVersionId() !== state.version + 1 || state.model.getEOL() !== state.eol || state.model.getValue() !== state.expected)
      fail('the committed document/version does not match the prepared edits.');
    if (!Array.isArray(inverseEdits) || inverseEdits.length !== state.operations.length) fail('tracked inverse edits are required.');
    const byIndex = new Map();
    for (const inverse of inverseEdits) {
      const id = inverse.identifier;
      if (!id || id.minor !== 0 || !Number.isInteger(id.major) || id.major < 0 || id.major >= state.operations.length || byIndex.has(id.major) ||
          !inverse.textChange || inverse.textChange.newText !== state.operations[id.major].text.replace(/\r\n|\r|\n/g, state.eol)) fail('inverse edit identifiers or text changed.');
      byIndex.set(id.major, inverse);
    }
    let shift = 0;
    for (let index = 0; index < state.operations.length; index++) {
      const inverse = byIndex.get(index), change = inverse.textChange, offset = state.offsets[index];
      if (change.oldPosition !== offset.start || change.oldText !== state.before.slice(offset.start, offset.end) || change.newPosition !== offset.start + shift) fail('inverse edit offsets changed.');
      const actualRange = state.dependencies.Range.fromPositions(state.model.getPositionAt(change.newPosition), state.model.getPositionAt(change.newPosition + change.newText.length));
      if (!state.dependencies.Range.equalsRange(actualRange, inverse.range)) fail('inverse edit ranges changed.');
      shift += change.newText.length - change.oldText.length;
    }
    const anchor = byIndex.get(0);
    if (!anchor || adoptionInProgress) fail('snippet adoption is missing an anchor or already running.');
    const original = SnippetSession.prototype.insert;
    const gate = function (...args) {
      // Independent editor/template insertions continue through the upstream
      // implementation. This gate only consumes this exact newly created session.
      if (this._editor !== editor || this._template !== state.template || controller._session !== this) return original.apply(this, args);
      if (matched) fail('the native controller attempted duplicate adoption.');
      matched = true; adoptedSession = this;
      this._snippets = state.snippets;
      this._snippets[0].initialize(anchor.textChange);
      controller._modelVersionId = state.beforeAlternativeVersion;
      if (this.hasPlaceholder) this.next();
      else editor.setSelections(inverseEdits.map(edit => state.dependencies.Selection.fromPositions(edit.range.getEndPosition())));
      expectsLive = this.hasPlaceholder && !this.isAtLastPlaceholder;
      gateFinished = true;
    };
    adoptionInProgress = true; SnippetSession.prototype.insert = gate; entered = true;
    try {
      // Public apply catches every native failure. A trivial session may also
      // legitimately disappear, so its state cannot distinguish that failure.
      // Reuse the exact native finalization with errors propagated to our owner.
      controller._doInsert(state.template, { overwriteBefore: 0, overwriteAfter: 0, undoStopBefore: false, undoStopAfter: false, adjustWhitespace: false });
      if (!matched || !gateFinished || controller._session && controller._session !== adoptedSession || !controller._session && expectsLive)
        fail('the native controller rejected the prepared session.');
      state.consumed = true;
    } finally {
      SnippetSession.prototype.insert = original; adoptionInProgress = false;
    }
    return Object.freeze({
      // Bind this callback only after the workspace guard admits whole Undo.
      // A blocked attempt must not terminate the user's live snippet session.
      onUndoDecision(admitted) { if (admitted === true && controller._session === adoptedSession) { controller.cancel(); return true; } return false; },
      cancel() { if (controller._session === adoptedSession) controller.cancel(); },
      get isActive() { return controller._session === adoptedSession && controller.isInSnippet(); },
    });
  } catch (error) {
    if (entered && adoptedSession && controller._session === adoptedSession) controller.cancel();
    dispose(state); throw error;
  }
}

module.exports = { RETAINED_MONACO_VERSION, prepareWorkspaceSnippet, adoptWorkspaceSnippet };
