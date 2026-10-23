// VS Code extensions and keybindings can invoke the familiar command ID.
// The framework already provides the picker, dynamic providers and compounds.
class DebugSelectionContribution {
  constructor(commands, editors, configurations) { Object.assign(this, { commands, editors, configurations }); }
  currentFileCommand(debug) {
    const editor = this.editors?.currentEditor?.editor;
    const language = editor?.uri?.scheme === 'file' ? editor.document?.languageId : undefined;
    // Solidity has a real local compiler, not a directly executable process or
    // an admitted default debugger. Explicit Debug still keeps its selection.
    if (!debug && language === 'solidity') return 'ynx.compileSolidity';
    const pair = {
      c: ['ynx.cpp.runActive', 'ynx.cpp.debugActive'], cpp: ['ynx.cpp.runActive', 'ynx.cpp.debugActive'],
      javascript: ['ynx.js.runActive', 'ynx.js.debugActive'],
      typescript: ['ynx.ts.runActive', 'ynx.ts.debugActive'], typescriptreact: ['ynx.ts.runActive', 'ynx.ts.debugActive'],
      python: ['python.execInTerminal', 'debugpy.debugInTerminal'],
      go: ['ynx.go.run', 'select.debug.configuration'],
    }[language];
    // The triangle is Run Current File, not the workspace's last selected
    // debugger. A C++ launch must not intercept a newly opened JS/Python/Go
    // file. Keep the selection intact for explicit Debug and project commands.
    if (!debug && pair) return pair[0];
    if (this.configurations?.current) return debug ? 'workbench.action.debug.start' : 'workbench.action.debug.run';
    if (editor?.uri?.scheme !== 'file') return debug ? 'select.debug.configuration' : 'workbench.action.debug.run';
    if (language === 'solidity') return undefined;
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
