'use strict';
const installed = new WeakSet();
const retired = Symbol('retired save-as request');
function installOn(prototype, nativeRevert, WidgetOpenHandler) {
    if (installed.has(prototype)) return;
    const saveAs = prototype.saveAs;
    const saveSnapshot = prototype.saveSnapshot;
    prototype.saveAs = async function (widget, options) {
        const service = this;
        const saveable = widget.saveable;
        const document = widget.editor && widget.editor.document;
        const uri = String(widget.getResourceUri());
        const owns = () => !widget.isDisposed && widget.saveable === saveable &&
            (widget.editor && widget.editor.document) === document &&
            String(widget.getResourceUri()) === uri;
        const requireOwner = () => { if (!owns()) throw retired; };
        const proxy = (target, overrides) => new Proxy(target, {
            get(object, key) {
                if (Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key];
                const value = Reflect.get(object, key, object);
                return typeof value === 'function' ? value.bind(object) : value;
            }
        });
        let reported = false;
        const retainSource = () => {
            if (reported) return;
            reported = true;
            // A completed target write is not rolled back or retried. The source
            // is not reverted or replaced if its ownership or version has changed.
            try {
                const message = service.messageService && service.messageService.info(
                    'The target was written. The source changed before completion and was not reverted or replaced; review and save remaining changes.');
                if (message && typeof message.catch === 'function') message.catch(() => {});
            } catch (_) { /* notification failure must not discard user content */ }
        };
        const guardedSnapshot = async (source, target, overwrite) => {
            requireOwner();
            // Plugin editors retain their native, custom save implementation.
            if (typeof saveable.saveAs === 'function' || !document || document.version === undefined) {
                return saveSnapshot.call(service, source, target, overwrite);
            }
            const version = document && document.version;
            const unchanged = () => owns() && document && version !== undefined && document.version === version;
            const beforeWrite = () => { if (!unchanged()) throw retired; };
            let wrote = false;
            let retained = false;
            let reverted = false;
            let completionVersion;
            const files = proxy(service.fileService, {
                exists: async (...args) => {
                    beforeWrite();
                    const result = await service.fileService.exists(...args);
                    beforeWrite();
                    return result;
                },
                createFile: async (...args) => {
                    beforeWrite();
                    const result = await service.fileService.createFile(...args);
                    wrote = true;
                    return result;
                },
                writeFile: async (...args) => {
                    beforeWrite();
                    const result = await service.fileService.writeFile(...args);
                    wrote = true;
                    return result;
                }
            });
            const guardedSaveable = proxy(saveable, {
                revert: async (...args) => {
                    if (!unchanged()) {
                        retained = true;
                        if (wrote) retainSource();
                        return Promise.resolve();
                    }
                    const result = await revertForSaveAs(saveable, args, nativeRevert, () => {
                        retained = true;
                        if (wrote) retainSource();
                    });
                    reverted = true;
                    completionVersion = document.version;
                    return result;
                }
            });
            const sourceFacade = proxy(source, { saveable: guardedSaveable });
            const originalReference = args => {
                if (args[1] && args[1].widgetOptions && args[1].widgetOptions.ref === sourceFacade) {
                    args[1] = { ...args[1], widgetOptions: { ...args[1].widgetOptions, ref: source } };
                }
                return args;
            };
            const mayOpen = () => {
                if (retained || !owns() || (reverted && document.version !== completionVersion)) {
                    if (wrote) retainSource();
                    return false;
                }
                return true;
            };
            const openers = proxy(service.openerService, {
                getOpener: async (...args) => {
                    if (!mayOpen()) return { open: async () => undefined };
                    const opener = await service.openerService.getOpener(...originalReference(args));
                    return proxy(opener, {
                        open: (...openArgs) => {
                            if (!mayOpen()) return undefined;
                            // Native open awaits widget creation before doOpen. Check
                            // again at that final seam, before shell insertion/closeRef.
                            const receiver = WidgetOpenHandler && opener instanceof WidgetOpenHandler
                                ? proxy(opener, {
                                    doOpen: (...args) => mayOpen() ? opener.doOpen(...args) : Promise.resolve()
                                }) : opener;
                            return opener.open.apply(receiver, originalReference(openArgs));
                        }
                    });
                }
            });
            const facade = proxy(service, { fileService: files, openerService: openers });
            return saveSnapshot.call(facade, sourceFacade, target, overwrite);
        };
        const facade = proxy(service, {
            fileDialogService: proxy(service.fileDialogService, {
                showSaveDialog: async (...args) => {
                    requireOwner();
                    const selected = await service.fileDialogService.showSaveDialog(...args);
                    return owns() ? selected : undefined;
                }
            }),
            fileService: proxy(service.fileService, {
                exists: async (...args) => {
                    requireOwner();
                    const result = await service.fileService.exists(...args);
                    requireOwner();
                    return result;
                }
            }),
            confirmOverwrite: async (...args) => {
                requireOwner();
                const result = await service.confirmOverwrite(...args);
                requireOwner();
                return result;
            },
            save: (...args) => { requireOwner(); return service.save(...args); },
            saveSnapshot: guardedSnapshot,
            logger: proxy(service.logger, {
                warn: error => { if (error !== retired) service.logger.warn(error); }
            })
        });
        try {
            return await saveAs.call(facade, widget, options);
        } catch (error) {
            if (error !== retired) throw error;
            return undefined;
        }
    };
    installed.add(prototype);
}

// Preserve the native Monaco revert/sync implementation. A user edit cancels
// that revert's sync token, but native revert otherwise still marks the newest
// version clean after its await. Fence only this Save As call's final clean mark.
async function revertForSaveAs(saveable, args, nativeRevert, onEdited) {
    if (!nativeRevert || saveable.revert !== nativeRevert) return saveable.revert(...args);
    let edited = false;
    const facade = new Proxy(saveable, {
        get(target, key) {
            if (key === 'sync') return async (...syncArgs) => {
                const version = target.version;
                const pending = target.sync(...syncArgs);
                const token = target.syncCancellationTokenSource.token;
                try {
                    return await pending;
                } finally {
                    if (token.isCancellationRequested && target.version !== version) edited = true;
                }
            };
            if (key === 'setDirty') return dirty => {
                if (dirty === false && edited) return target.setDirty(true);
                return target.setDirty(dirty);
            };
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
        }
    });
    const result = await nativeRevert.apply(facade, args);
    if (edited) onEdited();
    return result;
}

function install() {
    const { FilesystemSaveableService } = require('@theia/filesystem/lib/browser/filesystem-saveable-service');
    const { MonacoEditorModel } = require('@theia/monaco/lib/browser/monaco-editor-model');
    const { WidgetOpenHandler } = require('@theia/core/lib/browser/widget-open-handler');
    installOn(FilesystemSaveableService.prototype, MonacoEditorModel.prototype.revert, WidgetOpenHandler);
}
module.exports = { install, installOn };
