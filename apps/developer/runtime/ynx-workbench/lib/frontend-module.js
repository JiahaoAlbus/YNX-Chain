const { ContainerModule } = require('@theia/core/shared/inversify');
require('./reconnection-lifecycle').install();
require('./native-startup-frame').install();
require('./terminal-ui-trace').install();
require('./task-terminal-attachment').install();
require('./tree-cycle-guard').install();
require('./debug-variable-fetch-adapter').install();
const debugStatePersistence = require('./debug-state-persistence');
debugStatePersistence.install();
require('./test-range-adapter').install();
require('./test-tree-state-adapter').install();
require('./test-run-empty-state-adapter').install();
const { FrontendApplicationContribution, KeybindingContribution } = require('@theia/core/lib/browser');
const { CommonCommands } = require('@theia/core/lib/browser/common-commands');
const { Widget } = require('@theia/core/lib/browser/widgets');
const { ViewContainer, ViewContainerIdentifier } = require('@theia/core/lib/browser/view-container');
const { YnxViewContainer } = require('./view-container');
const { VSXExtension } = require('@theia/vsx-registry/lib/browser/vsx-extension');
const { YnxVSXExtension } = require('./extension-lifecycle');
const { DraftRecoveryContribution } = require('./draft-recovery');
const { EditorManager } = require('@theia/editor/lib/browser');
const { HostedPluginSupport } = require('@theia/plugin-ext/lib/hosted/browser/hosted-plugin');
const { LanguageCommandReadiness } = require('./language-command-readiness');
const { MonacoCommandService } = require('@theia/monaco/lib/browser/monaco-command-service');
const { MessageService } = require('@theia/core/lib/common/message-service');
const { FrontendApplicationStateService } = require('@theia/core/lib/browser/frontend-application-state');
const { WebSocketConnectionProvider } = require('@theia/core/lib/browser/messaging/ws-connection-provider');
const { ProcessTaskResolver } = require('@theia/task/lib/browser/process/process-task-resolver');
const { TaskConfigurations } = require('@theia/task/lib/browser/task-configurations');
const { GeneratedCppTaskGuard } = require('./generated-cpp-task-guard');
const OriginalProcessTaskResolver = Symbol('YNX original process task resolver');
const { ProblemMatcherRegistry } = require('@theia/task/lib/browser/task-problem-matcher-registry');
const { CommandContribution, CommandRegistry } = require('@theia/core/lib/common/command');
const { nls } = require('@theia/core/lib/common/nls');
const { MenuContribution } = require('@theia/core/lib/common/menu');
const { ContextMenuRenderer } = require('@theia/core/lib/browser/context-menu-renderer');
const { DebugConfigurationManager } = require('@theia/debug/lib/browser/debug-configuration-manager');
const { BreakpointManager } = require('@theia/debug/lib/browser/breakpoint/breakpoint-manager');
const { DebugWatchManager } = require('@theia/debug/lib/browser/debug-watch-manager');
const { DebugSelectionContribution } = require('./debug-selection');
const { UserKeybindingsContribution } = require('./user-keybindings');
const { WorkspaceKeybindingsContribution, ShortcutSettings } = require('./workspace-keybindings');
const { WorkspaceService } = require('@theia/workspace/lib/browser/workspace-service');
const { JsonSchemaPolicyStatus } = require('./json-schema-policy-status');
const { PreferenceService } = require('@theia/core/lib/common/preferences');
const { StatusBar } = require('@theia/core/lib/browser/status-bar/status-bar');
const { FileService } = require('@theia/filesystem/lib/browser/file-service');
const { EnvVariablesServer } = require('@theia/core/lib/common/env-variables/env-variables-protocol');
const { KeybindingRegistry } = require('@theia/core/lib/browser/keybinding');
const { YnxKeybindingRegistry } = require('./keybinding-registry');
const { WidgetFactory, WidgetManager } = require('@theia/core/lib/browser/widget-manager');
const { ApplicationShell } = require('@theia/core/lib/browser/shell/application-shell');
const { WindowService } = require('@theia/core/lib/browser/window/window-service');
const { NativeWindowClose } = require('./native-window-close');
const { NativeWorkbenchCommands } = require('./native-workbench-commands');
const { LocalWorkspaceContext } = require('./local-workspace-context');
const { LocalTerminalDefaults } = require('./local-terminal-defaults');
const { PythonTerminalLifecycle } = require('./python-terminal-lifecycle');
const { PythonTerminalWidget } = require('./python-terminal-widget');
const { TerminalWidget } = require('@theia/terminal/lib/browser/base/terminal-widget');
const { TerminalService } = require('@theia/terminal/lib/browser/base/terminal-service');
const { TerminalWatcher } = require('@theia/terminal/lib/common/terminal-watcher');
const { DebugSessionManager } = require('@theia/debug/lib/browser/debug-session-manager');
const { PreferenceSchemaService } = require('@theia/core/lib/common/preferences/preference-schema');
const { WorkbenchControlsContribution } = require('./workbench-controls');
const { ContextKeyService } = require('@theia/core/lib/browser/context-key-service');
const { TabBarToolbarContribution } = require('@theia/core/lib/browser/shell/tab-bar-toolbar');
const { FileNavigatorContribution } = require('@theia/navigator/lib/browser/navigator-contribution');
const { SearchInWorkspaceFrontendContribution } = require('@theia/search-in-workspace/lib/browser/search-in-workspace-frontend-contribution');
const { ScmContribution } = require('@theia/scm/lib/browser/scm-contribution');
const { DebugFrontendApplicationContribution } = require('@theia/debug/lib/browser/debug-frontend-application-contribution');
const { VSXExtensionsContribution } = require('@theia/vsx-registry/lib/browser/vsx-extensions-contribution');
const { ProblemContribution } = require('@theia/markers/lib/browser/problem/problem-contribution');
const { OutputContribution } = require('@theia/output/lib/browser/output-contribution');
const { DebugConsoleContribution } = require('@theia/debug/lib/browser/console/debug-console-contribution');
const { LocalStorageService } = require('@theia/core/lib/browser/storage-service');
const { ShellLayoutRestorer } = require('@theia/core/lib/browser/shell/shell-layout-restorer');
const { LocalWorkbenchStorage } = require('./local-workbench-storage');
const OriginalBrowserStorage = Symbol('YNX original browser UI storage');
const { NativeWalletService, NativeWalletWidget, NativeWalletContribution, NATIVE_WALLET_ID } = require('./native-wallet-view');
const { KeyboardShortcutsWidget, KeyboardShortcutsContribution, KEYBOARD_SHORTCUTS_ID } = require('./keyboard-shortcuts');
require('./token-cache-adapter').install();
require('./quick-input-keybinding-label-adapter').install();
require('./dialog-accept-adapter').install();
require('./review-preview-adapter').install();
const workspaceTextEdits = require('./workspace-text-edit-adapter');
workspaceTextEdits.install();
require('./search-replace-transaction').install();
require('../style/brand.css');
require('../style/keyboard-shortcuts.css');
require('../style/workbench-controls.css');
const logo = require('../assets/ynx-logo.png');
const translateWorkbench = (key, text) => nls.localize('ynx/workbench/' + key, text);
const LocalWorkspaceContextApi = Symbol('YNXLocalWorkspaceContextApi');
module.exports.default = new ContainerModule((bind, unbind, isBound, rebind) => {
  require('./shell-command-env').bindEnvironmentOrderedShellCommandBuilder(rebind);
  bind(FrontendApplicationContribution).toDynamicValue(context => new (require('./local-js-debug-terminal').LocalJsDebugTerminalContribution)(context.container.get(LocalWorkspaceContextApi), context.container.get(DebugSessionManager))).inSingletonScope();
  require('./native-trash-file-service').bindNativeTrash(bind, rebind, LocalWorkspaceContextApi, window);
  rebind(TerminalWidget).to(PythonTerminalWidget).inTransientScope();
  bind(PythonTerminalLifecycle).toDynamicValue(context => new PythonTerminalLifecycle(
    context.container.get(LocalWorkspaceContextApi), context.container.get(TerminalService), context.container.get(TerminalWatcher), context.container.get(DebugSessionManager),
  )).inSingletonScope();
  bind(CommandContribution).toService(PythonTerminalLifecycle);
  bind(FrontendApplicationContribution).toService(PythonTerminalLifecycle);
  bind(LocalWorkspaceContextApi).toDynamicValue(context => WebSocketConnectionProvider.createProxy(
    context.container, '/services/ynx-local-workbench-context',
  )).inSingletonScope();
  bind(FrontendApplicationContribution).toDynamicValue(context => ({
    onStart() {
      workspaceTextEdits.setNotification(message => context.container.get(MessageService).warn(message));
      require('./task-terminal-attachment').setNotification(() => context.container.get(MessageService).error(
        String(nls.locale || '').startsWith('zh') ? '终端输出连接失败，请关闭该终端后重试。' : 'Terminal output could not connect. Close this terminal and retry.'));
    },
  })).inSingletonScope();
  bind(OriginalProcessTaskResolver).to(ProcessTaskResolver).inSingletonScope();
  rebind(ProcessTaskResolver).toDynamicValue(context => new GeneratedCppTaskGuard(
    context.container.get(OriginalProcessTaskResolver), context.container.get(TaskConfigurations), context.container.get(MessageService), context.container.get(CommandRegistry), nls.locale,
  )).inSingletonScope();
  bind(OriginalBrowserStorage).to(LocalStorageService).inSingletonScope();
  rebind(LocalStorageService).toDynamicValue(context => new LocalWorkbenchStorage(
    context.container.get(OriginalBrowserStorage), WebSocketConnectionProvider.createProxy(context.container, '/services/ynx-local-workbench-storage'), context.container.get(MessageService),
  )).inSingletonScope();
  bind(FrontendApplicationContribution).toDynamicValue(context => new NativeWindowClose(
    context.container.get(WindowService), window, context.container.get(ShellLayoutRestorer), context.container.get(LocalStorageService),
    () => debugStatePersistence.persistDebugState([context.container.get(DebugConfigurationManager), context.container.get(BreakpointManager), context.container.get(DebugWatchManager)]),
    () => context.container.get(DebugSessionManager),
  )).inSingletonScope();
  bind(FrontendApplicationContribution).toDynamicValue(context => new NativeWorkbenchCommands(
    context.container.get(CommandRegistry), window, nls.locale,
  )).inSingletonScope();
  bind(NativeWalletService).toDynamicValue(context => new NativeWalletService(window, WebSocketConnectionProvider.createProxy(context.container, '/services/ynx-wallet-admission'))).inSingletonScope();
  bind(FrontendApplicationContribution).toService(NativeWalletService);
  bind(WidgetFactory).toDynamicValue(context => ({ id: NATIVE_WALLET_ID, createWidget: () => new NativeWalletWidget(context.container.get(NativeWalletService)) }));
  bind(NativeWalletContribution).toDynamicValue(context => new NativeWalletContribution(context.container.get(WidgetManager), context.container.get(ApplicationShell))).inSingletonScope();
  bind(CommandContribution).toService(NativeWalletContribution);
  bind(MenuContribution).toService(NativeWalletContribution);
  bind(WorkbenchControlsContribution).toDynamicValue(context => new WorkbenchControlsContribution({
    commands: context.container.get(CommandRegistry), shell: context.container.get(ApplicationShell),
    contextKeys: context.container.get(ContextKeyService),
    editors: context.container.get(EditorManager), messages: context.container.get(MessageService),
    debugConfigurations: context.container.get(DebugConfigurationManager),
    translate: translateWorkbench, contextMenus: context.container.get(ContextMenuRenderer),
    views: { explorer: context.container.get(FileNavigatorContribution), search: context.container.get(SearchInWorkspaceFrontendContribution),
      scm: context.container.get(ScmContribution), debug: context.container.get(DebugFrontendApplicationContribution),
      extensions: context.container.get(VSXExtensionsContribution), problems: context.container.get(ProblemContribution),
      output: context.container.get(OutputContribution), console: context.container.get(DebugConsoleContribution) },
  })).inSingletonScope();
  bind(FrontendApplicationContribution).toService(WorkbenchControlsContribution);
  bind(TabBarToolbarContribution).toService(WorkbenchControlsContribution);
  bind(MenuContribution).toService(WorkbenchControlsContribution);
  bind(CommandContribution).toService(WorkbenchControlsContribution);
  bind(LocalWorkspaceContext).toDynamicValue(context => new LocalWorkspaceContext(
    context.container.get(WorkspaceService), context.container.get(LocalWorkspaceContextApi),
    context.container.get(CommandRegistry), context.container.get(MessageService), window, translateWorkbench,
  )).inSingletonScope();
  bind(CommandContribution).toService(LocalWorkspaceContext);
  bind(FrontendApplicationContribution).toService(LocalWorkspaceContext);
  bind(FrontendApplicationContribution).toDynamicValue(context => new (require('./local-python-defaults').LocalPythonDefaults)(
    context.container.get(LocalWorkspaceContextApi), context.container.get(PreferenceSchemaService),
  )).inSingletonScope();
  bind(FrontendApplicationContribution).toDynamicValue(context => new LocalTerminalDefaults(
    context.container.get(LocalWorkspaceContextApi),
    context.container.get(PreferenceSchemaService),
  )).inSingletonScope();
  rebind(KeybindingRegistry).to(YnxKeybindingRegistry).inSingletonScope();
  bind(CommandContribution).toDynamicValue(context => new LanguageCommandReadiness(
    context.container.get(EditorManager), context.container.get(HostedPluginSupport), context.container.get(MonacoCommandService),
  )).inSingletonScope();
  bind(FrontendApplicationContribution).toDynamicValue(context => new JsonSchemaPolicyStatus(
    context.container.get(EditorManager), context.container.get(PreferenceService), context.container.get(StatusBar),
  )).inSingletonScope();
  bind(CommandContribution).toDynamicValue(context => ({
    registerCommands(registry) {
      registry.registerCommand({ id: 'ynx.workbench.reloadWindow', category: 'Developer', label: 'Reload Window' }, {
        execute: () => registry.executeCommand('workbench.action.reloadWindow'),
      });
    },
  })).inSingletonScope();
  bind(UserKeybindingsContribution).toDynamicValue(context => new UserKeybindingsContribution(
    context.container.get(FileService), context.container.get(EnvVariablesServer), context.container.get(EditorManager),
    context.container.get(KeybindingRegistry), context.container.get(MessageService),
  )).inSingletonScope();
  bind(CommandContribution).toService(UserKeybindingsContribution);
  bind(FrontendApplicationContribution).toService(UserKeybindingsContribution);
  bind(WorkspaceKeybindingsContribution).toDynamicValue(context => new WorkspaceKeybindingsContribution(
    context.container.get(FileService), context.container.get(EnvVariablesServer), context.container.get(EditorManager),
    context.container.get(KeybindingRegistry), context.container.get(MessageService), context.container.get(WorkspaceService),
  )).inSingletonScope();
  bind(CommandContribution).toService(WorkspaceKeybindingsContribution);
  bind(FrontendApplicationContribution).toService(WorkspaceKeybindingsContribution);
  bind(ShortcutSettings).toDynamicValue(context => new ShortcutSettings(
    context.container.get(UserKeybindingsContribution), context.container.get(WorkspaceKeybindingsContribution),
  )).inSingletonScope();
  bind(WidgetFactory).toDynamicValue(context => ({ id: KEYBOARD_SHORTCUTS_ID, createWidget: () => new KeyboardShortcutsWidget(
    context.container.get(ShortcutSettings), context.container.get(KeybindingRegistry), context.container.get(CommandRegistry),
  ) }));
  bind(KeyboardShortcutsContribution).toDynamicValue(context => new KeyboardShortcutsContribution(
    context.container.get(WidgetManager), context.container.get(ApplicationShell),
  )).inSingletonScope();
  bind(CommandContribution).toService(KeyboardShortcutsContribution);
  bind(KeybindingContribution).toService(KeyboardShortcutsContribution);
  bind(MenuContribution).toService(KeyboardShortcutsContribution);
  bind(CommandContribution).toDynamicValue(context => new DebugSelectionContribution(
    context.container.get(CommandRegistry),
  )).inSingletonScope();
  bind(FrontendApplicationContribution).toDynamicValue(context => ({
    async onStart() {
      const registry = context.container.get(ProblemMatcherRegistry);
      await registry.onReady();
      // Standard VS Code GCC/Clang tasks refer to $gcc. The composed framework
      // lacks this matcher, so otherwise valid tasks fail schema validation.
      if (!registry.get('gcc')) registry.register({ name: 'gcc', label: 'GCC / Clang', owner: 'cpp', source: 'gcc',
        fileLocation: ['relative', '${workspaceFolder}'],
        pattern: { regexp: '^(.+):(\\d+):(\\d+):\\s+(warning|error|fatal error):\\s+(.*)$', file: 1, line: 2, column: 3, severity: 4, message: 5 },
      });
    },
  })).inSingletonScope();
  bind(FrontendApplicationContribution).toDynamicValue(context => new DraftRecoveryContribution(
    context.container.get(EditorManager), WebSocketConnectionProvider.createProxy(context.container, '/services/ynx-draft-recovery'),
    context.container.get(MessageService), context.container.get(FrontendApplicationStateService),
  )).inSingletonScope();
  rebind(VSXExtension).to(YnxVSXExtension);
  rebind(ViewContainer.Factory).toFactory(context => options => {
    const child = context.container.createChild();
    child.bind(ViewContainerIdentifier).toConstantValue(options);
    child.bind(YnxViewContainer).toSelf().inSingletonScope();
    return child.get(YnxViewContainer);
  });
  bind(KeybindingContribution).toConstantValue({
    registerKeybindings(registry) {
      // Close the active main tab after a modal cancellation as well. Requiring
      // text focus made a repeated close silently fail when the dialog retired.
      require('./default-keybindings').registerDefaultKeybindings(registry, CommonCommands.CLOSE_MAIN_TAB.id);
    },
  });
  bind(FrontendApplicationContribution).toConstantValue({
    onStart(application) {
      const panel = application.shell.topPanel;
      if (panel.node.querySelector('.ynx-workbench-brand')) return;
      const brand = document.createElement('div'); brand.className = 'ynx-workbench-brand';
      const image = document.createElement('img'); image.src = typeof logo === 'string' ? logo : logo.default; image.alt = 'YNX';
      const title = document.createElement('strong'); title.textContent = 'YNX Developer';
      brand.append(image, title);
      const widget = new Widget({ node: brand }); widget.id = 'ynx-workbench-brand';
      panel.insertWidget(0, widget); panel.show();
    },
  });
});
