// A short-lived, URI-scoped fence. The coordinator owns the transaction and
// widget migration; this module never moves files or mutates model history.
const active = new WeakSet();
const uriOf = value => value?.uri?.toString() || value?.toString();
async function begin({ affectedResources, recursiveResources = [], documents = [], textModelService, workspace, fileSystemContribution, isOwnedOperation = () => false, onError = () => {} }) {
  // Finish operations already queued before acquisition. The coordinator has
  // not started filesystem/model mutation until this async begin resolves.
  await Promise.all(documents.map(document => document.pendingOperation).filter(Boolean));
  const exact = new Set(affectedResources.map(uriOf)), recursive = recursiveResources.map(uriOf), restorations = [], attached = new Set(), deferred = [], syncs = new Set();
  let held = true, owned = 0, releasePromise;
  const affected = resource => { const key = uriOf(resource); return exact.has(key) || recursive.some(root => key === root || key?.startsWith(root.replace(/\/$/, '') + '/')); };
  const patch = (object, name, wrap) => {
    if (typeof object?.[name] !== 'function') throw Error('Review the retained event fence method: ' + name);
    const own = Object.prototype.hasOwnProperty.call(object, name), original = object[name], installed = wrap(original);
    object[name] = installed; restorations.push(() => { if (object[name] !== installed) throw Error('Event fence method changed before release: ' + name); if (own) object[name] = original; else delete object[name]; });
  };
  const queue = (document, kind, invoke) => new Promise((resolve, reject) => deferred.push({ document, kind, invoke, resolve, reject }));
  function attach(document) {
    if (!affected(document) || attached.has(document)) return;
    if (active.has(document)) throw Error('An affected document already has an event fence.');
    active.add(document); attached.add(document); restorations.push(() => active.delete(document));
    for (const name of ['sync', 'scheduleSave', 'doSync', 'doSave']) patch(document, name, original => function (...args) {
      if (!held || owned) return original.apply(this, args);
      if (name === 'sync' || name === 'doSync') { syncs.add(document); return queue(document, 'sync', () => undefined); }
      return queue(document, 'save', () => original.apply(this, args));
    });
    patch(document, 'updateModel', original => function (callback, options) {
      // A sync already in flight before begin can reach this method after its
      // resource read resolves. Re-read after release rather than replay stale
      // captured disk text. Ordinary user edits continue and retire the batch.
      if (held && !owned && options?.ignoreDirty) { syncs.add(document); return undefined; }
      return original.call(this, callback, options);
    });
    for (const name of ['saveContents', 'saveContentsChanges']) if (typeof document.resource?.[name] === 'function') patch(document.resource, name, original => function (...args) {
      return held && !owned ? queue(document, 'save', () => original.apply(this, args)) : original.apply(this, args);
    });
  }
  const ownedOperation = event => isOwnedOperation(event) && [event?.source, event?.target, event?.resource].some(affected);
  try {
    if (workspace) {
      for (const name of ['fireDidOpen', 'fireDidClose', 'openEditorIfDirty']) patch(workspace, name, original => function (document, ...args) {
        if (!held || !affected(document)) return original.call(this, document, ...args);
        attach(document); deferred.push({ document, kind: name, invoke: () => original.call(this, document, ...args) });
      });
    }
    if (fileSystemContribution) {
      for (const name of ['pushMove', 'applyMove', 'revertMove']) patch(fileSystemContribution, name, original => function (resource, widget, event) {
        return held && affected(resource) && ownedOperation(event) ? Promise.resolve() : original.call(this, resource, widget, event);
      });
      patch(fileSystemContribution, 'updateWidget', original => function (resource, ...args) {
        if (!held || !affected(resource)) return original.call(this, resource, ...args);
        deferred.push({ kind: 'watch', invoke: () => original.call(this, resource, ...args) });
      });
    }
    for (const document of documents) attach(document);
    const created = textModelService?.onDidCreate?.(attach); if (created) restorations.push(() => created.dispose());
  } catch (error) {
    held = false; for (const restore of restorations.reverse()) { try { restore(); } catch (cleanup) { onError(cleanup); } }
    for (const item of deferred) item.reject?.(error); throw error;
  }
  return {
    affected, attach,
    runOwned(callback) {
      if (callback.constructor?.name === 'AsyncFunction') throw Error('Event fence owned writes must be synchronous.');
      owned++; try { const result = callback(); if (result?.then) throw Error('Event fence owned writes must be synchronous.'); return result; } finally { owned--; }
    },
    release({ outcome = 'rollback', redirectDocument, publishLifecycle } = {}) {
      if (releasePromise) return releasePromise;
      let settle, fail;
      releasePromise = new Promise((resolve, reject) => { settle = resolve; fail = reject; });
      held = false;
      // Restore first, even if callbacks fail. Unrelated methods and histories
      // were never held, and queued calls are settled independently.
      const errors = [];
      for (const restore of restorations.reverse()) { try { restore(); } catch (error) { errors.push(error); onError(error); } }
      (async () => {
        for (const item of deferred) {
          if (item.kind === 'sync') continue;
          try {
            const replacement = outcome === 'commit' && item.document ? redirectDocument?.(item.document) : undefined;
            if (item.document?.isDisposed() && !replacement && item.kind !== 'fireDidClose') { item.resolve?.(); continue; }
            let value;
            if (item.kind === 'sync') value = undefined;
            else if (replacement && item.kind === 'save') value = await replacement.save();
            else if (['fireDidOpen','fireDidClose','openEditorIfDirty','watch'].includes(item.kind)) {
              // Commit lifecycle/watch events are reconciled by the coordinator
              // against final widgets, not replayed through default move logic.
              if (outcome === 'commit' || item.kind === 'watch') {
                if (!publishLifecycle) throw Error('Reconcile affected lifecycle/watch events against final resources before releasing this fence.');
                value = await publishLifecycle(item);
              }
              else value = await item.invoke();
            } else value = await item.invoke();
            item.resolve?.(value);
          } catch (error) { item.reject?.(error); errors.push(error); onError(error); }
        }
        for (const document of syncs) {
          const replacement = outcome === 'commit' ? redirectDocument?.(document) : undefined, current = replacement || document;
          try {
            if (!current.isDisposed()) await current.sync();
            for (const item of deferred) if (item.kind === 'sync' && item.document === document) item.resolve();
          } catch (error) {
            for (const item of deferred) if (item.kind === 'sync' && item.document === document) item.reject(error);
            onError(error);
          }
        }
        if (errors.length) throw errors[0];
      })().then(settle, fail);
      return releasePromise;
    },
    dispose() { this.release().catch(onError); },
  };
}
module.exports = { begin };
