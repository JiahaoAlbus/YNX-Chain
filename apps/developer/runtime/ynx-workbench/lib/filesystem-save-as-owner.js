'use strict';
const installed = new WeakSet();
const retired = Symbol('retired save-as request');
function installOn(prototype) {
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
                    const result = await saveable.revert(...args);
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
                        open: (...openArgs) => mayOpen() ? opener.open(...originalReference(openArgs)) : undefined
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
function install() {
    const { FilesystemSaveableService } = require('@theia/filesystem/lib/browser/filesystem-saveable-service');
    installOn(FilesystemSaveableService.prototype);
}
module.exports = { install, installOn };
