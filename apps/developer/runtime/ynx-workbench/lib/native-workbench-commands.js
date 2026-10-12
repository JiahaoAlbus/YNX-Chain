// The local Cocoa menu delegates to the same registry as the workbench menus.
// It accepts command IDs only, never command arguments or shell text.
const NATIVE_COMMANDS = new Set([
  'workbench.action.files.newUntitledFile', 'workspace:openFile', 'workspace:openWorkspace', 'core.save', 'file.saveAs', 'core.saveAll', 'core.close.tab', 'preferences:open',
  'core.undo', 'core.redo', 'core.cut', 'core.copy', 'core.paste', 'core.find', 'core.replace', 'editor.action.commentLine', 'editor.action.formatDocument',
  'core.selectAll', 'editor.action.smartSelect.expand', 'editor.action.smartSelect.shrink', 'editor.action.selectHighlights', 'editor.action.insertCursorAbove', 'editor.action.insertCursorBelow',
  'workbench.action.showCommands', 'fileNavigator:toggle', 'search-in-workspace.toggle', 'scmView:toggle', 'debug:toggle', 'vsxExtensions.toggle',
  'problemsView:toggle', 'output:toggle', 'outlineView:toggle', 'core.toggle.left.panel', 'core.toggle.bottom.panel', 'workbench.action.selectTheme',
  'file-search.openFile', 'editor.action.gotoLine', 'editor.action.revealDefinition', 'editor.action.goToReferences', 'textEditor.commands.go.back', 'textEditor.commands.go.forward',
  'workbench.action.debug.start', 'workbench.action.debug.run', 'workbench.action.debug.stop', 'workbench.action.debug.restart', 'debug.configurations.open',
  'terminal:new', 'workbench.action.terminal.toggleTerminal', 'terminal:split', 'terminal:clear', 'task:run:build', 'workbench.action.tasks.runTask',
]);
class NativeWorkbenchCommands {
  constructor(commands, target = window, locale = 'en') { Object.assign(this, { commands, target, locale }); }
  onStart() {
    const bridge = this.target.webkit?.messageHandlers?.ynxLocalWorkbench;
    if (!bridge) return;
    this.dispatch = async (commandId, requestId) => {
      if (typeof requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId)) return;
      let result;
      try {
        if (!NATIVE_COMMANDS.has(commandId)) throw Error('This menu command is not supported.');
        if (!this.commands.getCommand(commandId) || !this.commands.isEnabled(commandId)) throw Error('This command is unavailable in the current editor.');
        await this.commands.executeCommand(commandId);
        result = { action: 'command-result', requestId, accepted: true };
      } catch (error) {
        // Do not forward backend exception text (which may contain file paths).
        result = { action: 'command-result', requestId, accepted: false, error: NATIVE_COMMANDS.has(commandId)
          ? 'This command is unavailable or could not complete. Check the workbench notifications and project configuration.'
          : 'This menu command is not supported.' };
      }
      bridge.postMessage(result);
    };
    this.target.__ynxLocalWorkbenchCommand = this.dispatch;
    bridge.postMessage({ action: 'locale', locale: this.locale === 'zh-cn' ? 'zh-cn' : 'en' });
  }
  onStop() { if (this.target.__ynxLocalWorkbenchCommand === this.dispatch) delete this.target.__ynxLocalWorkbenchCommand; }
}
async function selectNativeGoToolchain(target, ...args) {
  if(args.length)throw Error('Go toolchain selection accepts no supplied paths or arguments.');
  const bridge=target.ynxDesktopGo;
  if(!bridge || typeof bridge.selectToolchain!=='function')throw Error('Go toolchain selection requires the native YNX Developer App.');
  const result=await bridge.selectToolchain();
  if(result?.effective!=='after-reopen' || typeof result.version!=='string')throw Error('Go toolchain selection did not return a verified selection.');
  return result;
}
module.exports = { NativeWorkbenchCommands, NATIVE_COMMANDS, selectNativeGoToolchain };
