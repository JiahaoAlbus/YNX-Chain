// Keep compatibility fixes in the owned workbench, using normal default scope
// so user and workspace bindings can replace or remove them.
function registerDefaultKeybindings(registry, closeMainTabId) {
  registry.registerKeybinding({ command: closeMainTabId, keybinding: 'ctrlcmd+w' });
  registry.registerKeybinding({ command: 'workbench.action.files.newUntitledFile', keybinding: 'ctrlcmd+n' });
  registry.registerKeybinding({ command: 'workbench.action.showCommands', keybinding: 'ctrlcmd+shift+p' });
  registry.registerKeybinding({ command: 'editor.action.rename', keybinding: 'f2', when: 'editorTextFocus' });
  registry.registerKeybinding({ command: 'editor.action.revealDefinition', keybinding: 'f12', when: 'editorTextFocus' });
  // The pinned Problems contribution overrides registerKeybindings without
  // calling its view superclass, so its advertised toggle key is absent.
  registry.registerKeybinding({ command: 'problemsView:toggle', keybinding: 'ctrlcmd+shift+m' });
  // Default scope preserves user overrides and an active session's Continue.
  const when = 'editorTextFocus && resourceScheme == file && !inDebugMode && (editorLangId == cpp || editorLangId == c || editorLangId == javascript || editorLangId == python)';
  registry.registerKeybinding({ command: 'ynx.workbench.runCurrentFile', keybinding: 'ctrl+f5', when });
  registry.registerKeybinding({ command: 'ynx.workbench.debugCurrentFile', keybinding: 'f5', when });
}
module.exports = { registerDefaultKeybindings };
