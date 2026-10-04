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
require('../style/brand.css');
const logo = require('../assets/ynx-logo.png');
module.exports.default = new ContainerModule((bind, unbind, isBound, rebind) => {
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
