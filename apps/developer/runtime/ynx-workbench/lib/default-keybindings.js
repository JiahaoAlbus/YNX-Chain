// Keep compatibility fixes in the owned workbench, using normal default scope
// so user and workspace bindings can replace or remove them.
function registerDefaultKeybindings(registry, closeMainTabId) {
  registry.registerKeybinding({ command: closeMainTabId, keybinding: 'ctrlcmd+w' });
  registry.registerKeybinding({ command: 'editor.action.rename', keybinding: 'f2', when: 'editorTextFocus' });
  registry.registerKeybinding({ command: 'editor.action.revealDefinition', keybinding: 'f12', when: 'editorTextFocus' });
  // The pinned Problems contribution overrides registerKeybindings without
  // calling its view superclass, so its advertised toggle key is absent.
  registry.registerKeybinding({ command: 'problemsView:toggle', keybinding: 'ctrlcmd+shift+m' });
}
module.exports = { registerDefaultKeybindings };
