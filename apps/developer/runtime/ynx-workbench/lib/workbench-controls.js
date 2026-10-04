'use strict';
// Native views and commands stay authoritative. These are discovery controls,
// never runners for arbitrary editor text or shell commands.
const RUN_ACTIONS = Object.freeze([
  { id: 'workbench.action.debug.selectandstart', label: 'Run and Debug…' },
  { id: 'workbench.action.debug.run', label: 'Run Without Debugging' },
  { id: 'task:run:build', label: 'Run Build Task…' },
  { id: 'workbench.action.tasks.runTask', label: 'Run Task…' },
]);
const VIEWS = Object.freeze([
  { key: 'explorer', label: 'Explorer', icon: 'files', area: 'left', command: 'fileNavigator:toggle' },
  { key: 'search', label: 'Search', icon: 'search', area: 'left', command: 'search-in-workspace.toggle' },
  { key: 'scm', label: 'Source Control', icon: 'source-control', area: 'left', command: 'scmView:toggle' },
  { key: 'debug', label: 'Run and Debug', icon: 'debug-alt', area: 'left', command: 'debug:toggle' },
  { key: 'extensions', label: 'Extensions', icon: 'extensions', area: 'left', command: 'vsxExtensions.toggle' },
  { key: 'problems', label: 'Problems', area: 'bottom', command: 'problemsView:toggle' },
  { key: 'output', label: 'Output', area: 'bottom', command: 'output:toggle' },
  { key: 'console', label: 'Debug Console', area: 'bottom', command: 'debug:console:toggle' },
  { key: 'terminal', label: 'Terminal', area: 'bottom', command: 'workbench.action.terminal.toggleTerminal' },
]);
function commandState(registry, id) {
  if (!registry.getCommand(id)) return { enabled: false, reason: 'Unavailable in this runtime' };
  return registry.isEnabled(id) ? { enabled: true, reason: '' } : { enabled: false, reason: 'Currently unavailable' };
}
// Check the real tabbar, including collapsed bottom panel and overflowed tabs.
// A view widget existing in WidgetManager alone does not make its entry visible.
function nativeEntryVisible(shell, widget) {
  if (!widget || widget.isDisposed) return false;
  const bar = shell.getTabBarFor(widget);
  if (!bar || !bar.isVisible || !bar.titles.includes(widget.title)) return false;
  const index = bar.titles.indexOf(widget.title);
  const tab = bar.contentNode && bar.contentNode.children[index];
  if (!tab) return false;
  const rect = tab.getBoundingClientRect();
  const bounds = bar.node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.left >= bounds.left && rect.right <= bounds.right
    && rect.top >= bounds.top && rect.bottom <= bounds.bottom;
}
class WorkbenchControlsContribution {
  // views: {key: native AbstractViewContribution}; terminal is found by widget
  // predicate since each PTY has its own widget. Supply EditorManager so toolbar
  // visibility uses actual EditorWidgets, not URI guesses.
  constructor({ commands, shell, editors, views, messages, translate = (key, text) => text }) {
    Object.assign(this, { commands, shell, editors, views: views || {}, messages });
    this.translate = translate;
    this.disposables = []; this.nodes = []; this.widgets = []; this.stopped = false;
    const { Emitter } = require('@theia/core/lib/common/event');
    this.changed = new Emitter();
  }
  state(id) {
    const state = commandState(this.commands, id);
    return { ...state, reason: state.reason ? this.translate(state.reason === 'Unavailable in this runtime' ? 'unavailableRuntime' : 'currentlyUnavailable', state.reason) : '' };
  }
  async run(id) {
    const state = this.state(id);
    if (!state.enabled) throw new Error(state.reason);
    return this.commands.executeCommand(id);
  }
  viewWidget(view) {
    if (view.key === 'terminal') return this.shell.getWidgets('bottom').find(w => typeof w.id === 'string' && w.id.startsWith('terminal'));
    const native = this.views[view.key];
    return native && native.tryGetWidget();
  }
  missingViews(area) { return VIEWS.filter(v => v.area === area && !nativeEntryVisible(this.shell, this.viewWidget(v))); }
  async openView(key) {
    const view = VIEWS.find(v => v.key === key);
    if (!view) throw new Error('Unknown workbench view');
    if (!this.state(view.command).enabled) throw new Error(this.state(view.command).reason);
    const native = this.views[key];
    if (native) return native.openView({ activate: true, reveal: true });
    // Only terminal has an intentional command fallback: its real toggle
    // contribution creates a PTY when absent and reveals the existing panel.
    if (key === 'terminal') {
      const widget = this.viewWidget(view);
      if (widget) return this.shell.activateWidget(widget.id);
      return this.run(view.command);
    }
    throw new Error('Native view contribution is unavailable');
  }
  report(error) { if (this.messages) this.messages.error(error.message || String(error)); }
  registerToolbarItems(toolbar) {
    const React = require('react');
    this.disposables.push(toolbar.registerItem({
      id: 'ynx.workbench.run-menu', group: 'navigation', priority: 90, onDidChange: this.changed.event,
      isVisible: widget => this.editors.all.includes(widget),
      render: () => React.createElement('details', { className: 'ynx-run-controls', onKeyDown: event => {
        if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary').focus(); }
      } },
        React.createElement('summary', { title: this.translate('runToolbar', 'Run and Debug'), 'aria-label': this.translate('runActionsAria', 'Run and Debug actions') },
          React.createElement('span', { className: 'codicon codicon-play', 'aria-hidden': true }),
          React.createElement('span', { className: 'codicon codicon-chevron-down', 'aria-hidden': true })),
        React.createElement('div', { className: 'ynx-run-menu' }, ...RUN_ACTIONS.map(action => {
          const state = this.state(action.id);
          const label = this.translate(['runAndDebug', 'runWithoutDebugging', 'runBuildTask', 'runTask'][RUN_ACTIONS.indexOf(action)], action.label);
          return React.createElement('button', { key: action.id, type: 'button', disabled: !state.enabled,
            title: state.reason || label, onClick: event => {
              event.currentTarget.closest('details').open = false;
              this.run(action.id).catch(error => this.report(error));
            } }, label);
        })) ),
    }));
  }
  onStart() {
    const document = this.shell.node.ownerDocument;
    const { Widget, BoxPanel, SplitPanel } = require('@theia/core/lib/browser/widgets');
    for (const area of ['left', 'bottom']) {
      const node = document.createElement('nav');
      node.className = `ynx-workbench-discovery ynx-workbench-discovery-${area}`;
      node.setAttribute('aria-label', area === 'left' ? this.translate('workbenchViewsAria', 'Workbench views') : this.translate('panelViewsAria', 'Panel views'));
      const widget = new Widget({ node }); widget.id = `ynx-discovery-${area}`;
      if (area === 'bottom') {
        BoxPanel.setStretch(widget, 0);
        this.shell.layout.insertWidget(this.shell.layout.widgets.indexOf(this.shell.statusBar), widget);
      } else {
        SplitPanel.setStretch(widget, 0);
        this.shell.leftPanelHandler.container.parent.layout.insertWidget(0, widget);
      }
      this.widgets.push(widget); this.nodes.push(node);
    }
    const refresh = () => this.refresh();
    for (const event of [this.commands.onCommandsChanged, this.shell.onDidAddWidget, this.shell.onDidRemoveWidget,
      this.shell.onDidChangeCurrentWidget, this.shell.onDidChangeActiveWidget]) {
      if (event) this.disposables.push(event(refresh));
    }
    // Tab overflow, panel collapse and resizing change discovery even without
    // command changes. Observe layout only; never inspect or simulate clicks.
    const Observer = document.defaultView.ResizeObserver;
    if (Observer) { this.observer = new Observer(refresh); this.observer.observe(this.shell.node); }
    this.timer = setInterval(refresh, 500); // native panel visibility has no public unified event
    this.refresh();
  }
  refresh() {
    if (this.stopped) return;
    const runState = RUN_ACTIONS.map(action => this.state(action.id).enabled).join('|');
    if (runState !== this.runState) { this.runState = runState; this.changed.fire(); }
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i], area = i === 0 ? 'left' : 'bottom';
      const missing = this.missingViews(area);
      const signature = missing.map(v => `${v.key}:${this.state(v.command).enabled}:${!!this.views[v.key]}`).join('|');
      this.widgets[i].setHidden(missing.length === 0);
      if (node.dataset.signature === signature) continue;
      node.dataset.signature = signature; node.replaceChildren();
      for (const view of missing) {
        const label = this.translate('view' + view.key[0].toUpperCase() + view.key.slice(1), view.label);
        const button = node.ownerDocument.createElement('button'); button.type = 'button';
        const state = this.state(view.command), available = state.enabled && (view.key === 'terminal' || !!this.views[view.key]);
        button.disabled = !available; button.setAttribute('aria-label', label);
        button.title = available ? label : `${label}: ${state.reason || this.translate('nativeViewUnavailable', 'Native view contribution is unavailable')}`;
        if (area === 'left') { const icon = node.ownerDocument.createElement('span'); icon.className = `codicon codicon-${view.icon}`; icon.setAttribute('aria-hidden', 'true'); button.appendChild(icon); }
        else button.textContent = label;
        button.addEventListener('click', () => this.openView(view.key).catch(error => this.report(error)));
        node.appendChild(button);
      }
    }
  }
  onStop() { this.dispose(); }
  dispose() {
    this.stopped = true; clearInterval(this.timer); if (this.observer) this.observer.disconnect();
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
    for (const widget of this.widgets.splice(0)) widget.dispose();
    this.nodes.length = 0; this.changed.dispose();
  }
}
module.exports = { WorkbenchControlsContribution, RUN_ACTIONS, VIEWS, commandState, nativeEntryVisible };
