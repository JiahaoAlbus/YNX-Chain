'use strict';
const installed = new WeakSet();
function installOn(prototype) {
    if (installed.has(prototype)) return;
    const doSave = prototype.doSave;
    prototype.doSave = function (...args) {
        const document = this;
        let captured = false;
        let writtenVersion;
        let writtenModel;
        let newer = false;
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
        return doSave.apply(facade, args);
    };
    installed.add(prototype);
}
function install() {
    const { MonacoEditorModel } = require('@theia/monaco/lib/browser/monaco-editor-model');
    installOn(MonacoEditorModel.prototype);
}
module.exports = { install, installOn };
