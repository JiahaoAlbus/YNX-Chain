// VS Code extensions and keybindings can invoke the familiar command ID.
// The framework already provides the picker, dynamic providers and compounds.
class DebugSelectionContribution {
  constructor(commands) { this.commands = commands; }
  registerCommands(registry) {
    registry.registerCommand({ id: 'workbench.action.debug.selectandstart' }, {
      execute: () => this.commands.executeCommand('select.debug.configuration'),
    });
  }
}
module.exports = { DebugSelectionContribution };
