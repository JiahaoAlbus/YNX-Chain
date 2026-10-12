// VS Code extensions and keybindings can invoke the familiar command ID.
// The framework already provides the picker, dynamic providers and compounds.
class DebugSelectionContribution {
  constructor(commands, editors, configurations) { Object.assign(this, { commands, editors, configurations }); }
  currentFileCommand(debug) {
    if (this.configurations?.current) return debug ? 'workbench.action.debug.start' : 'workbench.action.debug.run';
    const editor = this.editors?.currentEditor?.editor;
    if (editor?.uri?.scheme !== 'file') return debug ? 'select.debug.configuration' : 'workbench.action.debug.run';
    const language = editor.document?.languageId;
    const pair = {
      c: ['ynx.cpp.runActive', 'ynx.cpp.debugActive'], cpp: ['ynx.cpp.runActive', 'ynx.cpp.debugActive'],
      javascript: ['ynx.js.runActive', 'ynx.js.debugActive'],
      typescript: ['ynx.ts.runActive', 'ynx.ts.debugActive'], typescriptreact: ['ynx.ts.runActive', 'ynx.ts.debugActive'],
      python: ['python.execInTerminal', 'debugpy.debugInTerminal'],
    }[language];
    return pair ? pair[Number(debug)] : debug ? 'select.debug.configuration' : 'workbench.action.debug.run';
  }
  registerCommands(registry) {
    registry.registerCommand({ id: 'workbench.action.debug.selectandstart' }, {
      execute: () => this.commands.executeCommand('select.debug.configuration'),
    });
    for (const [id, debug] of [['ynx.workbench.runCurrentFile', false], ['ynx.workbench.debugCurrentFile', true]]) {
      registry.registerCommand({ id }, {
        execute: () => this.commands.executeCommand(this.currentFileCommand(debug)),
        isEnabled: () => this.commands.isEnabled(this.currentFileCommand(debug)),
      });
    }
  }
}
module.exports = { DebugSelectionContribution };
