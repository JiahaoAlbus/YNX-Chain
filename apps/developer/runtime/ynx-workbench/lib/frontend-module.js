const { ContainerModule } = require('@theia/core/shared/inversify');
const { FrontendApplicationContribution, KeybindingContribution } = require('@theia/core/lib/browser');
const { CommonCommands } = require('@theia/core/lib/browser/common-commands');
const { Widget } = require('@theia/core/lib/browser/widgets');
require('../style/brand.css');
const logo = require('../assets/ynx-logo.png');
module.exports.default = new ContainerModule(bind => {
  bind(KeybindingContribution).toConstantValue({
    registerKeybindings(registry) {
      registry.registerKeybinding({ command: CommonCommands.CLOSE_MAIN_TAB.id, keybinding: 'ctrlcmd+w', when: 'editorTextFocus' });
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
