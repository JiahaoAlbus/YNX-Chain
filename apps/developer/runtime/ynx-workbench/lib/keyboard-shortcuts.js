const { BaseWidget } = require('@theia/core/lib/browser/widgets');
const { KeybindingScope } = require('@theia/core/lib/browser/keybinding');
const { KeyCode, KeySequence } = require('@theia/core/lib/common/keys');
const { CommonMenus } = require('@theia/core/lib/browser/common-menus');

const ID = 'ynx-keyboard-shortcuts';
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text, action) {
  const node = element('button', text, 'theia-button secondary');
  node.type = 'button'; node.addEventListener('click', action); return node;
}

class KeyboardShortcutsWidget extends BaseWidget {
  constructor(shortcuts, registry, commands) {
    super(); Object.assign(this, { shortcuts, registry, commands });
    this.id = ID; this.title.label = 'Keyboard Shortcuts'; this.title.caption = 'YNX Keyboard Shortcuts'; this.title.closable = true;
    this.addClass('ynx-keyboard-shortcuts'); this.node.tabIndex = -1;
    this.page = 0; this.rows = [];
    const heading = element('div', undefined, 'ynx-shortcuts-heading');
    heading.append(element('h1', 'Keyboard Shortcuts'), button('Open JSON', () => commands.executeCommand(this.target.value === 'Workspace' ? 'ynx.workbench.openWorkspaceKeybindingsFile' : 'workbench.action.openGlobalKeybindingsFile')),
      button('Refresh', () => this.refresh()));
    this.search = element('input'); this.search.type = 'search'; this.search.placeholder = 'Search commands or shortcuts'; this.search.setAttribute('aria-label', this.search.placeholder);
    this.source = element('select'); this.source.setAttribute('aria-label', 'Shortcut source');
    for (const value of ['All', 'User', 'Default', 'Workspace', 'Unassigned']) { const option = element('option', value); option.value = value; this.source.append(option); }
    this.target = element('select'); this.target.setAttribute('aria-label', 'Save shortcuts in');
    for (const value of ['User', 'Workspace']) { const option = element('option', value === 'Workspace' ? 'This project' : 'User settings'); option.value = value; this.target.append(option); }
    const targetLabel = element('label', 'Save shortcuts in '); targetLabel.append(this.target);
    const filters = element('div', undefined, 'ynx-shortcuts-filters'); filters.append(this.search, this.source, targetLabel);
    this.message = element('div', undefined, 'ynx-shortcuts-message'); this.message.setAttribute('role', 'status'); this.message.setAttribute('aria-live', 'polite');
    this.table = element('table'); this.table.setAttribute('aria-label', 'Keyboard shortcuts');
    const header = element('tr'); for (const title of ['Command', 'Shortcut', 'When', 'Source', 'Actions']) header.append(element('th', title));
    const thead = element('thead'); thead.append(header); this.body = element('tbody'); this.table.append(thead, this.body);
    const scroll = element('div', undefined, 'ynx-shortcuts-table'); scroll.append(this.table);
    this.count = element('span'); this.previous = button('Previous', () => { this.page--; this.renderRows(); }); this.next = button('Next', () => { this.page++; this.renderRows(); });
    const footer = element('div', undefined, 'ynx-shortcuts-footer'); footer.append(this.count, this.previous, this.next);
    this.node.append(heading, filters, this.message, scroll, footer);
    this.target.addEventListener('change', () => this.refresh());
    this.search.addEventListener('input', () => { this.page = 0; this.renderRows(); });
    this.source.addEventListener('change', () => { this.page = 0; this.renderRows(); });
    this.search.addEventListener('keydown', event => event.stopPropagation());
    this.toDispose.push(registry.onKeybindingsChanged(() => this.refresh()), commands.onCommandsChanged(() => this.refresh()));
    this.refresh();
  }
  onActivateRequest(message) { super.onActivateRequest(message); this.search.focus(); }
  async refresh() {
    const generation = this.generation = (this.generation || 0) + 1;
    try {
      const snapshot = await this.shortcuts.snapshot(this.target.value);
      if (this.isDisposed || generation !== this.generation) return;
      this.snapshot = snapshot;
      if (this.loadError) { this.message.textContent = ''; this.loadError = false; }
      const rows = [], known = new Set();
      const entries = Object.entries(snapshot.scopes).flatMap(([source, value]) => value.entries.map((entry, index) => ({ entry, index, source })));
      this.target.querySelector('option[value=Workspace]').disabled = !snapshot.scopes.Workspace.available;
      if (snapshot.targetScope === 'Workspace' && !snapshot.available) this.message.textContent = 'Open a single local project to edit its shortcuts.';
      for (const command of this.commands.commands) {
        known.add(command.id);
        const label = [command.category, command.label].filter(Boolean).join(': ') || command.id;
        const bindings = this.registry.getKeybindingsForCommand(command.id);
        if (command.id.startsWith('_') && !bindings.length && !entries.some(value => value.entry.command === command.id)) continue;
        // Show the original user entries so each edit addresses its exact JSONC index.
        entries.forEach(({ entry, index, source }) => {
          if (entry.command === command.id) rows.push({ command: command.id, label, key: entry.key, when: entry.when, context: entry.context, args: entry.args, index, entry, source });
        });
        for (const binding of bindings) if (binding.scope === KeybindingScope.DEFAULT) rows.push({ command: command.id, label, key: binding.keybinding, when: binding.when, context: binding.context, args: binding.args, source: binding.scope === KeybindingScope.WORKSPACE ? 'Workspace' : 'Default' });
        if (!bindings.length && !entries.some(value => value.entry.command === command.id)) rows.push({ command: command.id, label, source: 'Unassigned' });
      }
      // Keep bindings for currently disabled/uninstalled commands visible and editable.
      entries.forEach(({ entry, index, source }) => { if (!entry.command.startsWith('-') && !known.has(entry.command)) rows.push({ command: entry.command, label: entry.command, key: entry.key, when: entry.when, context: entry.context, args: entry.args, index, entry, source }); });
      this.rows = rows.sort((a, b) => a.label.localeCompare(b.label) || (a.key || '').localeCompare(b.key || ''));
      this.renderRows();
    } catch (error) {
      if (this.isDisposed || generation !== this.generation) return;
      this.snapshot = undefined; this.body.replaceChildren(); this.loadError = true; this.message.textContent = error.message; this.count.textContent = 'Shortcuts could not be loaded';
    }
  }
  renderRows() {
    const query = this.search.value.trim().toLowerCase();
    const commandQuery = /^@command:([^ ]+)/.exec(query);
    const available = this.rows.slice();
    // Private extension RPC commands do not clutter the default list. An exact
    // command lookup can still expose a registered command for an advanced binding.
    if (commandQuery && !available.some(row => row.command.toLowerCase() === commandQuery[1])) {
      const command = this.commands.commands.find(command => command.id.toLowerCase() === commandQuery[1]);
      if (command) available.push({ command: command.id, label: command.label || command.id, source: 'Unassigned' });
    }
    const rows = available.filter(row => (this.source.value === 'All' || this.source.value === row.source)
      && (commandQuery ? row.command.toLowerCase() === commandQuery[1] : [row.label, row.command, row.key, row.when, row.source].join(' ').toLowerCase().includes(query)));
    const size = 100, pages = Math.max(1, Math.ceil(rows.length / size)); this.page = Math.max(0, Math.min(this.page, pages - 1));
    this.body.replaceChildren();
    for (const row of rows.slice(this.page * size, (this.page + 1) * size)) {
      const tr = element('tr'); tr.dataset.command = row.command; tr.dataset.source = row.source;
      const command = element('td'); command.append(element('strong', row.label), element('small', row.command));
      const key = element('td'); key.append(element('kbd', row.key || '—'));
      const condition = element('td', row.when || ''); if (row.context) condition.title = `Context: ${row.context}`;
      const actions = element('td');
      const edit = button(row.key ? 'Edit' : 'Add', () => this.edit(row, row.key ? 'edit' : 'add'));
      actions.append(edit);
      if (row.key) actions.append(button('Add', () => this.edit(row, 'add')), button('Remove', () => this.apply({ kind: 'remove', row })));
      if (this.snapshot?.entries.some(entry => entry.command === row.command || entry.command === '-' + row.command)) actions.append(button('Reset', () => this.apply({ kind: 'reset', row })));
      if (this.snapshot?.targetScope === 'Workspace' && !this.snapshot.available) for (const action of actions.children) action.disabled = true;
      tr.append(command, key, condition, element('td', row.source), actions); this.body.append(tr);
    }
    this.count.textContent = `${rows.length} shortcuts · Page ${this.page + 1} of ${pages}`; this.previous.disabled = this.page === 0; this.next.disabled = this.page >= pages - 1;
  }
  async apply(change, dialog, snapshot = this.snapshot) {
    if (!snapshot || this.saving) return;
    this.saving = true;
    this.message.textContent = 'Saving keyboard shortcuts…';
    try {
      const row = { ...change.row };
      if (row.source !== snapshot.targetScope) { delete row.index; delete row.entry; }
      await this.shortcuts.change(snapshot, { ...change, row });
      if (dialog) { dialog.close(); dialog.remove(); }
      await this.refresh(); this.message.textContent = 'Keyboard shortcuts saved.';
    } catch (error) {
      (dialog?.querySelector('[role="alert"]') || this.message).textContent = error.message;
    } finally { this.saving = false; }
  }
  edit(row, kind) {
    if (!this.snapshot) return;
    const snapshot = this.snapshot;
    const dialog = element('dialog', undefined, 'ynx-shortcuts-dialog');
    const title = element('h2', `${kind === 'add' ? 'Add' : 'Edit'} Shortcut`); title.id = ID + '-dialog-title'; dialog.setAttribute('aria-labelledby', title.id);
    const key = element('input'); key.value = kind === 'edit' ? row.key : ''; key.setAttribute('aria-label', 'Shortcut'); key.placeholder = 'For example cmd+k cmd+y';
    key.dataset.ynxShortcutInput = 'true';
    const when = element('input'); when.value = row.when || ''; when.setAttribute('aria-label', 'When'); when.placeholder = 'Optional condition, for example editorTextFocus';
    const alert = element('div'); alert.setAttribute('role', 'alert'); const conflicts = element('div', undefined, 'ynx-shortcuts-conflicts');
    let recording = false, sequence = [];
    const record = button('Record keys', () => { recording = true; sequence = []; key.value = ''; key.readOnly = true; record.textContent = 'Recording…'; key.focus(); });
    const update = () => {
      alert.textContent = ''; conflicts.textContent = '';
      if (!key.value.trim()) return;
      try {
        this.shortcuts.validate({ key: key.value, command: row.command });
        const candidate = this.registry.resolveKeybinding({ keybinding: key.value, command: row.command });
        const matches = this.rows.filter(other => other !== row && other.key && KeySequence.equals(candidate, this.registry.resolveKeybinding({ keybinding: other.key, command: other.command })));
        if (matches.length) conflicts.textContent = 'Also used by: ' + [...new Set(matches.map(other => other.label))].slice(0, 8).join(', ') + '. Check the When conditions before saving.';
      } catch (error) { alert.textContent = error.message; }
    };
    key.addEventListener('input', update);
    key.addEventListener('keydown', event => {
      event.stopPropagation();
      if (!recording || event.key === 'Tab') return;
      event.preventDefault();
      if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) { recording = false; key.readOnly = false; record.textContent = 'Record keys'; return; }
      if (event.repeat || event.isComposing) return;
      const code = KeyCode.createKeyCode(event);
      if (code.isModifierOnly()) return;
      if (sequence.length === 3) sequence = [];
      sequence.push(code.toString()); key.value = sequence.join(' '); update();
    });
    when.addEventListener('keydown', event => event.stopPropagation());
    const cancel = button('Cancel', () => { dialog.close(); dialog.remove(); });
    const save = button('Save', () => { if (!key.value.trim()) { alert.textContent = 'Enter a shortcut.'; return; } this.apply({ kind, row, key: key.value, when: when.value }, dialog, snapshot); });
    const keyLabel = element('label', 'Shortcut'); keyLabel.append(key);
    const whenLabel = element('label', 'When'); whenLabel.append(when);
    const actions = element('div', undefined, 'ynx-shortcuts-dialog-actions'); actions.append(cancel, save);
    dialog.append(title, element('p', row.label + ' · ' + (snapshot.targetScope === 'Workspace' ? 'This project' : 'User settings')), keyLabel, record, whenLabel, conflicts, alert, actions);
    dialog.addEventListener('close', () => dialog.remove());
    this.node.append(dialog); dialog.showModal(); key.focus(); key.select(); update();
  }
}

class KeyboardShortcutsContribution {
  constructor(manager, shell) { Object.assign(this, { manager, shell }); }
  registerCommands(commands) {
    const handler = { execute: async query => {
      const widget = await this.manager.getOrCreateWidget(ID);
      if (!widget.isAttached) await this.shell.addWidget(widget, { area: 'main' });
      await widget.refresh();
      if (typeof query === 'string') { widget.search.value = query; widget.page = 0; widget.renderRows(); }
      await this.shell.activateWidget(widget.id);
      return widget;
    } };
    if (commands.getCommand('workbench.action.openGlobalKeybindings')) commands.registerHandler('workbench.action.openGlobalKeybindings', handler);
    else commands.registerCommand({ id: 'workbench.action.openGlobalKeybindings', category: 'Preferences', label: 'Open Keyboard Shortcuts' }, handler);
  }
  registerKeybindings(registry) { registry.registerKeybinding({ command: 'workbench.action.openGlobalKeybindings', keybinding: 'ctrlcmd+k ctrlcmd+s' }); }
  registerMenus(menus) {
    for (const path of [CommonMenus.FILE_SETTINGS_SUBMENU_OPEN, CommonMenus.MANAGE_SETTINGS]) menus.registerMenuAction(path, {
      commandId: 'workbench.action.openGlobalKeybindings', label: 'Keyboard Shortcuts', order: 'a20',
    });
  }
}
module.exports = { KeyboardShortcutsWidget, KeyboardShortcutsContribution, KEYBOARD_SHORTCUTS_ID: ID };
