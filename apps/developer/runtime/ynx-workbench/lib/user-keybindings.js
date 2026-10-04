const URI = require('@theia/core/lib/common/uri').default;
const { BinaryBuffer } = require('@theia/core/lib/common/buffer');
const { KeybindingScope } = require('@theia/core/lib/browser/keybinding');
const { KeySequence } = require('@theia/core/lib/common/keys');
const { readShortcuts, changeShortcuts } = require('./keybindings-edit');

class UserKeybindingsContribution {
  constructor(files, environment, editors, registry, messages) {
    Object.assign(this, { files, environment, editors, registry, messages });
    this.serial = Promise.resolve();
    this.editSerial = Promise.resolve();
  }
  registerCommands(commands) {
    commands.registerCommand({ id: 'workbench.action.openGlobalKeybindingsFile', category: 'Preferences', label: 'Open Keyboard Shortcuts (JSON)' }, {
      execute: async () => {
        await this.ready;
        if (!await this.files.exists(this.uri)) await this.files.createFile(this.uri, BinaryBuffer.fromString('// Place your keyboard shortcuts in this file.\n[\n]\n'));
        return this.editors.open(this.uri, { mode: 'activate', preview: false });
      },
    });
  }
  async onStart() {
    this.ready = (async () => {
      const profile = new URI(await this.environment.getConfigDirUri());
      if (profile.scheme !== 'file') throw Error('Keyboard shortcuts require this project’s local profile.');
      this.uri = profile.resolve('keybindings.json');
      this.watcher = this.files.watch(profile, { recursive: false });
      this.listener = this.files.onDidFilesChange(event => { if (event.contains(this.uri)) this.reload(); });
      this.bindingListener = this.registry.onKeybindingsChanged(() => { if (!this.applying) this.reload(); });
      await this.reload();
    })();
    return this.ready;
  }
  reload() {
    this.serial = this.serial.then(async () => {
      if (!await this.files.exists(this.uri)) { this.apply([]); return; }
      const content = await this.files.readFile(this.uri, { limits: { size: 1024 * 1024 } });
      const entries = readShortcuts(content.value.toString(), entry => this.validate(entry));
      const bindings = entries.flatMap(entry => {
        const binding = { keybinding: entry.key, command: entry.command, when: entry.when, args: entry.args, context: entry.context };
        this.registry.resolveKeybinding(binding);
        if (!entry.command.startsWith('-')) return [binding];
        // VS Code removal without `when` removes matching defaults across
        // their contexts. The framework needs each original context/when and
        // key spelling explicitly, even when the user's key is an alias.
        return this.registry.getKeybindingsByScope(KeybindingScope.DEFAULT)
          .filter(original => original.command === entry.command.slice(1)
            && (entry.when === undefined || entry.when === original.when)
            && KeySequence.equals(this.registry.resolveKeybinding(binding), this.registry.resolveKeybinding(original)))
          .map(original => ({ keybinding: original.keybinding, command: entry.command, context: original.context, when: original.when }));
      });
      this.apply(bindings);
      this.lastError = undefined;
    }).catch(error => {
      const message = `Keyboard shortcuts could not be loaded: ${error.message}. The last working shortcuts remain active.`;
      if (message !== this.lastError) { this.lastError = message; this.messages.warn(message); }
    });
    return this.serial;
  }
  validate(entry) {
    const keys = this.registry.resolveKeybinding({ keybinding: entry.key, command: entry.command });
    if (!keys.length || keys.some(key => key.isModifierOnly())) throw Error('Use a key or chord containing a non-modifier key.');
  }
  assertSaved() {
    if (this.editors.all.some(widget => widget.getResourceUri()?.toString() === this.uri.toString() && widget.saveable.dirty)) {
      throw Error('The keyboard shortcuts JSON editor has unsaved changes. Save or discard them before using this view.');
    }
  }
  async snapshot() {
    await this.ready;
    const exists = await this.files.exists(this.uri);
    const content = exists ? await this.files.readFile(this.uri, { limits: { size: 1024 * 1024 } }) : undefined;
    const text = content ? content.value.toString() : '// Place your keyboard shortcuts in this file.\n[\n]\n';
    return { exists, text, entries: readShortcuts(text, entry => this.validate(entry)), mtime: content?.mtime, etag: content?.etag };
  }
  change(snapshot, change) {
    const operation = this.editSerial.then(async () => {
      this.assertSaved();
      const current = await this.snapshot();
      if (current.exists !== snapshot.exists || current.text !== snapshot.text) throw Error('Shortcuts changed on disk. Refresh this view before editing.');
      const text = changeShortcuts(current.text, change, entry => this.validate(entry));
      this.assertSaved();
      if (text !== current.text) {
        if (current.exists) await this.files.writeFile(this.uri, BinaryBuffer.fromString(text), { etag: current.etag, mtime: current.mtime });
        else await this.files.createFile(this.uri, BinaryBuffer.fromString(text), { overwrite: false });
      }
      await this.reload();
      return this.snapshot();
    });
    this.editSerial = operation.catch(() => {});
    return operation;
  }
  apply(bindings) {
    this.applying = true;
    try { this.registry.setKeymap(KeybindingScope.USER, bindings); } finally { this.applying = false; }
  }
  onStop() { this.listener?.dispose(); this.watcher?.dispose(); this.bindingListener?.dispose(); }
}
module.exports = { UserKeybindingsContribution };
