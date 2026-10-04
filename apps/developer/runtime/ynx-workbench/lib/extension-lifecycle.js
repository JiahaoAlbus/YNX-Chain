const { injectable } = require('@theia/core/shared/inversify');
const { VSXExtension } = require('@theia/vsx-registry/lib/browser/vsx-extension');

// A dynamically enabled language service can report "deployed" before its
// existing editor documents are usable. Keep the standard Reload Window action
// until a fresh extension host is created. The framework owns reload/dirty-file
// confirmation; enabling never silently reloads or modifies project contents.
class YnxVSXExtension extends VSXExtension {
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
module.exports = { YnxVSXExtension };
