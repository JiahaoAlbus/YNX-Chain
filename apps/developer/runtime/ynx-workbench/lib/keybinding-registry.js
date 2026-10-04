const { injectable } = require('@theia/core/shared/inversify');
const { KeybindingRegistry } = require('@theia/core/lib/browser/keybinding');

class YnxKeybindingRegistry extends KeybindingRegistry {
  run(event) {
    // The framework listens at document capture, before an input's handlers.
    // Keep the shortcut entry/record control out of global chord dispatch.
    // Their normal input and local recording listeners still receive the event.
    const target = event.target;
    if (target?.closest?.('#ynx-keyboard-shortcuts') && target.dataset?.ynxShortcutInput === 'true') {
      this.keySequence = [];
      this.statusBar.removeElement('keybinding-status');
      return;
    }
    return super.run(event);
  }
}
injectable()(YnxKeybindingRegistry);
module.exports = { YnxKeybindingRegistry };
