const { injectable } = require('@theia/core/shared/inversify');
const { KeybindingRegistry } = require('@theia/core/lib/browser/keybinding');

class YnxKeybindingRegistry extends KeybindingRegistry {
  executeKeyBinding(binding, event) {
    // WKWebView must receive the original CmdV default action. Dispatching a
    // web command here cancels that action and Monaco falls back to an async
    // clipboard read, which has different user-gesture permission semantics.
    // The selected binding is already resolved by Theia: user remaps to other
    // commands, alternate shortcuts and pending chords keep their usual path.
    if (typeof window !== 'undefined' && window.webkit?.messageHandlers?.ynxLocalWorkbench
      && this.keySequence.length === 1 && event.type === 'keydown'
      && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
      && event.code === 'KeyV' && !event.defaultPrevented
      && ['core.paste', 'editor.action.clipboardPasteAction'].includes(binding.command)) {
      return;
    }
    return super.executeKeyBinding(binding, event);
  }
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
