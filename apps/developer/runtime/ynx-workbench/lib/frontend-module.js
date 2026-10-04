const { ContainerModule } = require('@theia/core/shared/inversify');
const { FrontendApplicationContribution, KeybindingContribution } = require('@theia/core/lib/browser');
const { CommonCommands } = require('@theia/core/lib/browser/common-commands');
const { Widget } = require('@theia/core/lib/browser/widgets');
const { ViewContainer, ViewContainerIdentifier } = require('@theia/core/lib/browser/view-container');
const { YnxViewContainer } = require('./view-container');
const { VSXExtension } = require('@theia/vsx-registry/lib/browser/vsx-extension');
const { YnxVSXExtension } = require('./extension-lifecycle');
const { DraftRecoveryContribution } = require('./draft-recovery');
const { EditorManager } = require('@theia/editor/lib/browser');
const { MessageService } = require('@theia/core/lib/common/message-service');
const { FrontendApplicationStateService } = require('@theia/core/lib/browser/frontend-application-state');
const { WebSocketConnectionProvider } = require('@theia/core/lib/browser/messaging/ws-connection-provider');
const { ProblemMatcherRegistry } = require('@theia/task/lib/browser/task-problem-matcher-registry');
const { CommandContribution, CommandRegistry } = require('@theia/core/lib/common/command');
const { MenuContribution } = require('@theia/core/lib/common/menu');
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
const { KeyboardShortcutsWidget, KeyboardShortcutsContribution, KEYBOARD_SHORTCUTS_ID } = require('./keyboard-shortcuts');
require('./token-cache-adapter').install();
require('./dialog-accept-adapter').install();
require('../style/brand.css');
require('../style/keyboard-shortcuts.css');
const logo = require('../assets/ynx-logo.png');
module.exports.default = new ContainerModule((bind, unbind, isBound, rebind) => {
  rebind(KeybindingRegistry).to(YnxKeybindingRegistry).inSingletonScope();
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
      registry.registerKeybinding({ command: CommonCommands.CLOSE_MAIN_TAB.id, keybinding: 'ctrlcmd+w' });
      registry.registerKeybinding({ command: 'editor.action.rename', keybinding: 'f2', when: 'editorTextFocus' });
      registry.registerKeybinding({ command: 'editor.action.revealDefinition', keybinding: 'f12', when: 'editorTextFocus' });
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
