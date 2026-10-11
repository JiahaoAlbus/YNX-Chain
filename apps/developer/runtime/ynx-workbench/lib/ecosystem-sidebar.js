'use strict';
const { BaseWidget } = require('@theia/core/lib/browser/widgets');
const { CommonMenus } = require('@theia/core/lib/browser/common-menus');
const ID = 'ynx-ecosystem-sidebar';
const COMMAND = 'ynx.workbench.ecosystem';
const ACTION_ICONS = Object.freeze({
  'ynx.contracts.focus': 'symbol-class',
  'ynx.network.focus': 'globe',
  'ynx.workbench.wallet': 'account',
  'ynx.chainResults.focus': 'history',
  'ynx.review.focus': 'diff',
  'vsxExtensions.toggle': 'extensions',
});
// Navigation uses the current project's existing contributions. Opening this
// view never queries a network, approves a service or submits a transaction.
const SECTIONS = Object.freeze([
  { key: 'ecosystemContracts', label: 'Contract development', actions: [
    ['ynx.contracts.focus', 'ecosystemOpenContracts', 'Open project contracts'],
  ] },
  { key: 'ecosystemNetwork', label: 'Network and account', actions: [
    ['ynx.network.focus', 'ecosystemOpenNetwork', 'Project network'],
    ['ynx.workbench.wallet', 'ecosystemOpenWallet', 'Wallet connection'],
  ] },
  { key: 'ecosystemResults', label: 'Transactions and results', actions: [
    ['ynx.chainResults.focus', 'ecosystemOpenResults', 'Saved chain results'],
  ] },
  { key: 'ecosystemReview', label: 'Project changes', actions: [
    ['ynx.review.focus', 'ecosystemOpenReview', 'Review local changes'],
  ] },
  { key: 'ecosystemExtensions', label: 'Development extensions', actions: [
    ['vsxExtensions.toggle', 'ecosystemOpenExtensions', 'Browse and manage extensions'],
  ] },
]);
class EcosystemSidebarWidget extends BaseWidget {
  constructor(commands, messages, translate) {
    super(); Object.assign(this, { commands, messages, translate });
    this.id = ID; this.title.label = translate('ecosystemTitle', 'YNX Ecosystem');
    this.title.caption = this.title.label; this.title.iconClass = 'codicon codicon-link';
    this.title.closable = false; this.node.tabIndex = -1;
    this.node.classList.add('ynx-ecosystem-navigation');
    const document = this.node.ownerDocument;
    const heading = document.createElement('h3'); heading.textContent = this.title.label;
    this.node.append(heading); this.buttons = [];
    for (const section of SECTIONS) {
      const group = document.createElement('section');
      const label = document.createElement('h4'); label.textContent = translate(section.key, section.label);
      group.append(label);
      for (const [command, key, text] of section.actions) {
        const button = document.createElement('button'); button.type = 'button';
        button.className = 'ynx-ecosystem-navigation-action';
        const icon = document.createElement('span');
        icon.className = `codicon codicon-${ACTION_ICONS[command]}`;
        icon.setAttribute('aria-hidden', 'true');
        const caption = document.createElement('span'); caption.textContent = translate(key, text);
        button.append(icon, caption);
        button.addEventListener('click', async () => {
          // Recheck at the click, rather than retaining a project's old grant.
          try {
            if (!commands.getCommand(command) || !commands.isEnabled(command)) throw new Error(translate('currentlyUnavailable', 'Currently unavailable'));
            await commands.executeCommand(command);
          } catch (error) { messages.error(error.message || String(error)); }
        });
        group.append(button); this.buttons.push({ button, command });
      }
      this.node.append(group);
    }
    const note = document.createElement('p');
    note.textContent = translate('ecosystemProjectHint', 'Develop contracts, connect a project network and revisit transaction results.');
    this.node.append(note);
    const refresh = () => this.refresh();
    if (commands.onCommandsChanged) this.toDispose.push(commands.onCommandsChanged(refresh));
    this.refresh();
  }
  refresh() {
    for (const { button, command } of this.buttons) button.disabled = !this.commands.getCommand(command) || !this.commands.isEnabled(command);
  }
  onActivateRequest(message) { super.onActivateRequest(message); this.refresh(); this.buttons.find(item => !item.button.disabled)?.button.focus(); }
}
class EcosystemSidebarContribution {
  constructor(widgets, shell, translate) { Object.assign(this, { widgets, shell, translate }); }
  async open(activate = true) {
    const widget = await this.widgets.getOrCreateWidget(ID);
    if (!this.shell.getTabBarFor(widget)) this.shell.addWidget(widget, { area: 'left' });
    if (activate) await this.shell.activateWidget(widget.id);
    return widget;
  }
  // Attach a native left activity entry even to an older restored layout;
  // leave its active editor, panel sizes and selected sidebar intact.
  async onDidInitializeLayout() { await this.open(false); }
  registerCommands(registry) {
    registry.registerCommand({ id: COMMAND, label: this.translate('ecosystemTitle', 'YNX Ecosystem'), category: 'YNX' }, { execute: () => this.open() });
  }
  registerMenus(menus) { menus.registerMenuAction([...CommonMenus.VIEW_VIEWS, 'ynx-ecosystem'], { commandId: COMMAND, order: '19' }); }
}
module.exports = { EcosystemSidebarWidget, EcosystemSidebarContribution, ECOSYSTEM_ID: ID, ECOSYSTEM_COMMAND: COMMAND, SECTIONS };
