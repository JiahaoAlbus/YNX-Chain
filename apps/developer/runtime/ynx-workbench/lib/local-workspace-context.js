const URI = require('@theia/core/lib/common/uri').default;
// A URL fragment is navigation, not a newly opened native project.
class LocalWorkspaceContext {
  constructor(workspace, context, commands, messages, target = window, translate = (key, text) => text) { Object.assign(this, { workspace, context, commands, messages, target, translate }); this.stopped = false; this.rootReadEpoch = 0; }
  registerCommands(registry) {
    registry.registerCommand({ id: 'ynx.workbench.newProject', label: this.translate('newProject', 'New Project…'), category: 'YNX' }, {
      isEnabled: () => !this.stopped && !!this.target.webkit?.messageHandlers?.ynxLocalWorkbench,
      execute: () => this.target.webkit.messageHandlers.ynxLocalWorkbench.postMessage({ action: 'new-project' }),
    });
    registry.registerCommand({ id: 'ynx.workbench.openFolder', label: this.translate('openFolder', 'Open Folder…'), category: 'YNX' }, {
      isEnabled: () => !this.stopped && !!this.target.webkit?.messageHandlers?.ynxLocalWorkbench,
      execute: () => this.target.webkit.messageHandlers.ynxLocalWorkbench.postMessage({ action: 'open-folder' }),
    });
    registry.registerCommand({ id: 'ynx.workbench.returnToProject', label: this.translate('returnToProject', 'Return to Open Project'), category: 'YNX' }, {
      isEnabled: () => !this.stopped && !!this.boundRoot,
      execute: () => this.workspace.open(this.boundRoot, { preserveWindow: true }),
    });
  }
  async onStart() {
    let context;
    try { context = await this.context.getContext(); } catch { return; }
    if (this.stopped) return;
    if (context?.mode !== 'local' || typeof context.workspace !== 'string' || !context.workspace.startsWith('/')) return;
    this.boundRoot = URI.fromComponents({ scheme: 'file', path: context.workspace });
    const check = async () => {
      const epoch = ++this.rootReadEpoch;
      const roots = await this.workspace.roots;
      // Workspace events may finish their root lookup out of order. An older
      // snapshot must not replace the latest warning/recovery state.
      if (this.stopped || epoch !== this.rootReadEpoch) return;
      const signature = roots.map(root => root.resource.toString()).join('|');
      const mismatched = roots.some(root => root.resource.toString() !== this.boundRoot.toString());
      if (!mismatched) { this.lastWarning = undefined; return; }
      if (this.lastWarning === signature) return;
      this.lastWarning = signature;
      const native = !!this.target.webkit?.messageHandlers?.ynxLocalWorkbench;
      const openLabel = this.translate('openFolder', 'Open Folder…'), returnLabel = this.translate('returnToProject', 'Return to Open Project');
      const choice = await this.messages.warn(this.translate('workspaceMismatch', 'This window is connected to a different project folder. Use Open Folder to open another project; changing the URL does not change the writable project.'),
        ...(native ? [openLabel] : []), returnLabel);
      if (this.stopped || this.lastWarning !== signature) return;
      if (choice === openLabel) await this.commands.executeCommand('ynx.workbench.openFolder');
      else if (choice === returnLabel) await this.commands.executeCommand('ynx.workbench.returnToProject');
    };
    await this.workspace.ready;
    if (this.stopped) return;
    this.listener = this.workspace.onWorkspaceChanged(() => check().catch(() => {}));
    // A recovery choice must not hold the application startup/loading overlay.
    void check().catch(() => {});
  }
  onStop() { this.stopped = true; this.listener?.dispose(); }
}
module.exports = { LocalWorkspaceContext };
