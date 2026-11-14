const { explorerCreateTransaction } = require('./explorer-create-transaction');
const workspaceSave = Symbol('workspaceSave');

function trackWorkspace(workspace) {
  const roots = [...workspace.tryGetRoots()];
  let retired = false;
  const retire = () => { retired = true; };
  const subscriptions = [workspace.onWorkspaceChanged?.(retire), workspace.onWorkspaceLocationChanged?.(retire)];
  return {
    current() {
      const live = workspace.tryGetRoots();
      return !retired && roots.length === live.length && roots.every((root, index) => root === live[index]);
    },
    dispose() { for (const subscription of subscriptions) subscription?.dispose(); },
  };
}
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
// Adapt only the framework's DEFAULT contributions. WKWebView is a browser
// target to Theia, whose CmdO workspace-symbol binding otherwise consumes the
// native menu shortcut. User/workspace remaps still resolve above these defaults.
function installNativeOpenKeybindings({ Contribution, SymbolContribution, target, commands }) {
  for (const [Type, transform] of [
    [Contribution, binding => binding.command === commands.OPEN.id && binding.keybinding === 'ctrlcmd+alt+o'
      ? { ...binding, command: commands.OPEN_FILE.id, keybinding: 'ctrlcmd+o' } : binding],
    [SymbolContribution, binding => binding.command === 'languages.workspace.symbol' && binding.keybinding === 'ctrlcmd+o'
      ? { ...binding, keybinding: 'ctrlcmd+t' } : binding],
  ]) {
    if (!Type || Object.hasOwn(Type.prototype, '__ynxNativeOpenKeybindings')) continue;
    const original = Type.prototype.registerKeybindings;
    if (typeof original !== 'function') continue;
    Object.defineProperty(Type.prototype, '__ynxNativeOpenKeybindings', { value: true });
    Type.prototype.registerKeybindings = function (registry) {
      if (!target.ynxDesktopFiles) return original.call(this, registry);
      const defaults = Object.create(registry);
      defaults.registerKeybinding = binding => registry.registerKeybinding(transform(binding));
      return original.call(this, defaults);
    };
  }
}
function install({ Contribution, WorkspaceContribution, SymbolContribution, URI, UriAwareCommandHandler, open, parse, target, localize, fileOpenMenu, commands, fileStatFromNative }) {
  installNativeOpenKeybindings({ Contribution, SymbolContribution, target, commands });
  installNativeExplorerCreation({ WorkspaceContribution, URI, UriAwareCommandHandler, open, target, localize, commands, fileStatFromNative });
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
  const saveWorkspaceAs = prototype.saveWorkspaceAs;
  if (saveWorkspaceAs) prototype.saveWorkspaceAs = async function (...args) {
    if (!target.ynxDesktopFiles) return saveWorkspaceAs.apply(this, args);
    const workspace = this.workspaceService;
    const scope = trackWorkspace(workspace);
    let saved = false;
    // Scope the original method's dependencies to this invocation. Its normal
    // extension selection and overwrite confirmation still run unchanged.
    const invocation = Object.create(this, {
      fileDialogService: { value: { showSaveDialog: (props, folder) => scope.current()
        ? this.fileDialogService.showSaveDialog(props, folder, workspaceSave) : undefined } },
      workspaceService: { value: { save: async uri => {
        if (!scope.current()) return;
        await workspace.save(uri);
        saved = true;
      } } },
    });
    try {
      await saveWorkspaceAs.apply(invocation, args);
      return saved;
    } finally {
      scope.dispose();
    }
  };
  for (const [method, kind] of Object.entries({ doOpen: 'any', doOpenFile: 'file', doOpenFolder: 'folder', doOpenWorkspace: 'workspace' })) {
    const original = prototype[method];
    prototype[method] = async function (...args) {
      const bridge = target.ynxDesktopFiles;
      if (!bridge) return original.apply(this, args);
      const { current, dispose } = trackWorkspace(this.workspaceService);
      try {
        const result = await bridge.open({ kind });
        if (!current() || result.cancelled || result.openedInNewWindow || !result.uris?.length) return undefined;
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
        if (current()) {
          try { void Promise.resolve(this.messageService.error(error.message || localize('nativeOpenFailed', 'The selected file could not be opened.'))).catch(() => {}); }
          catch { /* The failed Open has already finished. */ }
        }
        return undefined;
      } finally {
        dispose();
      }
    };
  }
}
function localExplorerFileUri(uri) {
  if (uri?.scheme !== 'file' || uri.authority || uri.query || uri.fragment) return undefined;
  const path = uri.path.toString();
  if (!path.startsWith('/') || path.split('/').some(part => part === '.' || part === '..')) return undefined;
  // Foundation's directory file URLs include a terminal slash; Theia may
  // represent the same Explorer directory without one.
  return uri.withPath(path.replace(/\/+$/, '') || '/');
}
// The bridge performs the exclusive filesystem create. A successful Explorer
// reply only reveals or opens the resource; the renderer must not write it again.
function installNativeExplorerCreation({ WorkspaceContribution, URI, UriAwareCommandHandler, open, target, localize, commands, fileStatFromNative }) {
  const prototype = WorkspaceContribution?.prototype;
  if (!prototype || Object.hasOwn(prototype, '__ynxNativeExplorerCreation')) return;
  const register = prototype.registerCommands, active = new WeakSet();
  Object.defineProperty(prototype, '__ynxNativeExplorerCreation', { value: true });
  prototype.registerCommands = function (registry) {
    const contribution = this, adapted = Object.create(registry);
    adapted.registerCommand = (command, handler, ...rest) => {
      const folder = command.id === commands.NEW_FOLDER?.id;
      if (!folder && command.id !== commands.NEW_FILE?.id) return registry.registerCommand(command, handler, ...rest);
      // Keep the framework's selection extraction before its workspace handler
      // can replace an out-of-workspace URI with the current root.
      const selectionHandler = UriAwareCommandHandler.MonoSelect(contribution.selectionService, {});
      const create = async selected => {
        if (active.has(contribution)) return undefined;
        active.add(contribution);
        const subscriptions = [];
        try {
          const workspace = contribution.workspaceService, root = workspace.tryGetRoots()[0];
          const workspaceRoot = localExplorerFileUri(root?.resource);
          if (!workspaceRoot) return undefined;
          let invalidated = false;
          for (const event of ['onWorkspaceChanged', 'onWorkspaceLocationChanged']) {
            if (typeof workspace[event] === 'function') subscriptions.push(workspace[event](() => { invalidated = true; }));
          }
          const current = () => !invalidated && workspace.tryGetRoots()[0] === root;
          const selection = localExplorerFileUri(selected ?? root.resource);
          if (!selection || !workspaceRoot.isEqualOrParent(selection)) return undefined;
          // The upstream helper falls back to the parent even after a failed
          // resolve. Only a confirmed existing file may select its parent here.
          let parent;
          try {
            const item = await contribution.fileService.resolve(selection);
            if (!current()) return undefined;
            if (item?.isDirectory) parent = item;
            else if (item?.isFile) parent = await contribution.fileService.resolve(selection.parent);
          } catch (error) {
            if (!current()) return undefined;
            throw error;
          }
          const directory = localExplorerFileUri(parent?.resource);
          if (!current() || !parent?.isDirectory || !directory || !workspaceRoot.isEqualOrParent(directory)) return undefined;
          const defaults = folder ? { fileName: 'Untitled', fileExtension: '' } : contribution.getDefaultFileConfig();
          const uri = await explorerCreateTransaction(target.ynxDesktopFiles, contribution.fileService, {
            kind: folder ? 'create-folder' : 'create', name: defaults.fileName + defaults.fileExtension,
            directoryUri: directory.toString(),
          }, {
            current,
            toFileStat: fileStatFromNative,
            decode(result, phase) {
              if (result?.[phase] !== true || result.openedInNewWindow || !Array.isArray(result.uris) ||
                  result.uris.length !== 1 || typeof result.uris[0] !== 'string' || typeof result.rootUri !== 'string') {
                throw Error(localize('nativeExplorerCreateResponse', 'The IDE could not confirm creation of the selected item.'));
              }
              const uri = localExplorerFileUri(new URI(result.uris[0]));
              const receiptRoot = localExplorerFileUri(new URI(result.rootUri));
              if (!uri || !receiptRoot?.isEqual(workspaceRoot) || !workspaceRoot.isEqualOrParent(uri) ||
                  uri.isEqual(workspaceRoot) || (folder && !uri.parent.isEqual(directory))) {
                throw Error(localize('nativeExplorerCreateScope', 'Create the item inside the current project.'));
              }
              return uri;
            },
          });
          if (!uri || !current()) return undefined;
          if (folder) contribution.fireCreateNewFolder({ parent: uri.parent, uri });
          else {
            contribution.fireCreateNewFile({ parent: uri.parent, uri });
            if (current()) await open(contribution.openerService, uri);
          }
          return current() ? uri : undefined;
        } catch (error) {
          const fallback = folder
            ? localize('nativeExplorerCreateFolderFailed', 'The new folder could not be created.')
            : localize('nativeNewFileFailed', 'The new file could not be created or opened.');
          // Error reporting cannot keep the picker operation indefinitely busy.
          try { Promise.resolve(contribution.messageService.error(error?.message || fallback)).catch(() => {}); } catch {}
          return undefined;
        } finally {
          for (const subscription of subscriptions) { try { subscription?.dispose(); } catch {} }
          active.delete(contribution);
        }
      };
      const replacement = Object.create(handler);
      replacement.execute = (...args) => target.ynxDesktopFiles ? create(selectionHandler.getUri(...args)) : handler.execute(...args);
      return registry.registerCommand(command, replacement, ...rest);
    };
    return register.call(this, adapted);
  };
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
// Only supply a missing Save As start folder; the standard dialog still owns
// destination selection, cancellation, overwrite confirmation and saving.
function installProjectSaveDefault({ dialogs, editors, workspace, fileService, target, URI }) {
  const original = dialogs.showSaveDialog.bind(dialogs);
  dialogs.showSaveDialog = async (props, folder, purpose) => {
    if (target?.ynxDesktopFiles && URI) {
      const workspaceRequest = purpose === workspaceSave;
      const root = workspace.tryGetRoots()[0], editor = workspaceRequest ? undefined : editors.currentEditor;
      const document = editor?.editor?.document;
      if (!root || (!workspaceRequest && (!editor || editor.isDisposed))) return undefined;
      let retired = false;
      const retire = () => { retired = true; };
      const subscriptions = [];
      const current = () => !retired && workspace.tryGetRoots()[0] === root && (workspaceRequest ||
        (editors.currentEditor === editor && editor.editor?.document === document && !editor.isDisposed));
      try {
        subscriptions.push(workspace.onWorkspaceChanged?.(retire));
        subscriptions.push(workspace.onWorkspaceLocationChanged?.(retire));
        if (!workspaceRequest) subscriptions.push(editors.onCurrentEditorChanged?.(retire));
        const workspaceRoot = localExplorerFileUri(root.resource);
        const source = localExplorerFileUri(editor?.editor?.uri);
        let directory = folder;
        if (!directory && source && workspaceRoot?.isEqualOrParent(source) && !source.isEqual(workspaceRoot)) {
          try { directory = await fileService.resolve(source.parent); } catch { /* Let the native dialog use its project root. */ }
        }
        if (!current()) return undefined;
        const start = directory?.isDirectory && localExplorerFileUri(directory.resource);
        const result = await target.ynxDesktopFiles.open({
          kind: 'save',
          name: typeof props.inputValue === 'string' ? props.inputValue : 'Untitled',
          ...(start && workspaceRoot?.isEqualOrParent(start) ? { directoryUri: start.toString() } : {}),
        });
        if (!current()) return undefined;
        if (result.cancelled || !result.uris?.length) return undefined;
        const uri = new URI(result.uris[0]);
        if (uri.scheme !== 'file' || !root.resource.isEqualOrParent(uri) || uri.isEqual(root.resource)) throw Error('Save the file inside the current project.');
        return uri;
      } catch (error) {
        if (current()) throw error;
      } finally {
        for (const subscription of subscriptions) subscription?.dispose();
      }
      return undefined;
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
module.exports = { install, installNativeOpenKeybindings, workspaceMatchesRoot, NativeInitialFile, installProjectSaveDefault };
