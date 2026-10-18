'use strict';
// Native views and commands stay authoritative. These are discovery controls,
// never runners for arbitrary editor text or shell commands.
const RUN_MENU = Object.freeze(['ynx-workbench-run']);
const RUN_ACTIONS = Object.freeze([
  { id: 'ynx.workbench.debugCurrentFile', label: 'Run and Debug…' },
  { id: 'ynx.workbench.runCurrentFile', label: 'Run Without Debugging' },
  { id: 'task:run:build', label: 'Run Build Task…' },
  { id: 'workbench.action.tasks.runTask', label: 'Run Task…' },
]);
const CPP_ACTIONS = Object.freeze([{ id: 'ynx.cpp.runActive', label: 'Run C/C++ File' }, { id: 'ynx.cpp.debugActive', label: 'Debug C/C++ File' }]);
const JS_ACTIONS = Object.freeze([{ id: 'ynx.js.runActive', label: 'Run JavaScript File' }, { id: 'ynx.js.debugActive', label: 'Debug JavaScript File' }]);
const TS_ACTIONS = Object.freeze([{ id: 'ynx.ts.runActive', label: 'Run TypeScript File' }, { id: 'ynx.ts.debugActive', label: 'Debug TypeScript File' }, { id: 'ynx.ts.cancel', label: 'Cancel TypeScript Build' }]);
const GO_ACTIONS = Object.freeze([{ id: 'ynx.go.run', label: 'Run Go Project' }, { id: 'ynx.go.cancel', label: 'Cancel Go Task' }]);
const PYTHON_ACTIONS = Object.freeze([{ id: 'python.execInTerminal', label: 'Run Python File' }, { id: 'debugpy.debugInTerminal', label: 'Debug Python File' }]);
const PROJECT_ACTIONS = Object.freeze([
  { id: 'core.save', label: 'Save', icon: 'save' },
  { id: 'task:run:build', label: 'Build', icon: 'tools' },
  { id: 'testing.runAll', label: 'Test', icon: 'beaker' },
  { id: 'ynx.workbench.ecosystem', label: 'YNX Ecosystem', icon: 'link' },
  { id: 'ynx.contracts.focus', label: 'Contracts', icon: 'symbol-class' },
  { id: 'ynx.network.focus', label: 'Chain and Results', icon: 'link' },
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
function nativeLeftBarVisible(shell) {
  const bar = shell.leftPanelHandler && shell.leftPanelHandler.tabBar;
  if (!bar || !bar.isVisible || !bar.node) return false;
  const rect = bar.node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
class WorkbenchControlsContribution {
  // views: {key: native AbstractViewContribution}; terminal is found by widget
  // predicate since each PTY has its own widget. Supply EditorManager so toolbar
  // visibility uses actual EditorWidgets, not URI guesses.
  constructor({ commands, shell, editors, views, messages, contextMenus, contextKeys, debugConfigurations, translate = (key, text) => text }) {
    Object.assign(this, { commands, shell, editors, views: views || {}, messages, contextMenus });
    this.translate = (key, text) => {
      const translated = translate(key, text);
      return typeof translated === 'string' && translated.trim() ? translated : text;
    };
    this.debugConfigurations = debugConfigurations;
    this.disposables = []; this.nodes = []; this.widgets = []; this.discoveryWidgets = []; this.stopped = false;
    const { Emitter } = require('@theia/core/lib/common/event');
    this.changed = new Emitter();
    // Monaco supplies this key only in its focused editor scope. Extension
    // command-palette conditions also need the actual current editor language.
    this.noSelectedDebug = contextKeys && contextKeys.createKey('ynxNoSelectedDebugConfiguration', !debugConfigurations?.current);
    this.editorLanguage = contextKeys && contextKeys.createKey('editorLangId', undefined);
  }
  registerCommands(registry) {
    this.disposables.push(registry.registerCommand({ id: 'workbench.actions.view.problems' }, {
      execute: () => {
        if (!this.views.problems) throw Error('Native Problems view contribution is unavailable');
        return this.views.problems.openView({ activate: true, reveal: true });
      },
    }));
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
    if (view.key === 'terminal') return ['bottom', 'main', 'left', 'right'].flatMap(area => this.shell.getWidgets(area)).find(w => typeof w.id === 'string' && w.id.startsWith('terminal'));
    const native = this.views[view.key];
    return native && native.tryGetWidget();
  }
  missingViews(area) {
    // Native activity bars contain view containers, whereas tryGetWidget may
    // return a child view. Do not create another rail beside a visible native
    // activity bar merely because those identities differ.
    if (area === 'left' && nativeLeftBarVisible(this.shell)) return [];
    return VIEWS.filter(v => v.area === area && !nativeEntryVisible(this.shell, this.viewWidget(v)));
  }
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
  async initializeLayout() {
    // Called only when the framework creates a default layout. Attach static
    // native panel views in one tab group without activating or creating a PTY.
    // Restored user layouts never pass through this hook.
    let reference = this.shell.getWidgets('bottom').find(widget => !widget.isDisposed);
    for (const view of VIEWS.filter(view => view.area === 'bottom' && view.key !== 'terminal')) {
      if (this.stopped) return;
      const native = this.views[view.key];
      if (!native || !this.state(view.command).enabled) continue;
      const existing = native.tryGetWidget();
      if (existing && this.shell.getTabBarFor(existing)) { reference = existing; continue; }
      try {
        const widget = await native.openView({ area: 'bottom', activate: false, reveal: false,
          ...(reference ? { ref: reference, mode: 'tab-after' } : {}) });
        if (widget && !widget.isDisposed) reference = widget;
      } catch (error) { this.report(error); }
    }
    this.refresh();
  }
  onDidInitializeLayout() { this.refresh(); }
  registerMenus(menus) {
    for (const [index, action] of TS_ACTIONS.entries()) this.disposables.push(menus.registerMenuAction([...RUN_MENU, 'typescript'], {
      commandId: action.id, label: this.translate(['runTsFile', 'debugTsFile', 'cancelTsBuild'][index], action.label),
      when: 'editorLangId == typescript || editorLangId == typescriptreact', order: String(index),
    }));
    for (const [index, action] of PYTHON_ACTIONS.entries()) this.disposables.push(menus.registerMenuAction([...RUN_MENU, 'python'], {
      commandId: action.id, label: this.translate(index ? 'debugPythonFile' : 'runPythonFile', action.label),
      when: 'editorLangId == python', order: String(index),
    }));
    for (const [index, action] of CPP_ACTIONS.entries()) this.disposables.push(menus.registerMenuAction([...RUN_MENU, 'cpp'], {
      commandId: action.id, label: this.translate(index ? 'debugCppFile' : 'runCppFile', action.label),
      when: 'editorLangId == cpp || editorLangId == c', order: String(index),
    }));
    for (const [index, action] of JS_ACTIONS.entries()) this.disposables.push(menus.registerMenuAction([...RUN_MENU, 'javascript'], {
      commandId: action.id, label: this.translate(index ? 'debugJsFile' : 'runJsFile', action.label),
      when: 'editorLangId == javascript', order: String(index),
    }));
    for (const [index, action] of GO_ACTIONS.entries()) this.disposables.push(menus.registerMenuAction([...RUN_MENU, 'go'], {
      commandId: action.id, label: this.translate(index ? 'cancelGoTask' : 'runGoProject', action.label),
      when: 'editorLangId == go', order: String(index),
    }));
    RUN_ACTIONS.forEach((action, index) => this.disposables.push(menus.registerMenuAction([...RUN_MENU, 'actions'], {
      commandId: action.id,
      label: this.translate(['runAndDebug', 'runWithoutDebugging', 'runBuildTask', 'runTask'][index], action.label),
      order: String(index),
    })));
  }
  openRunMenu(button, widget) {
    if (this.stopped) return;
    if (!this.contextMenus) throw new Error(this.translate('unavailableRuntime', 'Unavailable in this runtime'));
    this.closeRunMenu();
    const rect = button.getBoundingClientRect();
    let access, cleanup = () => {};
    const retire = () => {
      cleanup();
      // A delayed hide from a previous popup must not retire its successor.
      if (this.popup === access) {
        this.popup = undefined; this.popupCleanup = undefined;
        this.popupEditor = undefined; this.popupDocument = undefined;
      }
    };
    access = this.contextMenus.render({ menuPath: RUN_MENU, anchor: { x: rect.left, y: rect.bottom },
      context: widget && widget.node || button, args: [], includeAnchorArg: false,
      onHide: retire,
    });
    this.popup = access; this.popupCleanup = retire;
    this.popupEditor = widget; this.popupDocument = widget?.editor?.document;
    const menu = access.menu;
    if (menu?.node && menu.contentNode) {
      const select = event => {
        if (this.stopped || this.popup !== access || access.disposed || !menu.isAttached) return false;
        if (widget && (widget.isDisposed || this.editors.currentEditor !== widget
          || widget.editor?.document !== this.popupDocument)) { this.closeRunMenu(); return false; }
        if (event.button !== 0) return false;
        // Remote and accessibility clicks may contain no mousemove. Select the
        // actual hit row before Lumino's normal mouseup handler executes it.
        // The framework still owns selectable/disabled checks and dispatch.
        menu.activeIndex = Array.from(menu.contentNode.children).findIndex(node => {
          if (event.target && (node === event.target || node.contains?.(event.target))) return true;
          const bounds = node.getBoundingClientRect();
          return event.clientX >= bounds.left && event.clientX < bounds.right
            && event.clientY >= bounds.top && event.clientY < bounds.bottom;
        });
        return menu.activeIndex >= 0;
      };
      // WebKit accessibility may emit click without pointer down/up. Reuse the
      // framework dispatcher for that normal activation. A physical mouseup
      // already closes the popup, so its subsequent click cannot dispatch twice.
      const activate = event => { if (select(event)) menu.triggerActiveItem(); };
      menu.node.addEventListener('mousedown', select, true);
      menu.node.addEventListener('click', activate, true);
      const disposed = access.onDispose?.(retire);
      cleanup = () => { menu.node.removeEventListener('mousedown', select, true); menu.node.removeEventListener('click', activate, true); disposed?.dispose(); };
    }
  }
  closeRunMenu() {
    const access = this.popup;
    this.popupCleanup?.();
    this.popup = undefined; this.popupCleanup = undefined;
    this.popupEditor = undefined; this.popupDocument = undefined;
    access?.dispose();
  }
  primaryRunLabel() {
    const editor = this.editors.currentEditor?.editor;
    return !this.debugConfigurations?.current && editor?.uri?.scheme === 'file' && editor.document?.languageId === 'solidity'
      ? this.translate('compileSolidityProject', 'Compile Solidity project')
      : this.translate('runCurrentTarget', 'Run current file or project');
  }
  registerToolbarItems(toolbar) {
    const React = require('react');
    this.disposables.push(toolbar.registerItem({
      id: 'ynx.workbench.run-menu', group: 'navigation', priority: 90, onDidChange: this.changed.event,
      isVisible: widget => this.editors.all.includes(widget),
      render: widget => React.createElement('span', { className: 'ynx-run-controls-group', role: 'group',
        'aria-label': this.translate('runActionsAria', 'Run and Debug actions') },
        React.createElement('button', { type: 'button', className: 'ynx-run-controls',
          title: this.primaryRunLabel(),
          'aria-label': this.primaryRunLabel(),
          disabled: !this.state('ynx.workbench.runCurrentFile').enabled,
          onMouseDown: event => event.preventDefault(),
          onClick: () => {
            if (this.stopped || widget.isDisposed || this.editors.currentEditor !== widget) return;
            this.closeRunMenu();
            return this.run('ynx.workbench.runCurrentFile').catch(error => this.report(error));
          },
        }, React.createElement('span', { className: 'codicon codicon-play', 'aria-hidden': true })),
        React.createElement('button', { type: 'button', className: 'ynx-run-controls',
          title: this.translate('runOptions', 'More run and debug options'),
          'aria-label': this.translate('runOptions', 'More run and debug options'), 'aria-haspopup': 'menu',
          disabled: !this.contextMenus,
          onMouseDown: event => event.preventDefault(),
          onClick: event => { try { this.openRunMenu(event.currentTarget, widget); } catch (error) { this.report(error); } },
        }, React.createElement('span', { className: 'codicon codicon-chevron-down', 'aria-hidden': true }))),
    }));
  }
  onStart() {
    const document = this.shell.node.ownerDocument;
    const { Widget, SplitPanel } = require('@theia/core/lib/browser/widgets');
    const actions = document.createElement('nav');
    actions.className = 'ynx-project-actions';
    actions.setAttribute('aria-label', this.translate('projectActions', 'Project actions'));
    this.projectButtons = [];
    for (const action of PROJECT_ACTIONS) {
      const button = document.createElement('button'); button.type = 'button';
      const label = this.translate(action.id, action.label);
      button.setAttribute('aria-label', label);
      const icon = document.createElement('span'); icon.className = `codicon codicon-${action.icon}`; icon.setAttribute('aria-hidden', 'true');
      button.append(icon, document.createTextNode(label));
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => this.run(action.id).catch(error => this.report(error)));
      actions.appendChild(button); this.projectButtons.push({ button, action, label });
    }
    const run = document.createElement('button'); run.type = 'button';
    run.textContent = this.translate('runAndDebug', 'Run and Debug…');
    run.setAttribute('aria-haspopup', 'menu');
    run.addEventListener('mousedown', event => event.preventDefault());
    run.addEventListener('click', () => { try { this.openRunMenu(run, this.editors.currentEditor); } catch (error) { this.report(error); } });
    actions.insertBefore(run, actions.children[1]); this.projectRun = run;
    const actionsWidget = new Widget({ node: actions }); actionsWidget.id = 'ynx-project-actions';
    this.shell.topPanel.addWidget(actionsWidget); this.widgets.push(actionsWidget);
    for (const area of ['left']) {
      const node = document.createElement('nav');
      node.className = `ynx-workbench-discovery ynx-workbench-discovery-${area}`;
      node.setAttribute('aria-label', area === 'left' ? this.translate('workbenchViewsAria', 'Workbench views') : this.translate('panelViewsAria', 'Panel views'));
      const widget = new Widget({ node }); widget.id = `ynx-discovery-${area}`;
      SplitPanel.setStretch(widget, 0);
      this.shell.leftPanelHandler.container.parent.layout.insertWidget(0, widget);
      this.widgets.push(widget); this.discoveryWidgets.push(widget); this.nodes.push(node);
    }
    const refresh = () => this.refresh();
    for (const event of [this.commands.onCommandsChanged, this.shell.onDidAddWidget, this.shell.onDidRemoveWidget,
      this.shell.onDidChangeCurrentWidget, this.shell.onDidChangeActiveWidget, this.editors.onCurrentEditorChanged, this.debugConfigurations?.onDidChange]) {
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
    if (this.popup && this.popupEditor && (this.popupEditor.isDisposed
      || this.editors.currentEditor !== this.popupEditor
      || this.popupEditor.editor?.document !== this.popupDocument)) this.closeRunMenu();
    for (const { button, action, label } of this.projectButtons || []) {
      const state = this.state(action.id); button.disabled = !state.enabled;
      button.title = state.enabled ? label : `${label}: ${state.reason}`;
    }
    if (this.projectRun) this.projectRun.disabled = !this.editors.currentEditor || !this.contextMenus;
    if (this.noSelectedDebug) this.noSelectedDebug.set(!this.debugConfigurations?.current);
    const editor = this.editors.currentEditor;
    if (this.editorLanguage) this.editorLanguage.set(editor && !editor.isDisposed ? editor.editor?.document?.languageId : undefined);
    const runState = [this.primaryRunLabel(), ...[...RUN_ACTIONS, ...CPP_ACTIONS, ...JS_ACTIONS, ...TS_ACTIONS, ...GO_ACTIONS, ...PYTHON_ACTIONS].map(action => this.state(action.id).enabled)].join('|');
    if (runState !== this.runState) { this.runState = runState; this.changed.fire(); }
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i], area = i === 0 ? 'left' : 'bottom';
      const missing = this.missingViews(area);
      const signature = missing.map(v => `${v.key}:${this.state(v.command).enabled}:${!!this.views[v.key]}`).join('|');
      this.discoveryWidgets[i].setHidden(missing.length === 0);
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
    this.stopped = true; this.closeRunMenu(); clearInterval(this.timer); if (this.observer) this.observer.disconnect();
    if (this.editorLanguage) this.editorLanguage.reset();
    if (this.noSelectedDebug) this.noSelectedDebug.reset();
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
    for (const widget of this.widgets.splice(0)) widget.dispose();
    this.nodes.length = 0; this.discoveryWidgets.length = 0; this.changed.dispose();
  }
}
module.exports = { WorkbenchControlsContribution, RUN_MENU, RUN_ACTIONS, CPP_ACTIONS, PROJECT_ACTIONS, VIEWS, commandState, nativeEntryVisible, nativeLeftBarVisible };
