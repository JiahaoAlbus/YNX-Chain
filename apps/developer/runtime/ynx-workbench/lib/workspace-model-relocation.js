// Model-only relocation. A coordinator supplies the filesystem transaction and
// fences workspace events/autosave; no URI or ReferenceCollection is rewritten.
const { relocateResources } = require('./workspace-text-edit-adapter');
const marker = Symbol.for('ynx.workspace-text-transaction.v1');
const fields = ['bufferSavedVersionId', 'preferredEncoding', 'contentEncoding', 'resourceVersion', '_dirty', 'suppressOpenEditorWhenDirty'];
const identity = resource => resource.toString();
function documentState(document) {
  const model = document.textEditorModel;
  return { version: model.getVersionId(), alternative: model.getAlternativeVersionId(), value: model.getValue(undefined, true), eol: model.getEOL(), initial: model.getInitialUndoRedoSnapshot(), fields: Object.fromEntries(fields.map(key => [key, document[key]])), changes: document.contentChanges?.slice() };
}
function unchanged(document, saved) {
  const current = documentState(document);
  return !document.isDisposed() && current.version === saved.version && current.alternative === saved.alternative && current.value === saved.value && current.eol === saved.eol && fields.every(key => current.fields[key] === saved.fields[key]) && current.initial === saved.initial;
}
function wrapperState(wrapper) {
  const actual = wrapper.actual;
  const flagState = flags => flags && [...flags.elements].map(([key, value]) => [key, value.resourceLabel, value.reason]);
  return { strResource: wrapper.strResource, resourceLabel: wrapper.resourceLabel, keys: wrapper.strResources.slice(), labels: wrapper.resourceLabels.slice(), removed: flagState(wrapper.removedResources), invalid: flagState(wrapper.invalidatedResources), childMap: actual._editStackElementsMap, children: (actual._editStackElementsArr || [actual]).map(child => [child, child.model]), childEntries: actual._editStackElementsMap && [...actual._editStackElementsMap] };
}
function historySignature(service, keys, wrappers) {
  return { stacks: [...keys].map(key => { const stack = service._editStacks.get(key); return [key, stack, stack?.versionId, stack?._past.slice(), stack?._future.slice()]; }), wrappers: [...wrappers].map(wrapper => [wrapper, wrapperState(wrapper)]) };
}
function historyUnchanged(service, signature) {
  const equalArray = (a, b) => a === b || !!a && !!b && a.length === b.length && a.every((value, index) => Array.isArray(value) ? equalArray(value, b[index]) : value === b[index]);
  return signature.stacks.every(([key, stack, version, past, future]) => service._editStacks.get(key) === stack && (!stack || stack.versionId === version && equalArray(past, stack._past) && equalArray(future, stack._future))) && signature.wrappers.every(([wrapper, saved]) => {
    const current = wrapperState(wrapper);
    return current.strResource === saved.strResource && current.resourceLabel === saved.resourceLabel && current.childMap === saved.childMap && ['keys', 'labels', 'removed', 'invalid', 'children', 'childEntries'].every(key => equalArray(current[key], saved[key]));
  });
}
function cloneFlags(flags, mapping) {
  if (!flags) return flags;
  const copy = Object.create(Object.getPrototypeOf(flags));
  copy.elements = new Map([...flags.elements].map(([key, reason]) => [mapping.get(key)?.key || key, mapping.has(key) ? Object.assign(Object.create(Object.getPrototypeOf(reason)), reason, { resourceLabel: mapping.get(key).uri.fsPath || mapping.get(key).key }) : reason]));
  return copy;
}
function nativePlan(service, entries) {
  const mapping = new Map(entries.map(entry => [identity(entry.oldResource), { key: identity(entry.newResource), uri: entry.newResource, model: entry.target.object.textEditorModel }]));
  const wrappers = new Set(), mutations = [];
  for (const entry of entries) if (service._editStacks.get(identity(entry.oldResource))?.locked) throw Error('An affected undo stack is busy.');
  for (const stack of service._editStacks.values()) for (const wrapper of [...stack._past, ...stack._future]) if (wrapper.strResources.some(key => mapping.has(key))) wrappers.add(wrapper);
  for (const wrapper of wrappers) {
    if (wrapper.actual[marker]?.busy) throw Error('A workspace transaction is busy.');
    const actual = wrapper.actual, children = actual._editStackElementsArr || (typeof actual.setModel === 'function' && actual.resource ? [actual] : undefined);
    if (!children) throw Error('This undo element does not support model resource relocation.');
    const childChanges = children.filter(child => mapping.has(identity(child.resource))).map(child => ({ child, before: child.model, after: mapping.get(identity(child.resource)).model }));
    const before = { strResource: wrapper.strResource, resourceLabel: wrapper.resourceLabel, strResources: wrapper.strResources, resourceLabels: wrapper.resourceLabels, removedResources: wrapper.removedResources, invalidatedResources: wrapper.invalidatedResources, childMap: actual._editStackElementsMap };
    const afterKeys = wrapper.strResources.map(key => mapping.get(key)?.key || key);
    if (new Set(afterKeys).size !== afterKeys.length) throw Error('An undo element has colliding destination resources.');
    mutations.push({ wrapper, actual, childChanges, before, after: { strResources: afterKeys, resourceLabels: wrapper.strResources.map((key, i) => mapping.get(key)?.uri.fsPath || wrapper.resourceLabels[i]), ...(mapping.has(wrapper.strResource) ? { strResource: mapping.get(wrapper.strResource).key, resourceLabel: mapping.get(wrapper.strResource).uri.fsPath } : {}), removedResources: cloneFlags(wrapper.removedResources, mapping), invalidatedResources: cloneFlags(wrapper.invalidatedResources, mapping) }, nextMap: actual._editStackElementsMap && new Map([...actual._editStackElementsMap].map(([key, child]) => [mapping.get(key)?.key || key, child])) });
  }
  const oldStackFields = entries.map(entry => { const key = identity(entry.oldResource), stack = service._editStacks.get(key); return { key, next: identity(entry.newResource), stack, strResource: stack?.strResource, resourceLabel: stack?.resourceLabel }; });
  let applied = false;
  return {
    wrappers,
    apply() {
      applied = true;
      for (const entry of entries) { const old = identity(entry.oldResource), next = identity(entry.newResource), stack = service._editStacks.get(old); if (stack) { service._editStacks.delete(old); stack.strResource = next; stack.resourceLabel = entry.newResource.fsPath || next; service._editStacks.set(next, stack); } }
      for (const mutation of mutations) { Object.assign(mutation.wrapper, mutation.after); if (mutation.nextMap) mutation.actual._editStackElementsMap = mutation.nextMap; for (const change of mutation.childChanges) change.child.setModel(change.after); }
    },
    rollback() {
      if (!applied) return;
      for (const mutation of mutations) { const { childMap, ...wrapperFields } = mutation.before; Object.assign(mutation.wrapper, wrapperFields); if (childMap) mutation.actual._editStackElementsMap = childMap; for (const change of mutation.childChanges) change.child.setModel(change.before); }
      for (const item of oldStackFields) if (item.stack) {
        if (service._editStacks.get(item.next) === item.stack) service._editStacks.delete(item.next);
        service._editStacks.set(item.key, item.stack);
        item.stack.strResource = item.strResource; item.stack.resourceLabel = item.resourceLabel;
      }
      applied = false;
    },
  };
}
async function prepare({ textModelService, undoRedo, mappings, beginFence, captureView, restoreView, runOwned = callback => callback() }) {
  const entries = [], sources = new Set(), destinations = new Set();
  for (const mapping of mappings) {
    const old = identity(mapping.oldResource), next = identity(mapping.newResource);
    if (old === next || sources.has(old) || destinations.has(next)) throw Error('Model relocation has duplicate resource identities.');
    if (undoRedo.getUriComparisonKey(mapping.oldResource) !== old || undoRedo.getUriComparisonKey(mapping.newResource) !== next) throw Error('Model relocation cannot alias another history.');
    if (textModelService.get(next) || undoRedo._editStacks.has(next)) throw Error('Model relocation destination already has a model or undo history.');
    sources.add(old); destinations.add(next);
  }
  if (mappings.length > 2048 || [...destinations].some(key => sources.has(key))) throw Error('Model relocation exceeds its bounds or collides with a source.');
  const fence = await beginFence?.(); let stage = 'preparing', native, records, signature, committedSignature;
  const disposeTargets = () => { for (const entry of entries) entry.target?.dispose(); };
  const releaseSources = () => { for (const entry of entries) entry.source?.dispose(); };
  const closeFence = () => fence?.dispose();
  try {
    for (const mapping of mappings) {
      const source = await textModelService.createModelReference(mapping.oldResource), entry = { ...mapping, source }; entries.push(entry);
      entry.before = documentState(source.object); entry.view = await captureView?.(source.object);
      entry.target = await textModelService.createModelReference(mapping.newResource);
      if (identity(entry.target.object.textEditorModel.uri) !== identity(mapping.newResource) || entry.target.object.uri !== identity(mapping.newResource)) throw Error('Replacement document has a different URI.');
      if (undoRedo._editStacks.has(identity(mapping.newResource))) throw Error('Replacement creation introduced destination history.');
      const document = entry.target.object, model = document.textEditorModel;
      // These are provisional target buffers only. Source models are untouched.
      // setValue creates the native text buffer with its BOM metadata. A range
      // insertion would turn a leading BOM into visible document content.
      runOwned(() => document.updateModel(() => model.setValue(entry.before.value), { ignoreDirty: true, ignoreContentChanges: true }));
      if (model.getEOL() !== entry.before.eol) model.setEOL(entry.before.eol === '\n' ? 0 : 1);
      model._overwriteVersionId(entry.before.version); model._overwriteAlternativeVersionId(entry.before.alternative);
      if (entry.before.initial) { const snapshot = Object.assign(Object.create(Object.getPrototypeOf(entry.before.initial)), entry.before.initial, { resource: mapping.newResource }); model._overwriteInitialUndoRedoSnapshot(snapshot); }
      else model._overwriteInitialUndoRedoSnapshot(null);
      Object.assign(document, entry.before.fields); document.contentChanges = entry.before.changes?.slice() || [];
      if (mapping.resourceVersion !== undefined) document.resourceVersion = mapping.resourceVersion;
      entry.prepared = documentState(document);
    }
    for (const entry of entries) if (!unchanged(entry.source.object, entry.before)) throw Error('A source document changed during relocation preparation.');
    native = nativePlan(undoRedo, entries); signature = historySignature(undoRedo, new Set([...sources, ...destinations]), native.wrappers); stage = 'prepared';
  } catch (error) { disposeTargets(); releaseSources(); closeFence(); throw error; }
  const assertStage = expected => { if (stage !== expected) throw Error('Model relocation is not in the expected lifecycle state.'); };
  const check = migrated => {
    if (!historyUnchanged(undoRedo, migrated ? committedSignature : signature)) throw Error('Undo history changed during model relocation.');
    for (const entry of entries) if (!unchanged(entry.source.object, entry.before) || !unchanged(entry.target.object, entry.prepared)) throw Error('A model changed during relocation.');
    for (const [, stack] of undoRedo._editStacks) if (stack.locked && (sources.has(stack.strResource) || destinations.has(stack.strResource))) throw Error('An affected undo stack is busy.');
    for (const [, stack] of undoRedo._editStacks) for (const wrapper of [...stack._past, ...stack._future]) if (wrapper.actual[marker]?.busy && wrapper.strResources.some(key => sources.has(key) || destinations.has(key))) throw Error('An affected workspace transaction is busy.');
  };
  return {
    entries,
    cancelPreparation() {
      assertStage('prepared');
      // A caller may cancel after source typing invalidates preparation. Never
      // discard a provisional target that itself acquired user text/history.
      for (const entry of entries) if (!unchanged(entry.target.object, entry.prepared) || undoRedo._editStacks.has(identity(entry.newResource))) throw Error('A provisional target changed and must be preserved.');
      stage = 'rolledBack'; disposeTargets(); releaseSources(); closeFence();
    },
    migrate() {
      assertStage('prepared'); check(false);
      try {
        native.apply();
        records = relocateResources(undoRedo, entries.map(entry => ({ oldResource: entry.oldResource, newResource: entry.newResource, model: entry.target.object.textEditorModel })));
        committedSignature = historySignature(undoRedo, new Set([...sources, ...destinations]), native.wrappers); stage = 'migrated';
      } catch (error) { records?.rollback(); native.rollback(); throw error; }
    },
    rollback() {
      if (stage === 'rolledBack') return;
      if (stage !== 'prepared' && stage !== 'migrated') throw Error('Model relocation can no longer roll back.');
      check(stage === 'migrated');
      if (stage === 'migrated') { records.rollback(); native.rollback(); }
      stage = 'rolledBack'; disposeTargets(); releaseSources(); closeFence();
    },
    async finalize() {
      assertStage('migrated'); check(true);
      // The caller must retain target references for editor/document consumers
      // before finalize. View restoration is supplied by the actual UI owner.
      for (const entry of entries) await restoreView?.(entry.target.object, entry.view);
      check(true); stage = 'finalized'; releaseSources(); closeFence();
      return entries.map(entry => entry.target);
    },
  };
}
module.exports = { prepare };
