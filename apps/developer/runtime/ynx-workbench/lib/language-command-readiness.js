// Retain standard command IDs/actions. The editor may be usable before the
// extension host has started, so its first language query must await activation.
class LanguageCommandReadiness {
  constructor(editors, plugins, monacoCommands) { this.editors = editors; this.plugins = plugins; this.monacoCommands = monacoCommands; }
  registerCommands(registry) {
    for (const id of ['editor.action.revealDefinition', 'editor.action.rename', 'editor.action.triggerSuggest']) {
      registry.registerHandler(id, {
        isEnabled: () => this.isSolidityEditor(),
        execute: (...args) => this.execute(id, args),
      });
    }
  }
  isSolidityEditor() {
    const editor = this.editors.currentEditor?.editor;
    return editor?.uri.scheme === 'file' && editor.document.languageId === 'solidity' && !!editor.getControl?.();
  }
  async execute(id, args) {
    if (!this.isSolidityEditor()) return;
    const widget = this.editors.currentEditor, editor = widget.editor, control = editor.getControl();
    const model = control.getModel(), version = model.getVersionId(), selection = control.getSelection();
    await this.plugins.didStart;
    await this.plugins.activateByLanguage('solidity');
    // A pending startup must not redirect a later tab, changed buffer or cursor.
    if (widget.isDisposed || this.editors.currentEditor !== widget || control.getModel() !== model
      || model.getVersionId() !== version || !control.getSelection()?.equalsSelection(selection)) return;
    // These actions are registered as Action2 commands in this Monaco version,
    // not an editor.getAction entry. Use the existing Monaco command delegate
    // directly so we do not recurse through our own registry handler.
    return this.monacoCommands.executeMonacoCommand(id, ...args);
  }
}
module.exports = { LanguageCommandReadiness };
