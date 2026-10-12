'use strict';
const PROJECT_VIEWS = Object.freeze(['ynx.contracts', 'ynx.network', 'ynx.review']);
function registerProjectViews(vscode, context, sections) {
  PROJECT_VIEWS.forEach((id, index) => {
    context.subscriptions.push(vscode.window.registerTreeDataProvider(id, {
      getChildren: item => item ? item.children || [] : sections[index].children,
      getTreeItem: item => ({ label: item.label, description: item.description, tooltip: item.tooltip,
        collapsibleState: item.children ? 2 : 0,
        ...(item.command ? { command: { command: item.command, title: item.label } } : {}) }),
    }));
  });
  // Preserve existing user keybindings without recreating the catch-all view.
  context.subscriptions.push(vscode.commands.registerCommand('ynx.tools.focus',
    () => vscode.commands.executeCommand('ynx.contracts.focus')));
}
module.exports = { PROJECT_VIEWS, registerProjectViews };
