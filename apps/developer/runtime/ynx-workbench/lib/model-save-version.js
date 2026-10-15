'use strict';
const installed = new WeakSet();
function installOn(prototype, reportError = failure => saveErrorReporter && saveErrorReporter(failure)) {
    if (installed.has(prototype)) return;
    const doSave = prototype.doSave;
    prototype.doSave = async function (...args) {
        const document = this;
        const resourceUri = this.resource && this.resource.uri;
        let captured = false;
        let writtenVersion;
        let writtenModel;
        let newer = false;
        let currentResource;
        let fullResource;
        const models = new WeakMap();
        const modelFacade = model => {
            if (!models.has(model)) models.set(model, new Proxy(model, {
                get(target, key) {
                    if (key === 'getAlternativeVersionId') return () => {
                        const version = target.getAlternativeVersionId();
                        if (!captured) {
                            captured = true;
                            writtenVersion = version;
                            writtenModel = target;
                        }
                        return version;
                    };
                    const value = Reflect.get(target, key, target);
                    return typeof value === 'function' ? value.bind(target) : value;
                }
            }));
            return models.get(model);
        };
        const facade = new Proxy(document, {
            get(target, key) {
                if (key === 'model') return modelFacade(target.model);
                if (key === 'resource') {
                    if (currentResource !== target.resource) {
                        currentResource = target.resource;
                        fullResource = new Proxy(currentResource, {
                            get(resource, property) {
                                // No public incremental error proves no write occurred.
                                // Choose the original complete save before any I/O,
                                // rather than attempting delta then replaying on error.
                                if (property === 'saveContentChanges') return undefined;
                                const value = Reflect.get(resource, property, resource);
                                return typeof value === 'function' ? value.bind(resource) : value;
                            }
                        });
                    }
                    return fullResource;
                }
                if (key === 'setDirty') return dirty => {
                    if (!dirty && captured &&
                        (target.model !== writtenModel || target.model.getAlternativeVersionId() !== writtenVersion)) {
                        newer = true;
                        // Use the native saved-version update against the exact
                        // acknowledged snapshot, rather than marking new typing saved.
                        if (target.model === writtenModel) {
                            const snapshotModel = new Proxy(writtenModel, {
                                get(model, property) {
                                    if (property === 'getAlternativeVersionId') return () => writtenVersion;
                                    const value = Reflect.get(model, property, model);
                                    return typeof value === 'function' ? value.bind(model) : value;
                                }
                            });
                            const snapshotDocument = new Proxy(target, {
                                get(object, property) {
                                    return property === 'model' ? snapshotModel : Reflect.get(object, property, object);
                                }
                            });
                            target.updateSavedVersionId.call(snapshotDocument);
                        }
                        return target.setDirty(true);
                    }
                    return target.setDirty(dirty);
                };
                if (key === 'fireDidSaveModel') return (...values) => {
                    if (!newer) return target.fireDidSaveModel(...values);
                };
                const value = Reflect.get(target, key, target);
                return typeof value === 'function' ? value.bind(target) : value;
            }
        });
        try {
            return await doSave.apply(facade, args);
        } catch (error) {
            try {
                const notice = reportError && reportError({ error, resourceUri });
                if (notice && typeof notice.catch === 'function') notice.catch(() => {});
            } catch (_) { /* keep the original save failure, including UNKNOWN */ }
            throw error;
        }
    };
    installed.add(prototype);
}

let saveErrorReporter;
function setErrorReporter(reporter) {
    saveErrorReporter = reporter;
    return () => { if (saveErrorReporter === reporter) saveErrorReporter = undefined; };
}
function connectSaveErrors(messages) {
    return setErrorReporter(({ resourceUri }) => {
        const name = resourceUri && resourceUri.path ? resourceUri.path.base : 'file';
        return messages.error('Could not confirm saving "' + name +
            '". Your changes remain unsaved. Check the destination before saving again.');
    });
}


const saveAllInstalled = new WeakSet();
function installSaveAllOn(prototype, getSaveable) {
    if (saveAllInstalled.has(prototype)) return;
    const saveAll = prototype.saveAll;
    prototype.saveAll = function (...args) {
        const shell = this;
        const service = shell.saveableService;
        const attempted = new Set();
        const guardedService = new Proxy(service, {
            get(target, key) {
                if (key === 'save') return (widget, ...options) => {
                    const saveable = getSaveable(widget);
                    if (saveable && attempted.has(saveable)) return Promise.resolve();
                    if (saveable) attempted.add(saveable);
                    return target.save(widget, ...options);
                };
                const value = Reflect.get(target, key, target);
                return typeof value === 'function' ? value.bind(target) : value;
            }
        });
        const facade = new Proxy(shell, {
            get(target, key) {
                if (key === 'saveableService') return guardedService;
                const value = Reflect.get(target, key, target);
                return typeof value === 'function' ? value.bind(target) : value;
            }
        });
        return saveAll.apply(facade, args);
    };
    saveAllInstalled.add(prototype);
}

function install() {
    const { ApplicationShell } = require('@theia/core/lib/browser/shell/application-shell');
    const { Saveable } = require('@theia/core/lib/browser/saveable');
    installSaveAllOn(ApplicationShell.prototype, widget => Saveable.get(widget));
    const { MonacoEditorModel } = require('@theia/monaco/lib/browser/monaco-editor-model');
    installOn(MonacoEditorModel.prototype, failure => saveErrorReporter && saveErrorReporter(failure));
}
module.exports = { install, installOn, installSaveAllOn, setErrorReporter, connectSaveErrors };
