'use strict';
const { TerminalWidgetImpl } = require('@theia/terminal/lib/browser/terminal-widget-impl');
const completed = new WeakMap();
const ATTRIBUTE = 'ynx-debug-terminal-creation';
class PythonTerminalWidget extends TerminalWidgetImpl {
  get ownedPythonCreation() { return this.options?.isPseudoTerminal === true ? this.options.attributes?.[ATTRIBUTE] : undefined; }
  sealOwnedPythonResult(capability) {
    if (this.ownedPythonCreation !== capability || this.isDisposed || this.exitStatus?.reason !== 2) throw Error('Python terminal result is not the completed owned process.');
    completed.set(this, { capability, status: this.exitStatus });
  }
  dispose() {
    // Retained dispose tests !exitStatus.code, which treats exit0 as still live.
    // The actual Process status has already arrived through TerminalWatcher.
    // Only that explicitly sealed owned terminal bypasses backend close again.
    const result = completed.get(this);
    if (result) { this.closeOnDispose = false; this.exitStatus = result.status; }
    return super.dispose();
  }
}
module.exports = { PythonTerminalWidget };
