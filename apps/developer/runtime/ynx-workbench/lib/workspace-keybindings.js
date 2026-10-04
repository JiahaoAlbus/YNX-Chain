const { KeybindingScope } = require('@theia/core/lib/browser/keybinding');
const { BinaryBuffer } = require('@theia/core/lib/common/buffer');
const { UserKeybindingsContribution } = require('./user-keybindings');

class WorkspaceKeybindingsContribution extends UserKeybindingsContribution {
  constructor(files, environment, editors, registry, messages, workspace) {
    super(files, environment, editors, registry, messages);
    this.workspace = workspace;
    this.scope = KeybindingScope.WORKSPACE;
    this.locationGeneration = 0;
  }
  registerCommands(commands) {
    commands.registerCommand({ id: 'ynx.workbench.openWorkspaceKeybindingsFile', category: 'Preferences', label: 'Open Project Keyboard Shortcuts (JSON)' }, {
      execute: async () => {
        await this.ready;
        if (!this.uri) throw Error('Open a single local project to edit its shortcuts.');
        const uri = this.uri;
        if (!await this.files.exists(uri)) await this.files.createFile(uri, BinaryBuffer.fromString('// Shortcuts for this YNX project only.\n[\n]\n'), { overwrite: false });
        return this.editors.open(uri, { mode: 'activate', preview: false });
      },
    });
  }
  async onStart() {
    const select = () => {
      const generation = ++this.locationGeneration;
      this.ready = this.serial = this.serial.then(async () => {
        if (generation !== this.locationGeneration) return;
        this.listener?.dispose(); this.watcher?.dispose();
        this.uri = undefined; this.apply([]);
        const roots = await this.workspace.roots;
        if (generation !== this.locationGeneration || roots.length !== 1 || roots[0].resource.scheme !== 'file') return;
        const root = roots[0].resource;
        this.uri = root.resolve('.vscode/keybindings.json');
        // Watch the existing project root, including creation of .vscode.
        this.watcher = this.files.watch(root, { recursive: true });
        this.listener = this.files.onDidFilesChange(event => { if (this.uri && event.contains(this.uri)) this.reload(); });
      });
      this.ready = this.ready.then(() => this.reload());
      return this.ready;
    };
    await this.workspace.ready;
    this.workspaceListener = this.workspace.onWorkspaceChanged(select);
    this.bindingListener = this.registry.onKeybindingsChanged(() => { if (!this.applying && this.uri) this.reload(); });
    return select();
  }
  reload() { return this.uri ? super.reload() : Promise.resolve(); }
  async snapshot() {
    await this.ready;
    if (!this.uri) return { available: false, entries: [] };
    const generation = this.locationGeneration, snapshot = await super.snapshot();
    if (generation !== this.locationGeneration) throw Error('The project changed. Refresh keyboard shortcuts.');
    return { ...snapshot, available: true, locationGeneration: generation };
  }
  change(snapshot, change) {
    if (!snapshot.available || snapshot.locationGeneration !== this.locationGeneration) return Promise.reject(Error('The project changed. Refresh keyboard shortcuts.'));
    return super.change(snapshot, change);
  }
  onStop() { this.workspaceListener?.dispose(); super.onStop(); }
}

class ShortcutSettings {
  constructor(user, workspace) { Object.assign(this, { user, workspace }); }
  validate(entry) { return this.user.validate(entry); }
  async snapshot(targetScope = 'User') {
    const [user, workspace] = await Promise.all([this.user.snapshot(), this.workspace.snapshot()]);
    const current = targetScope === 'Workspace' ? workspace : user;
    return { ...current, targetScope, scopes: { User: user, Workspace: workspace } };
  }
  change(snapshot, change) {
    return (snapshot.targetScope === 'Workspace' ? this.workspace : this.user).change(snapshot, change);
  }
}
module.exports = { WorkspaceKeybindingsContribution, ShortcutSettings };
