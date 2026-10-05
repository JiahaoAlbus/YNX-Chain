const { dirname, join } = require('node:path');
const { VsCodePluginScanner } = require('@theia/plugin-ext-vscode/lib/node/scanner-vscode');
const installed = Symbol.for('ynx.vscode.lifecycle-adapter');
exports.install = () => {
  const prototype = VsCodePluginScanner.prototype;
  if (prototype[installed]) return;
  const getLifecycle = prototype.getLifecycle;
  prototype.getLifecycle = function (plugin) {
    const lifecycle = getLifecycle.call(this, plugin);
    return { ...lifecycle, backendInitPath: join(dirname(lifecycle.backendInitPath), 'ynx-plugin-vscode-init.js') };
  };
  Object.defineProperty(prototype, installed, { value: true });
};
