// VS Code extensions and keybindings can invoke the familiar command ID.
// The framework already provides the picker, dynamic providers and compounds.
class DebugSelectionContribution {
  constructor(commands, editors, configurations) { Object.assign(this, { commands, editors, configurations }); }
  currentFileCommand(debug) {
    if (this.configurations?.current) return debug ? 'workbench.action.debug.start' : 'workbench.action.debug.run';
    const editor = this.editors?.currentEditor?.editor;
    if (editor?.uri?.scheme !== 'file') return debug ? 'select.debug.configuration' : 'workbench.action.debug.run';
    const language = editor.document?.languageId;
    // Solidity has a real local compiler, not a directly executable process or
    // an admitted default debugger. A selected launch above remains explicit.
    if (language === 'solidity') return debug ? undefined : 'ynx.compileSolidity';
    const pair = {
      c: ['ynx.cpp.runActive', 'ynx.cpp.debugActive'], cpp: ['ynx.cpp.runActive', 'ynx.cpp.debugActive'],
      javascript: ['ynx.js.runActive', 'ynx.js.debugActive'],
      typescript: ['ynx.ts.runActive', 'ynx.ts.debugActive'], typescriptreact: ['ynx.ts.runActive', 'ynx.ts.debugActive'],
      python: ['python.execInTerminal', 'debugpy.debugInTerminal'],
      go: ['ynx.go.run', 'select.debug.configuration'],
    }[language];
    return pair ? pair[Number(debug)] : debug ? 'select.debug.configuration' : 'workbench.action.debug.run';
  }
  registerCommands(registry) {
    registry.registerCommand({ id: 'workbench.action.debug.selectandstart' }, {
      execute: () => this.commands.executeCommand('select.debug.configuration'),
    });
    for (const [id, debug] of [['ynx.workbench.runCurrentFile', false], ['ynx.workbench.debugCurrentFile', true]]) {
      registry.registerCommand({ id }, {
        execute: () => {
          const command = this.currentFileCommand(debug);
          if (!command) throw Error('No applicable current-file command is available.');
          return this.commands.executeCommand(command);
        },
        isEnabled: () => {
          const command = this.currentFileCommand(debug);
          return !!command && this.commands.isEnabled(command);
        },
      });
    }
  }
}
module.exports = { DebugSelectionContribution };
