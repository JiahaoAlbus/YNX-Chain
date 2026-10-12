// Display ownership only. PTY creation, permissions, task reuse and debugger
// cleanup remain with the framework and each language's existing runner.
const TERMINAL_PANEL_ID = 'terminal-ynx-panel';
function createTerminalPanelClass({ BaseWidget, PanelLayout, Widget, Emitter }) {
  return class TerminalPanel extends BaseWidget {
    constructor(translate = (_, text) => text) {
      super();
      this.id = TERMINAL_PANEL_ID;
      this.title.label = translate('terminal', 'Terminal');
      this.title.closable = false;
      this.addClass('ynx-terminal-panel');
      this.terminals = [];
      this.changed = new Emitter();
      this.onDidChangeTrackableWidgets = this.changed.event;
      this.toDispose.push(this.changed);
      this.layout = new PanelLayout();
      const header = new Widget();
      header.addClass('ynx-terminal-panel-header');
      this.selector = document.createElement('select');
      this.selector.setAttribute('aria-label', translate('selectTerminal', 'Select terminal'));
      this.selector.addEventListener('change', () => this.activateWidget(this.selector.value));
      header.node.appendChild(this.selector);
      const close = document.createElement('button');
      close.textContent = '×';
      close.title = translate('closeTerminal', 'Close selected terminal');
      close.setAttribute('aria-label', close.title);
      close.addEventListener('click', () => this.selected?.close());
      header.node.appendChild(close);
      this.layout.addWidget(header);
    }
    get selected() { return this.terminals.find(w => w.id === this.activeId && !w.isDisposed); }
    addTerminal(terminal) {
      if (terminal.isDisposed || this.terminals.includes(terminal)) return;
      this.terminals.push(terminal);
      terminal.hide();
      this.layout.addWidget(terminal);
      const titleChanged = () => this.updateSelector();
      terminal.title.changed.connect(titleChanged);
      this.toDispose.push(terminal.onDidDispose(() => {
        terminal.title.changed.disconnect(titleChanged);
        this.terminals = this.terminals.filter(w => w !== terminal);
        if (this.activeId === terminal.id) this.revealWidget(this.terminals.at(-1)?.id);
        this.updateSelector();
        this.changed.fire(this.getTrackableWidgets());
      }));
      if (!this.selected) this.revealWidget(terminal.id);
      this.updateSelector();
      this.changed.fire(this.getTrackableWidgets());
    }
    updateSelector() {
      this.selector.replaceChildren(...this.terminals.filter(w => !w.isDisposed).map(w => {
        const option = document.createElement('option');
        option.value = w.id;
        option.textContent = w.title.label || 'Terminal';
        return option;
      }));
      this.selector.value = this.activeId || '';
    }
    getTrackableWidgets() { return this.terminals.filter(w => !w.isDisposed); }
    revealWidget(id) {
      const selected = this.terminals.find(w => w.id === id && !w.isDisposed);
      for (const terminal of this.terminals) {
        if (terminal === selected) terminal.show(); else terminal.hide();
      }
      this.activeId = selected?.id;
      this.selector.value = this.activeId || '';
      return selected;
    }
    activateWidget(id) {
      const terminal = this.revealWidget(id);
      terminal?.activate();
      return terminal;
    }
    onActivateRequest(message) {
      super.onActivateRequest(message);
      this.selected?.activate();
    }
    storeState() { return { widgets: this.getTrackableWidgets(), activeId: this.activeId }; }
    restoreState(state) {
      for (const terminal of state.widgets || []) if (terminal && !terminal.isDisposed) this.addTerminal(terminal);
      this.revealWidget(state.activeId) || this.revealWidget(this.terminals[0]?.id);
    }
  };
}
class TerminalPanelHandler {
  constructor(shell, widgetManager) {
    this.shell = shell; this.widgetManager = widgetManager; this.priority = 10;
  }
  canGroup(terminal, options) {
    // Explicit editor/split placement and already attached user layout belong
    // to the native shell handler. Never reset a user's restored arrangement.
    if (terminal.isDisposed || terminal.location === 2 || typeof terminal.location === 'object'
      || (options.widgetOptions?.area && options.widgetOptions.area !== 'bottom')
      || options.widgetOptions?.mode?.startsWith('split')
      || (terminal.isAttached && terminal.parent?.id !== TERMINAL_PANEL_ID)) return false;
    return true;
  }
  async onWillOpenTerminal(terminal, options = {}) {
    // Claim retirement, rather than declining into TerminalShellHandler,
    // which would otherwise attach this disposed widget as a fresh tab.
    if (terminal.isDisposed) return true;
    if (!this.canGroup(terminal, options)) return false;
    const panel = await this.widgetManager.getOrCreateWidget(TERMINAL_PANEL_ID);
    if (terminal.isDisposed) return true;
    if (!this.canGroup(terminal, options) || panel.isDisposed) return false;
    panel.addTerminal(terminal);
    if (!panel.isAttached) this.shell.addWidget(panel, { ...options.widgetOptions, area: 'bottom' });
    const mode = options.mode || 'activate';
    if (mode === 'activate') await this.shell.activateWidget(terminal.id);
    else if (mode === 'reveal') await this.shell.revealWidget(terminal.id);
    return true;
  }
}
module.exports = { TERMINAL_PANEL_ID, createTerminalPanelClass, TerminalPanelHandler };
