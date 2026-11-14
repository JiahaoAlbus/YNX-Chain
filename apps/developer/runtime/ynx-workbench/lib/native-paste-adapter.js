let installed = false;

function nativePasteMerge(original, nativeHost) {
  if (typeof original !== 'function') throw Error('Native paste requires the pinned Monaco merge implementation.');
  return function (...args) {
    const transfer = args[1];
    if (!nativeHost() || !transfer || transfer.has('text/uri-list')) return original.apply(this, args);
    // The genuine paste event already supplied its permitted DataTransfer.
    // Monaco's optional URI enrichment otherwise probes navigator.clipboard
    // after provider awaits, opening another WebKit permission menu and holding
    // up even plain text. Keep its provider/metadata/cancellation implementation,
    // but never supplement this native event with an ambient clipboard read.
    // Scope the receiver to this invocation: concurrent editors and the shared
    // clipboard service are not mutated. Event URI data and provider-produced
    // URI data still take their original upstream route.
    const service = Object.create(this._clipboardService);
    Object.defineProperty(service, 'readResources', { value: async () => [] });
    const receiver = Object.create(this);
    Object.defineProperty(receiver, '_clipboardService', { value: service });
    return original.apply(receiver, args);
  };
}

function install() {
  if (installed) return;
  const { CopyPasteController } = require('@theia/monaco-editor-core/esm/vs/editor/contrib/dropOrPasteInto/browser/copyPasteController');
  CopyPasteController.prototype.mergeInDataFromCopy = nativePasteMerge(
    CopyPasteController.prototype.mergeInDataFromCopy,
    () => typeof window !== 'undefined' && !!window.webkit?.messageHandlers?.ynxLocalWorkbench,
  );
  installed = true;
}
module.exports = { install, nativePasteMerge };
