const { injectable, inject } = require('@theia/core/shared/inversify');
const { MessageService } = require('@theia/core/lib/common/message-service');
const { CommandRegistry } = require('@theia/core/lib/common/command');
const { nls } = require('@theia/core/lib/common/nls');
const { VSXExtension } = require('@theia/vsx-registry/lib/browser/vsx-extension');
const localize=(key,text)=>nls?.localize?.('ynx/workbench/'+key,text)??text;

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
  async install(options) {
    this.clearLanguagePackActivation();
    try {
      // Capture the version before kernel confirmation waits. Failures before
      // doInstall (including an absent version) must be visible as well.
      const version = options?.version || this.version;
      if (!version) throw Error('Select an extension version before installation.');
      return await super.install({ ...options, version });
    }
    catch (cause) {
      // The standard card event only resets its button in finally(). Report
      // the actual rejected installation explicitly, without serializing an
      // arbitrary provider error or making dismissal a retry/cleanup gate.
      try { Promise.resolve(this.ynxMessages.error(localize('extensionInstallFailed','Extension installation failed. Check the IDE connection diagnostics and extension compatibility, then retry.'))).catch(() => {}); } catch {}
      throw cause;
    }
  }
  async doInstall(options) {
    const result=await super.doInstall(options);
    // Follow-up UI must not turn an already successful deployment into a
    // reported installation failure if its frontend metadata service retires.
    try {this.offerLanguagePackActivation(options.version);}catch{this.clearLanguagePackActivation();}
    return result;
  }
  clearLanguagePackActivation() {
    this.ynxLanguageActivation?.dispose?.();
    this.ynxLanguageActivation=undefined;
  }
  offerLanguagePackActivation(version) {
    // Plugin metadata can arrive after the deployment RPC. Observe the normal
    // host event; a timeout or registry package name is not proof of a language
    // contribution. At most one pending subscription belongs to this entry.
    this.clearLanguagePackActivation();
    const pending={version,dispose:undefined};this.ynxLanguageActivation=pending;
    const check=()=>{
      if(this.ynxLanguageActivation!==pending)return;
      const plugin=this.plugin;
      if(!plugin||plugin.metadata?.model?.version!==version)return;
      this.clearLanguagePackActivation();
      if(!Array.isArray(plugin.contributes?.localizations)||!plugin.contributes.localizations.some(item=>typeof item.languageId==='string'&&item.languageId))return;
      const action=localize('configureDisplayLanguage','Configure Display Language');
      try {Promise.resolve(this.ynxMessages.info(localize('languagePackInstalled','Language pack installed. Choose a display language to apply its available translations. The IDE will ask before reloading.'),action)).then(choice=>{
        if(choice===action&&this.installed&&this.installedVersion===version)return this.ynxCommands.executeCommand('workbench.action.configureLanguage');
      }).catch(()=>{});}catch{}
    };
    const subscription=this.pluginSupport?.onDidChangePlugins?.(check);
    pending.dispose=()=>subscription?.dispose();
    if(this.ynxLanguageActivation!==pending)pending.dispose();
    check();
  }
  async uninstall() {this.clearLanguagePackActivation();return super.uninstall();}
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
    if (!this.id || !this.installedVersion) return;
    await super.enable();
    this.needsHostReload = true;
    await this.model.doChange(async () => {});
  }
  async disable() {
    this.clearLanguagePackActivation();
    const result = await super.disable();
    this.needsHostReload = false;
    return result;
  }
}
injectable()(YnxVSXExtension);
inject(MessageService)(YnxVSXExtension.prototype, 'ynxMessages');
inject(CommandRegistry)(YnxVSXExtension.prototype, 'ynxCommands');
module.exports = { YnxVSXExtension, extensionDisplayName };
