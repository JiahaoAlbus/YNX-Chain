const URI = require('@theia/core/lib/common/uri').default;
const { BinaryBuffer } = require('@theia/core/lib/common/buffer');
const { KeybindingScope } = require('@theia/core/lib/browser/keybinding');
const { parse } = require('jsonc-parser');
const { KeySequence } = require('@theia/core/lib/common/keys');

class UserKeybindingsContribution {
  constructor(files, environment, editors, registry, messages) {
    Object.assign(this, { files, environment, editors, registry, messages });
    this.serial = Promise.resolve();
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
      const errors = [], entries = parse(content.value.toString(), errors, { allowTrailingComma: true });
      if (errors.length || !Array.isArray(entries) || entries.length > 4096) throw Error('Expected a valid keyboard shortcuts array.');
      const bindings = entries.flatMap(entry => {
        if (!entry || typeof entry.key !== 'string' || !entry.key || typeof entry.command !== 'string' || !entry.command || entry.command === '-' || entry.when !== undefined && typeof entry.when !== 'string') throw Error('Each shortcut needs a key and command, with an optional when condition.');
        const binding = { keybinding: entry.key, command: entry.command, when: entry.when, args: entry.args };
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
  apply(bindings) {
    this.applying = true;
    try { this.registry.setKeymap(KeybindingScope.USER, bindings); } finally { this.applying = false; }
  }
  onStop() { this.listener?.dispose(); this.watcher?.dispose(); this.bindingListener?.dispose(); }
}
module.exports = { UserKeybindingsContribution };
