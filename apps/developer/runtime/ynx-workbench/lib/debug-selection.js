// VS Code extensions and keybindings can invoke the familiar command ID.
// The framework already provides the picker, dynamic providers and compounds.
class DebugSelectionContribution {
  constructor(commands, editors, configurations, debugView) { Object.assign(this, { commands, editors, configurations, debugView }); }
  fileCommands() {
    const editor = this.editors?.currentEditor?.editor;
    if (editor?.uri?.scheme !== 'file') return undefined;
    return {
      c: ['ynx.cpp.runActive', 'ynx.cpp.debugActive'], cpp: ['ynx.cpp.runActive', 'ynx.cpp.debugActive'],
      javascript: ['ynx.js.runActive', 'ynx.js.debugActive'],
      typescript: ['ynx.ts.runActive', 'ynx.ts.debugActive'], typescriptreact: ['ynx.ts.runActive', 'ynx.ts.debugActive'],
      python: ['python.execInTerminal', 'debugpy.debugInTerminal'], go: ['ynx.go.run'],
    }[editor.document?.languageId];
  }
  currentFileCommand(debug) {
    if (this.configurations?.current) return debug ? 'workbench.action.debug.start' : 'workbench.action.debug.run';
    const editor = this.editors?.currentEditor?.editor;
    if (editor?.uri?.scheme !== 'file') return debug ? 'select.debug.configuration' : 'workbench.action.debug.run';
    const pair = this.fileCommands();
    return pair?.[Number(debug)] || (debug ? 'select.debug.configuration' : 'workbench.action.debug.run');
  }
  registerCommands(registry) {
    // The framework's plugin view mapping supplies context IDs, not this
    // executable VS Code command. Reveal the existing view; a toggle would
    // incorrectly close it when an extension requests it a second time.
    if (this.debugView && !registry.getCommand('workbench.view.debug')) {
      registry.registerCommand({ id: 'workbench.view.debug' }, {
        execute: () => this.debugView.openView({ activate: true }),
      });
    }
    registry.registerCommand({ id: 'ynx.workbench.runEditorFile' }, {
      execute: () => {
        const command = this.fileCommands()?.[0];
        if (!command) throw Error('No current-file runner is available for this editor.');
        return this.commands.executeCommand(command);
      },
      isEnabled: () => { const command = this.fileCommands()?.[0]; return !!command && this.commands.isEnabled(command); },
    });
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
