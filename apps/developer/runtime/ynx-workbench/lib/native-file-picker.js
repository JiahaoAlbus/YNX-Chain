// Override only the workbench's open commands. Extension dialogs retain their
// existing scope, and an OS selection never widens the current backend root.
function workspaceMatchesRoot(data, fileUri, rootUri) {
  if (!data || !Array.isArray(data.folders) || data.folders.length !== 1) return false;
  const folder = data.folders[0];
  if (!folder || typeof folder.path !== 'string' || Object.hasOwn(folder, 'uri')) return false;
  const root = new URL(rootUri);
  const selected = new URL(fileUri);
  if (root.protocol !== 'file:' || selected.protocol !== 'file:' || root.host || selected.host) return false;
  const rootPath = decodeURIComponent(root.pathname).replace(/\/$/, '');
  const parent = decodeURIComponent(selected.pathname).replace(/\/[^/]*$/, '');
  // Do not normalize arbitrary ../ or symlink-containing paths into authority.
  return folder.path === rootPath || (folder.path === '.' && parent === rootPath);
}
function install({ Contribution, URI, open, parse, target, localize, fileOpenMenu, commands }) {
  const prototype = Contribution.prototype;
  if (prototype.__ynxNativeFilePicker) return;
  Object.defineProperty(prototype, '__ynxNativeFilePicker', { value: true });
  const registerMenus = prototype.registerMenus;
  prototype.registerMenus = function (menus) {
    registerMenus.call(this, menus);
    if (target.ynxDesktopFiles) {
      menus.registerMenuAction(fileOpenMenu, { commandId: commands.OPEN_FILE.id, label: localize('openFile', 'Open File…'), order: 'a01' });
      menus.registerMenuAction(fileOpenMenu, { commandId: commands.OPEN_FOLDER.id, label: localize('openFolder', 'Open Folder…'), order: 'a02' });
    }
  };
  for (const [method, kind] of Object.entries({ doOpen: 'any', doOpenFile: 'file', doOpenFolder: 'folder', doOpenWorkspace: 'workspace' })) {
    const original = prototype[method];
    prototype[method] = async function (...args) {
      const bridge = target.ynxDesktopFiles;
      if (!bridge) return original.apply(this, args);
      try {
        const result = await bridge.open({ kind });
        if (result.cancelled || result.openedInNewWindow || !result.uris?.length) return undefined;
        const uri = new URI(result.uris[0]);
        if (kind === 'workspace') {
          const info = await this.fileService.resolve(uri);
          if (!info.isFile || info.size > 2 * 1024 * 1024) throw new Error(localize('nativeWorkspaceTooLarge', 'Choose a workspace file smaller than 2 MiB.'));
          const content = await this.fileService.readFile(uri);
          if (content.value.byteLength > 2 * 1024 * 1024) throw new Error(localize('nativeWorkspaceTooLarge', 'Choose a workspace file smaller than 2 MiB.'));
          const errors = [], data = parse(content.value.toString(), errors, { allowTrailingComma: true });
          if (errors.length || !workspaceMatchesRoot(data, result.uris[0], result.rootUri)) {
            throw new Error(localize('nativeWorkspaceScope', 'This workspace must contain only the current project root. Open other folders in separate windows; multi-root isolation is not yet supported.'));
          }
          await this.workspaceService.open(uri, { preserveWindow: true });
          return uri;
        }
        const stat = await this.fileService.resolve(uri);
        if (!stat.isFile) throw new Error(localize('nativeSelectedFileMissing', 'The selected file is no longer available.'));
        await open(this.openerService, uri);
        return [uri];
      } catch (error) {
        await this.messageService.error(error.message || localize('nativeOpenFailed', 'The selected file could not be opened.'));
        return undefined;
      }
    };
  }
}
class NativeInitialFile {
  constructor(editors, workspace, messages, target, URI, localize = (_, text) => text) { Object.assign(this, { editors, workspace, messages, target, URI, localize }); }
  async onDidInitializeLayout() {
    const uri = this.target.ynxDesktopFiles?.takeInitialFile();
    if (!uri) return;
    await this.workspace.ready;
    try { await this.editors.open(new this.URI(uri), { mode: 'activate' }); }
    catch { await this.messages.error(this.localize('nativeInitialOpenFailed', 'The selected file could not be opened. Your project was preserved.')); }
  }
}
module.exports = { install, workspaceMatchesRoot, NativeInitialFile };
