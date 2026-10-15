'use strict';

// Native migration retains snapshots and view state. Only its final, id-based
// source close is guarded: an id may have been reused while the factory awaited.
const installed = new WeakSet();
function installOn(prototype, getSaveable) {
    if (installed.has(prototype)) return;
    const applyMove = prototype.applyMove;
    prototype.applyMove = function (resourceUri, widget, event) {
        const shell = this.shell;
        const id = widget.id;
        const saveable = getSaveable(widget);
        const document = widget.editor && widget.editor.document;
        const version = document && document.version;
        const resource = widget.getResourceUri && String(widget.getResourceUri());
        const dirty = saveable && saveable.dirty;
        function ownsSource() {
            if (widget.isDisposed || widget.id !== id || shell.getWidgetById(id) !== widget) return false;
            if (getSaveable(widget) !== saveable) return false;
            if (resource !== (widget.getResourceUri && String(widget.getResourceUri()))) return false;
            const currentDocument = widget.editor && widget.editor.document;
            if (currentDocument !== document || (currentDocument && currentDocument.version !== version)) return false;
            if (saveable && saveable.dirty !== dirty) return false;
            // A custom dirty Saveable without a document version cannot prove
            // that no further typing happened during the asynchronous migration.
            return !(saveable && saveable.dirty && version === undefined);
        }
        const guardedShell = new Proxy(shell, {
            get(target, key) {
                if (key === 'closeWidget') return (closingId, options) => {
                    if (closingId === id && !ownsSource()) return Promise.resolve();
                    return target.closeWidget(closingId, options);
                };
                const value = Reflect.get(target, key, target);
                return typeof value === 'function' ? value.bind(target) : value;
            }
        });
        const facade = new Proxy(this, {
            get(target, key) {
                if (key === 'shell') return guardedShell;
                const value = Reflect.get(target, key, target);
                return typeof value === 'function' ? value.bind(target) : value;
            }
        });
        return applyMove.call(facade, resourceUri, widget, event);
    };
    installed.add(prototype);
}
function install() {
    const { FileSystemFrontendContribution } = require('@theia/filesystem/lib/browser/filesystem-frontend-contribution');
    const { Saveable } = require('@theia/core/lib/browser');
    installOn(FileSystemFrontendContribution.prototype, widget => Saveable.get(widget));
}
module.exports = { install, installOn };
