// Preserve one ordinary cross-file text edit as one Monaco workspace undo
// element. Upstream Theia 1.76 applies each resource to a separate text stack.
function deferModels(models, warn) {
  for (const model of models) { model._eventEmitter.beginDeferredEmit(); model._onDidChangeDecorations.beginDeferredEmit(); }
  return () => {
    for (const model of models) {
      try { model._eventEmitter.endDeferredEmit(); } catch (error) { warn('Workspace text transaction completed, but a document listener failed: ' + error.message); }
      try { model._onDidChangeDecorations.endDeferredEmit(); } catch (error) { warn('Workspace text transaction completed, but a decoration listener failed: ' + error.message); }
    }
  };
}
function copyFlags(value) { if (!value) return null; const copy = new value.constructor(); copy.elements = new Map(value.elements); return copy; }
function historyResources(service, resources) {
  const pending = [...resources], result = new Map();
  for (const resource of pending) {
    const key = service.getUriComparisonKey(resource);
    if (result.has(key)) continue;
    result.set(key, resource);
    for (const entry of service._editStacks.get(key)?._future || []) if (entry.actual?.[transactionMarker]) pending.push(...entry.actual.resources);
  }
  return [...result.values()];
}
function snapshotHistory(service, resources) {
  const stacks = new Map(), flags = new Map();
  for (const resource of resources) {
    const key = service.getUriComparisonKey(resource), stack = service._editStacks.get(key);
    stacks.set(key, stack ? { stack, past: stack._past.slice(), future: stack._future.slice(), versionId: stack.versionId } : undefined);
    if (stack) for (const element of [...stack._past, ...stack._future]) if (element.type === 1 && !flags.has(element)) flags.set(element, { removedResources: copyFlags(element.removedResources), invalidatedResources: copyFlags(element.invalidatedResources) });
  }
  return { stacks, flags };
}
function restoreHistory(service, snapshot) {
  for (const [key, saved] of snapshot.stacks) {
    if (!saved) service._editStacks.delete(key);
    else { Object.assign(saved.stack, { _past: saved.past, _future: saved.future, versionId: saved.versionId }); service._editStacks.set(key, saved.stack); }
  }
  for (const [element, flags] of snapshot.flags) Object.assign(element, flags);
}
const transactionMarker = Symbol.for('ynx.workspace-text-transaction.v1');
const installedMarker = Symbol.for('ynx.workspace-text-undo-service.v1');
let notification;
const sameRange = (a, b) => ['startLineNumber', 'startColumn', 'endLineNumber', 'endColumn'].every(key => a[key] === b[key]);
function state(model) { return { value: model.getValue(), eol: model.getEOL(), alternativeVersion: model.getAlternativeVersionId() }; }
async function readClosedDocument(fileService, resource, encoding) {
  // Use the same text decoding as FileResource/MonacoEditorModel, rather than
  // interpreting raw bytes as UTF-8. TextModel.getValue excludes its BOM.
  return (await fileService.read(resource, { encoding, acceptTextOnly: true })).value.replace(/^\uFEFF/, '');
}
function matches(model, expected) { return !model.isDisposed() && model.getAlternativeVersionId() === expected.alternativeVersion && model.getEOL() === expected.eol && model.getValue() === expected.value; }
function refuse(message, warn) { warn(message); return { returnValue: undefined }; }
function relocateResources(service, mappings) {
  const bySource = new Map(), destinations = new Set(), elements = new Set();
  for (const mapping of mappings) {
    const source = mapping.oldResource?.toString(), destination = mapping.newResource?.toString();
    if (!source || !destination || source === destination || bySource.has(source) || destinations.has(destination)) throw Error('Workspace resource relocation has duplicate or invalid identities.');
    if (mapping.model !== undefined && (mapping.model.isDisposed() || mapping.model.uri.toString() !== destination)) throw Error('Workspace resource relocation model URI does not match its destination.');
    if (service.getUriComparisonKey(mapping.oldResource) !== source || service.getUriComparisonKey(mapping.newResource) !== destination) throw Error('Workspace resource relocation cannot alias another undo history.');
    bySource.set(source, mapping); destinations.add(destination);
  }
  for (const stack of service._editStacks.values()) for (const wrapper of [...stack._past, ...stack._future]) if (wrapper.actual?.[transactionMarker]) elements.add(wrapper.actual);
  const changes = [], transactions = new Set();
  for (const element of elements) {
    const transaction = element[transactionMarker], resulting = new Set();
    for (const row of transaction.records) {
      const source = row.resource.toString(), mapping = bySource.get(source), destination = mapping?.newResource.toString() || source;
      if (resulting.has(destination) || !mapping && destinations.has(source)) throw Error('Workspace resource relocation collides with another captured resource.');
      resulting.add(destination);
      if (!mapping) continue;
      if (transaction.busy) throw Error('A workspace transaction is busy and cannot relocate resources.');
      if (!element.matchesResource(mapping.newResource) || ![...service.getElements(mapping.newResource).past, ...service.getElements(mapping.newResource).future].includes(element)) throw Error('Native workspace history must be rekeyed before relocating captured resources.');
      const child = element._editStackElementsArr.find(item => item.resource.toString() === destination);
      if (!child || mapping.model !== undefined && child.model !== mapping.model || mapping.model === undefined && child.model.uri && !child.model.isDisposed()) throw Error('Workspace resource relocation model does not match its native child binding.');
      changes.push({ row, resource: row.resource, model: row.model, nextResource: mapping.newResource, nextModel: mapping.model }); transactions.add(transaction);
    }
  }
  // Validation is complete. No buffers, native stacks or reference collections
  // are changed here; the coordinator owns their fenced migration and rollback.
  for (const change of changes) { change.row.resource = change.nextResource; change.row.model = change.nextModel; }
  let rolledBack = false;
  return {
    recordsChanged: changes.length, elementsChanged: transactions.size,
    rollback() {
      if (rolledBack) return;
      for (const transaction of transactions) if (transaction.busy) throw Error('A busy workspace transaction cannot roll back resource relocation.');
      for (const change of changes) if (change.row.resource !== change.nextResource || change.row.model !== change.nextModel) throw Error('Workspace resource relocation changed before rollback.');
      for (const change of changes) { change.row.resource = change.resource; change.row.model = change.model; }
      rolledBack = true;
    },
  };
}
function installUndoGuards(service, warn) {
  if (service[installedMarker]) return;
  for (const name of ['_undo', '_redo', '_checkWorkspaceUndo', '_checkWorkspaceRedo', '_tryToSplitAndUndo', '_tryToSplitAndRedo']) {
    if (typeof service[name] !== 'function') throw Error('Review the retained Monaco workspace undo contract before installing YNX transactions.');
  }
  for (const direction of ['undo', 'redo']) {
    const entry = direction === 'undo' ? '_undo' : '_redo', original = service[entry];
    service[entry] = async function (resource, ...args) {
      const stack = this._editStacks.get(resource);
      const element = stack?.[direction === 'undo' ? 'getClosestPastElement' : 'getClosestFutureElement']()?.actual, transaction = element?.[transactionMarker];
      if (!transaction) return original.call(this, resource, ...args);
      if (transaction.busy) { warn('This workspace edit is already being restored.'); return; }
      transaction.busy = true; let references = [];
      try {
        references = await transaction.acquire(direction);
        transaction.assertReady(direction);
        return await original.call(this, resource, ...args);
      } catch (error) { warn(`Cannot ${direction} the workspace edit: ${error.message} No files or undo history were changed.`); }
      finally { for (const reference of references) reference.dispose(); transaction.busy = false; }
    };
    const check = direction === 'undo' ? '_checkWorkspaceUndo' : '_checkWorkspaceRedo', originalCheck = service[check];
    service[check] = function (resource, element, ...args) {
      const transaction = element.actual?.[transactionMarker];
      if (transaction) {
        try { transaction.assertReady(direction); }
        catch (error) { return refuse(`Cannot ${direction} the workspace edit: ${error.message} No files or undo history were changed.`, warn); }
      }
      return originalCheck.call(this, resource, element, ...args);
    };
    const split = direction === 'undo' ? '_tryToSplitAndUndo' : '_tryToSplitAndRedo', originalSplit = service[split];
    service[split] = function (resource, element, ...args) {
      if (element.actual?.[transactionMarker]) return refuse(`Cannot ${direction} the entire workspace edit safely. Preserve all files and undo later changes first. Undo history was preserved.`, warn);
      return originalSplit.call(this, resource, element, ...args);
    };
  }
  const push = service._pushElement;
  service._pushElement = function (element) {
    const abandoned = new Set();
    for (const key of element.strResources) for (const future of this._editStacks.get(key)?._future || []) if (future.actual?.[transactionMarker]) abandoned.add(future);
    const result = push.call(this, element);
    // New typing retires an owned workspace redo branch in every file, along
    // with newer redo entries that depend on replaying that branch first.
    for (const future of abandoned) for (const key of future.strResources) {
      const stack = this._editStacks.get(key), index = stack?._future.indexOf(future) ?? -1;
      if (index < 0) continue;
      for (const removed of stack._future.splice(0, index + 1)) if (removed.type === 1) removed.removeResource(stack.resourceLabel, key, 1);
      stack.versionId++;
    }
    return result;
  };
  Object.defineProperty(service, installedMarker, { value: true });
}
function assertSupported(edits, ResourceTextEdit) {
  const resources = new Set();
  for (const edit of edits) for (const resource of [edit.resource, edit.oldResource, edit.newResource]) if (resource) resources.add(resource.toString());
  if (resources.size > 1 && edits.some(edit => !(edit instanceof ResourceTextEdit) || edit.textEdit.insertAsSnippet))
    throw Error('Atomic workspace undo for mixed file operations or cross-file snippets is not available yet. No files were changed.');
}
async function applyTextTransaction(workspace, edits, dependencies) {
  const { URI, Range, SingleModelEditStackElement, MultiModelEditStackElement, undoRedo, minimalEdits, selections, warn, readClosed } = dependencies;
  const byResource = new Map();
  for (const edit of edits) { const key = edit.resource.toString(); if (!byResource.has(key)) byResource.set(key, []); byResource.get(key).push(edit); }
  if (byResource.size > 2048) throw Error('A workspace text edit exceeds 2048 resources. No files were changed.');
  const references = [], prepared = []; let characters = 0, resultCharacters = 0;
  try {
    // All model resolution and worker work precedes any stack or buffer edit.
    for (const [key, values] of byResource) {
      const reference = await workspace.textModelService.createModelReference(URI.parse(key)); references.push(reference);
      const document = reference.object, model = document.textEditorModel, version = model.getVersionId(), before = state(model);
      if (values.some(edit => typeof edit.versionId === 'number' && edit.versionId !== version)) throw Error('A workspace edit target changed. Review the edits again.');
      if ((characters += before.value.length) > 8 * 1024 * 1024) throw Error('Workspace text edit models exceed 16 MiB of UTF-16 text. No files were changed.');
      const transformed = values.map(edit => workspace.transformSnippetStringToInsertText(edit));
      const minimal = await minimalEdits(model.uri, transformed);
      const operations = []; let eol;
      for (const edit of minimal || []) {
        if (typeof edit.eol === 'number') eol = edit.eol;
        if (Range.isEmpty(edit.range) && !edit.text) continue;
        if (edit.text != null && typeof edit.text !== 'string') throw Error('A workspace text edit contains invalid text. No files were changed.');
        const range = Range.lift(edit.range);
        if (!sameRange(range, model.validateRange(range))) throw Error('A workspace edit range is outside its document. No files were changed.');
        operations.push({ forceMoveMarkers: false, range, text: edit.text });
      }
      if (!operations.length && eol === undefined) continue;
      if (eol !== undefined && eol !== 0 && eol !== 1) throw Error('A workspace edit line-ending choice is invalid. No files were changed.');
      const ordered = operations.slice().sort((a, b) => a.range.startLineNumber - b.range.startLineNumber || a.range.startColumn - b.range.startColumn);
      for (let index = 1; index < ordered.length; index++) {
        const previous = ordered[index - 1].range, next = ordered[index].range;
        if (previous.endLineNumber > next.startLineNumber || previous.endLineNumber === next.startLineNumber && previous.endColumn > next.startColumn) throw Error('Workspace edit ranges overlap. No files were changed.');
      }
      let resultingSize = before.value.length;
      for (const operation of operations) resultingSize += (operation.text || '').replace(/\r?\n/g, model.getEOL()).length - model.getValueInRange(operation.range).length;
      if (eol !== undefined && (eol === 0 ? '\n' : '\r\n') !== model.getEOL()) resultingSize += (eol === 1 ? 1 : -1) * (model.getLineCount() - 1);
      if ((resultCharacters += resultingSize) > 8 * 1024 * 1024) throw Error('Workspace text edit results exceed 16 MiB of UTF-16 text. No files were changed.');
      prepared.push({ model, version, before, initialUndoRedoSnapshot: model.getInitialUndoRedoSnapshot(), operations, eol, encoding: document.getEncoding?.(), cursor: selections(document) });
    }
    if (!prepared.length) return { totalEdits: 0, totalFiles: 0 };
    for (const row of prepared) if (row.model.getVersionId() !== row.version || !matches(row.model, row.before)) throw Error('A workspace edit target changed during preparation. No files were changed.');
    // No mutation until all resources are prepared. Content events are held
    // across every model, including both forward edit and undo/redo.
    for (const row of prepared) if (!row.model._eventEmitter?.beginDeferredEmit || !row.model._onDidChangeDecorations?.beginDeferredEmit) throw Error('Review the retained model event transaction contract.');
    // Prepare a typing boundary without closing the prior element yet: a
    // failed commit must preserve its original data and append state.
    const priorTyping = new Map();
    for (const row of prepared) {
      const prior = undoRedo.getElements(row.model.uri).past.at(-1);
      if (prior instanceof SingleModelEditStackElement && typeof prior._data.serialize === 'function') priorTyping.set(prior, prior._data.serialize());
    }
    const children = prepared.map(row => new SingleModelEditStackElement('Workspace edit', 'ynx.workspaceTextEdit', row.model, row.cursor));
    const element = new MultiModelEditStackElement('Workspace edit', 'ynx.workspaceTextEdit', children);
    // Our workspace operation cannot be downgraded to a per-file undo.
    element.split = undefined;
    const records = prepared.map(row => ({ resource: row.model.uri, model: row.model, encoding: row.encoding, before: row.before, after: undefined }));
    const transaction = {
      busy: false,
      records,
      async acquire(direction) {
        const acquired = [];
        try {
          for (const row of records) {
            if (!row.model || row.model.isDisposed()) {
              const expected = direction === 'undo' ? row.after : row.before;
              if (!readClosed || await readClosed(row.resource, row.encoding) !== expected.value) throw Error('A closed affected file changed or is unavailable.');
            }
            const reference = await workspace.textModelService.createModelReference(row.resource); acquired.push(reference);
            const model = reference.object.textEditorModel;
            if (model.uri.toString() !== row.resource.toString()) throw Error('A workspace edit resource changed identity.');
            element.setModel(model);
          }
          return acquired;
        } catch (error) { for (const reference of acquired) reference.dispose(); throw error; }
      },
      assertReady(direction) {
        const side = direction === 'undo' ? 'past' : 'future', expected = direction === 'undo' ? 'after' : 'before';
        for (const row of records) {
          if (undoRedo.getElements(row.resource)[side].at(-1) !== element) throw Error('Another affected file has later edits or a changed undo history.');
          if (!row.model || !matches(row.model, row[expected])) throw Error('An affected file changed or is unavailable.');
        }
      },
    };
    const setModel = element.setModel.bind(element);
    element.setModel = model => { setModel(model); const key = model.uri?.toString() || model.toString(), row = records.find(item => item.resource.toString() === key); if (row) row.model = model.uri ? model : undefined; };
    Object.defineProperty(element, transactionMarker, { value: transaction });
    installUndoGuards(undoRedo, warn);
    for (const direction of ['undo', 'redo']) {
      const original = element[direction].bind(element);
      element[direction] = () => { const publish = deferModels(records.map(row => row.model), warn); try { return original(); } finally { publish(); } };
    }
    const restoreEvents = deferModels(prepared.map(row => row.model), warn);
    const history = snapshotHistory(undoRedo, historyResources(undoRedo, records.map(row => row.resource)));
    try {
      for (let index = 0; index < prepared.length; index++) {
        const row = prepared[index], inverse = row.operations.length ? row.model.applyEdits(row.operations, true) : [];
        const changes = inverse.map((operation, order) => ({ change: operation.textChange, order })).sort((a, b) => a.change.oldPosition - b.change.oldPosition || a.order - b.order).map(row => row.change);
        children[index].append(row.model, changes, row.model.getEOL() === '\n' ? 0 : 1, row.model.getAlternativeVersionId(), row.cursor);
        if (row.eol !== undefined) {
          row.model.setEOL(row.eol);
          children[index].append(row.model, [], row.eol, row.model.getAlternativeVersionId(), row.cursor);
        }
      }
      element.close();
      for (const row of records) row.after = state(row.model);
      for (const row of prepared) {
        if (row.model.getInitialUndoRedoSnapshot() === null) row.model._overwriteInitialUndoRedoSnapshot(undoRedo.createSnapshot(row.model.uri));
      }
      undoRedo.pushElement(element, dependencies.undoRedoGroup, dependencies.undoRedoSource);
      for (const [prior, closedData] of priorTyping) prior._data = closedData;
    } catch (error) {
      for (const row of prepared) {
        if (row.model.getValue() !== row.before.value) (dependencies.rollbackEdits || ((model, edits) => model.applyEdits(edits)))(row.model, [{ range: row.model.getFullModelRange(), text: row.before.value }]);
        if (row.model.getEOL() !== row.before.eol) row.model.setEOL(row.before.eol === '\n' ? 0 : 1);
        row.model._overwriteAlternativeVersionId(row.before.alternativeVersion);
        row.model._overwriteInitialUndoRedoSnapshot(row.initialUndoRedoSnapshot);
      }
      restoreHistory(undoRedo, history);
      throw error;
    } finally { restoreEvents(); }
    return { totalEdits: prepared.reduce((count, row) => count + row.operations.length, 0), totalFiles: prepared.length };
  } finally { for (const reference of references) reference.dispose(); }
}
function install() {
  const { MonacoWorkspace } = require('@theia/monaco/lib/browser/monaco-workspace');
  if (MonacoWorkspace.prototype[transactionMarker]) return;
  const { StandaloneServices } = require('@theia/monaco-editor-core/esm/vs/editor/standalone/browser/standaloneServices');
  const { IUndoRedoService } = require('@theia/monaco-editor-core/esm/vs/platform/undoRedo/common/undoRedo');
  const { IEditorWorkerService } = require('@theia/monaco-editor-core/esm/vs/editor/common/services/editorWorker');
  const { URI } = require('@theia/monaco-editor-core/esm/vs/base/common/uri');
  const { Range } = require('@theia/monaco-editor-core/esm/vs/editor/common/core/range');
  const { SingleModelEditStackElement, MultiModelEditStackElement } = require('@theia/monaco-editor-core/esm/vs/editor/common/model/editStack');
  const { ResourceTextEdit } = require('@theia/monaco-editor-core/esm/vs/editor/browser/services/bulkEditService');
  const { TextModel } = require('@theia/monaco-editor-core/esm/vs/editor/common/model/textModel');
  const TheiaURI = require('@theia/core/lib/common/uri').default;
  const { MonacoEditor } = require('@theia/monaco/lib/browser/monaco-editor');
  const originalBulk = MonacoWorkspace.prototype.applyBulkEdit, originalText = MonacoWorkspace.prototype.performTextEdits;
  if (typeof originalBulk !== 'function' || typeof originalText !== 'function') throw Error('Review the Theia workspace edit contract before installing YNX transactions.');
  MonacoWorkspace.prototype.applyBulkEdit = function (edits, options) { assertSupported(edits, ResourceTextEdit); return originalBulk.call(this, edits, options); };
  MonacoWorkspace.prototype.performTextEdits = function (edits) {
    if (new Set(edits.map(edit => edit.resource.toString())).size < 2) return originalText.call(this, edits);
    const undoRedo = StandaloneServices.get(IUndoRedoService);
    return applyTextTransaction(this, edits, { URI, Range, SingleModelEditStackElement, MultiModelEditStackElement, undoRedo,
      readClosed: (resource, encoding) => readClosedDocument(this.fileService, TheiaURI.fromComponents(resource), encoding),
      rollbackEdits: (model, edits) => TextModel.prototype.applyEdits.call(model, edits),
      minimalEdits: (uri, values) => StandaloneServices.get(IEditorWorkerService).computeMoreMinimalEdits(uri, values),
      selections: document => MonacoEditor.findByDocument(this.editorManager, document)[0]?.getControl().getSelections() || [],
      warn: message => notification ? notification(message) : undoRedo._notificationService.warn(message),
    });
  };
  Object.defineProperty(MonacoWorkspace.prototype, transactionMarker, { value: true });
}
module.exports = { install, setNotification: notify => { notification = notify; }, applyTextTransaction, assertSupported, readClosedDocument, relocateResources };
