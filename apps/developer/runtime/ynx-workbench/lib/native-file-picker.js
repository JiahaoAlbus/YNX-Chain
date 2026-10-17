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
function install({ Contribution, URI, open, parse, target, localize, fileOpenMenu, commands, getCurrentEditor = () => undefined }) {
  const prototype = Contribution.prototype;
  if (prototype.__ynxNativeFilePicker) return;
  const requests = new WeakMap();
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
      const request = {}, workspace = this.workspaceService.workspace;
      const roots = this.workspaceService.tryGetRoots?.();
      const widget = getCurrentEditor(), document = widget?.editor?.document;
      const version = document?.textEditorModel?.getVersionId();
      requests.set(this, request);
      const current = () => requests.get(this) === request && target.ynxDesktopFiles === bridge &&
        this.workspaceService.workspace === workspace && getCurrentEditor() === widget && !widget?.isDisposed &&
        widget?.editor?.document === document && !document?.isDisposed?.() && document?.textEditorModel?.getVersionId() === version &&
        (!roots || (() => { const now = this.workspaceService.tryGetRoots(); return now.length === roots.length && now.every((root, index) => root === roots[index]); })());
      try {
        const result = await bridge.open({ kind });
        if (!current()) return undefined;
        if (result.cancelled || result.openedInNewWindow || !result.uris?.length) return undefined;
        const uri = new URI(result.uris[0]);
        if (kind === 'workspace') {
          const info = await this.fileService.resolve(uri);
          if (!current()) return undefined;
          if (!info.isFile || info.size > 2 * 1024 * 1024) throw new Error(localize('nativeWorkspaceTooLarge', 'Choose a workspace file smaller than 2 MiB.'));
          const content = await this.fileService.readFile(uri);
          if (!current()) return undefined;
          if (content.value.byteLength > 2 * 1024 * 1024) throw new Error(localize('nativeWorkspaceTooLarge', 'Choose a workspace file smaller than 2 MiB.'));
          const errors = [], data = parse(content.value.toString(), errors, { allowTrailingComma: true });
          if (errors.length || !workspaceMatchesRoot(data, result.uris[0], result.rootUri)) {
            throw new Error(localize('nativeWorkspaceScope', 'This workspace must contain only the current project root. Open other folders in separate windows; multi-root isolation is not yet supported.'));
          }
          await this.workspaceService.open(uri, { preserveWindow: true });
          return uri;
        }
        const stat = await this.fileService.resolve(uri);
        if (!current()) return undefined;
        if (!stat.isFile) throw new Error(localize('nativeSelectedFileMissing', 'The selected file is no longer available.'));
        await open(this.openerService, uri);
        return [uri];
      } catch (error) {
        if (!current()) return undefined;
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
// Native panels select a destination; the existing saveable still owns the
// write and its overwrite checks. Browser mode keeps its normal dialog.
function installProjectSaveDefault({ dialogs, editors, workspace, fileService, target = {}, URI }) {
  const original = dialogs.showSaveDialog.bind(dialogs);
  let active;
  dialogs.showSaveDialog = async (props, folder) => {
    const bridge = target.ynxDesktopFiles;
    if (typeof bridge?.save === 'function') {
      // A duplicate Save must not replace the owner of an already visible
      // system panel, nor reuse its destination for another saveable.
      if (active) return undefined;
      const request = {}, roots = workspace.tryGetRoots(), binding = workspace.workspace;
      const editor = editors.currentEditor, document = editor?.editor?.document;
      const version = document?.textEditorModel?.getVersionId();
      active = request;
      const current = () => active === request && target.ynxDesktopFiles === bridge && workspace.workspace === binding &&
        editors.currentEditor === editor && !editor?.isDisposed && editor?.editor?.document === document &&
        !document?.isDisposed?.() && document?.textEditorModel?.getVersionId() === version &&
        (() => { const now = workspace.tryGetRoots(); return now.length === roots.length && now.every((root, index) => root === roots[index]); })();
      try {
        const result = await bridge.save({ name: props?.inputValue || '' });
        if (!current() || result.cancelled || typeof result.uri !== 'string' || typeof result.rootUri !== 'string' || !roots.length) return undefined;
        const selected = new URI(result.uri);
        if (selected.scheme !== 'file' || !roots.some(root => root.resource.toString().replace(/\/$/, '') === result.rootUri.replace(/\/$/, '') && root.resource.isEqualOrParent(selected))) return undefined;
        return selected;
      } catch (error) {
        if (current()) throw error;
        return undefined;
      } finally { if (active === request) active = undefined; }
    }
    if (folder) return original(props, folder);
    const roots = workspace.tryGetRoots();
    const root = roots[0];
    if (!root) return original(props, folder);
    const editor = editors.currentEditor;
    const document = editor?.editor?.document;
    const uri = editor?.editor?.uri;
    let start = root;
    // Debugger/untitled URIs must never be coerced to file: paths. Existing
    // saved files can start in their own directory within the current project.
    if (uri?.scheme === 'file' && roots.some(item => item.resource.isEqualOrParent(uri))) {
      try { start = await fileService.resolve(uri.parent); } catch { start = root; }
    }
    if (workspace.tryGetRoots()[0] !== root || editors.currentEditor !== editor || editor?.editor?.document !== document) return undefined;
    return original(props, start);
  };
}
// Explorer's upstream New File command constructs an HTML input dialog
// directly. Route this desktop entry through the same native destination
// picker as Save As; filesystem creation still belongs to the project backend.
function installNativeNewFile({ Contribution, command, target, open, uniqueResource, getCurrentEditor }) {
  if (!target.ynxDesktopFiles || Contribution.prototype.__ynxNativeNewFile) return;
  const prototype = Contribution.prototype, register = prototype.registerCommands;
  const pending = new WeakSet();
  Object.defineProperty(prototype, '__ynxNativeNewFile', { value: true });
  prototype.registerCommands = function (registry) {
    register.call(this, registry);
    registry.registerHandler(command.id, this.newWorkspaceRootUriAwareCommandHandler({
      execute: async uri => {
        if (pending.has(this)) return;
        const bridge = target.ynxDesktopFiles, binding = this.workspaceService.workspace;
        const roots = this.workspaceService.tryGetRoots(), editor = getCurrentEditor();
        const current = () => target.ynxDesktopFiles === bridge && this.workspaceService.workspace === binding &&
          getCurrentEditor() === editor && !editor?.isDisposed &&
          (() => { const now = this.workspaceService.tryGetRoots(); return now.length === roots.length && now.every((root, i) => root === roots[i]); })();
        pending.add(this);
        try {
          const parent = await this.getDirectory(uri);
          if (!current() || !parent || !roots.some(root => root.resource.isEqualOrParent(parent.resource))) return;
          const { fileName, fileExtension } = this.getDefaultFileConfig();
          const suggested = uniqueResource(parent, parent.resource.resolve(fileName + fileExtension), false);
          const selected = await this.fileDialogService.showSaveDialog({ inputValue: suggested.path.base }, parent);
          if (!current() || !selected || selected.scheme !== 'file' || !roots.some(root => root.resource.isEqualOrParent(selected))) return;
          // create() defaults to overwrite:false: native replacement consent
          // must never turn New File into truncating an existing project file.
          await this.fileService.create(selected, undefined, { overwrite: false });
          this.fireCreateNewFile({ parent: selected.parent, uri: selected });
          if (current()) await open(this.openerService, selected);
          return selected;
        } catch (error) {
          if (current()) await this.messageService.error(error?.message || 'The new file could not be created.');
        } finally { pending.delete(this); }
      },
    }));
  };
}
module.exports = { installNativeNewFile, install, workspaceMatchesRoot, NativeInitialFile, installProjectSaveDefault };
