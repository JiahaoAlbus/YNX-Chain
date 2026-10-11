const { injectable } = require('@theia/core/shared/inversify');
const { VSXExtension } = require('@theia/vsx-registry/lib/browser/vsx-extension');

// Presentation only. Package IDs, publishers, verification and legal notices
// remain the original authoritative metadata used by the framework.
function extensionDisplayName(id, name) {
  if (id?.toLowerCase() === 'ms-ceintl.vscode-language-pack-zh-hans') return '简体中文语言包';
  if (id?.toLowerCase() === 'ms-ceintl.vscode-language-pack-zh-hant') return '繁體中文語言包';
  const label = String(name || id || 'Extension').replace(/\s+for\s+(?:Visual Studio Code|VS\s*Code)\b/gi, '')
    .replace(/Visual Studio Code|VS[\s-]*Code/gi, '').replace(/\s{2,}/g, ' ').trim();
  return label || 'Extension';
}

// A dynamically enabled language service can report "deployed" before its
// existing editor documents are usable. Keep the standard Reload Window action
// until a fresh extension host is created. The framework owns reload/dirty-file
// confirmation; enabling never silently reloads or modifies project contents.
class YnxVSXExtension extends VSXExtension {
  get displayName() { return extensionDisplayName(this.id, super.displayName); }
  runTask(name, task) {
    if (this._currentTask) return Promise.reject('busy');
    this._currentTaskName = name;
    // Return the cleanup chain itself. The retained framework drops the
    // promise returned by finally(), creating an unhandled rejection on a
    // failed deployment, and leaves its busy state set on synchronous failure.
    const pending = Promise.resolve().then(task).finally(() => {
      if (this._currentTask === pending) {
        this._currentTask = undefined;
        this._currentTaskName = undefined;
      }
    });
    this._currentTask = pending;
    return pending;
  }
  get deployed() { return this.needsHostReload ? false : super.deployed; }
  async enable() {
    await super.enable();
    this.needsHostReload = true;
    await this.model.doChange(async () => {});
  }
  async disable() {
    this.needsHostReload = false;
    return super.disable();
  }
}
injectable()(YnxVSXExtension);
module.exports = { YnxVSXExtension, extensionDisplayName };
