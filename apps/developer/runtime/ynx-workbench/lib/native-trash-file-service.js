const { injectable, inject } = require('@theia/core/shared/inversify');
const URI = require('@theia/core/lib/common/uri').default;
const { RemoteFileSystemProvider } = require('@theia/filesystem/lib/common/remote-file-system-provider');
const { Saveable } = require('@theia/core/lib/browser/saveable');
const { NavigatableWidget } = require('@theia/core/lib/browser/navigatable-types');
const { WorkspaceDeleteHandler } = require('@theia/workspace/lib/browser/workspace-delete-handler');

const fail = message => Object.assign(new Error(message), { nativeTrash: true });
const exactPath = path => typeof path === 'string' && path.startsWith('/') && path !== '/' && path.length <= 4096
  && !/[\u0000-\u001f\u007f]/.test(path) && path.slice(1).split('/').every(part => part && part !== '.' && part !== '..');

class NativeTrashContext {
  constructor(api, target = globalThis.window) { this.api = api; this.target = target; this.origin = target?.location?.origin; }
  nativeWindow() {
    const location = this.target?.location;
    return !!this.target?.webkit?.messageHandlers?.ynxLocalWorkbench
      && location?.protocol === 'http:' && location.hostname === '127.0.0.1'
      && /^[1-9]\d{0,4}$/.test(location.port) && Number(location.port) <= 65535
      && location.pathname === '/' && location.origin === this.origin;
  }
  async local() {
    if (!this.nativeWindow()) { if (this.binding) throw fail('The native document changed. The item was retained.'); return false; }
    // The server's actual binding, never a URL fragment/title/Explorer root.
    const current = await this.api.getContext();
    if (!this.nativeWindow()) throw fail('The native project document changed. The item was retained.');
    if (current?.mode !== 'local') {
      if (this.binding) throw fail('The local project binding changed. The item was retained.');
      return false;
    }
    if (!exactPath(current.workspace)) throw fail('The native project binding is unavailable. The item was retained.');
    const binding = { mode: current.mode, workspace: current.workspace, projectId: current.projectId, profile: current.profile };
    // Current getContext exposes mode/workspace. Preserve identity/profile too
    // when provided by later compatible servers; never fabricate these fields.
    if (!this.binding) this.binding = Object.freeze(binding);
    else if (Object.keys(binding).some(key => binding[key] !== this.binding[key])) throw fail('The local project binding changed. The item was retained.');
    return true;
  }
  async relative(resource) {
    if (!await this.local()) throw fail('This operation has no local native project binding.');
    if (!(resource instanceof URI) || resource.scheme !== 'file' || resource.authority || resource.query || resource.fragment) throw fail('Native Trash accepts only files in the current project.');
    const path = resource.path.toString(), root = this.binding.workspace;
    if (!exactPath(path) || !path.startsWith(root + '/')) throw fail('The item is outside the current project or is the project root. It was retained.');
    return path.slice(root.length + 1);
  }
  async trash(resource) {
    const relative = await this.relative(resource);
    const bridge = this.target?.ynxDesktopTrash;
    if (!this.nativeWindow() || typeof bridge?.trash !== 'function') throw fail('The native Trash bridge is unavailable. The item was retained.');
    // The Cocoa broker independently proves vnode/project identity and asks the
    // OS user. Neither this string nor a third-party extension is authority.
    await bridge.trash(relative);
  }
}

class NativeTrashRemoteFileSystemProvider extends RemoteFileSystemProvider {
  async delete(resource, options) {
    if (options?.useTrash && await this.nativeTrashContext.local()) return this.nativeTrashContext.trash(resource);
    return super.delete(resource, options);
  }
}
injectable()(NativeTrashRemoteFileSystemProvider);
inject(NativeTrashContext)(NativeTrashRemoteFileSystemProvider.prototype, 'nativeTrashContext');

class NativeTrashWorkspaceDeleteHandler extends WorkspaceDeleteHandler {
  async confirm(uris, options) {
    if (!options.useTrash || !await this.nativeTrashContext.local()) return super.confirm(uris, options);
    for (const uri of uris) await this.nativeTrashContext.relative(uri);
    // Keep the actual unsaved-editor warning. Clean items use only the native
    // confirmation; no global dialog suppression and no fabricated approval.
    const dirty = this.getDirty(uris).length;
    const accepted = dirty ? await super.confirm(uris, options) : true;
    if (this.approvalFence) this.approvalFence.dirtyApproved = !!dirty && !!accepted;
    return accepted;
  }
  async moveFileToTrash(uri, options) {
    if (!await this.nativeTrashContext.local()) return super.moveFileToTrash(uri, options);
    // Upstream offers permanent-delete on any Trash failure. Native paths must
    // retain cancellation/recovery errors and never enter that fallback.
    return this.fileService.delete(uri, { ...options, useTrash: true });
  }
  async delete(uri, options) {
    if (!options.useTrash || !await this.nativeTrashContext.local()) return super.delete(uri, options);
    await this.moveFileToTrash(uri, options);
    // Cancel/failure must never close or discard an unsaved editor.
    await this.closeNativeEditors(uri);
  }
  trackEditors(uris) {
    const entries = new Map(), subscriptions = [];
    for (const [, widget] of NavigatableWidget.getAffected(this.shell.widgets, uris)) {
      const saveable = Saveable.get(widget), entry = { saveable, dirty: !!saveable?.dirty, changed: false, observed: typeof saveable?.onContentChanged === 'function' };
      entries.set(widget, entry);
      if (entry.observed) subscriptions.push(saveable.onContentChanged(() => { entry.changed = true; }));
      if (typeof saveable?.onDirtyChanged === 'function') subscriptions.push(saveable.onDirtyChanged(() => { entry.changed = true; }));
    }
    return { entries, dirtyApproved: false, dispose: () => subscriptions.forEach(subscription => subscription.dispose()) };
  }
  async closeNativeEditors(uri) {
    for (const [, widget] of NavigatableWidget.getAffected(this.shell.widgets, uri)) {
      const saveable = Saveable.get(widget), prior = this.approvalFence?.entries.get(widget);
      const approvedDirty = this.approvalFence?.dirtyApproved && prior?.saveable === saveable && prior.dirty && prior.observed && !prior.changed;
      if (saveable?.dirty && !approvedDirty) {
        await this.nativeTrashMessages.warn('The file was moved to Trash. Its editor remains open because it has new or unapproved unsaved changes.');
        continue;
      }
      try { await this.shell.closeMany([widget], { save: false }); }
      catch (error) { await this.nativeTrashMessages.warn('The file was moved to Trash, but its editor could not be closed. Its content remains available.'); this.logger.error(error); }
    }
  }
  async execute(uris) {
    try { return await this.executeNativeOrOrdinary(uris); }
    catch (error) { if (!error.cancelled) { await this.nativeTrashMessages.error(error.recoveryPath ? `${error.message}\nRecovery location: ${error.recoveryPath}` : error.message); this.logger.error(error); } }
  }
  async executeNativeOrOrdinary(uris) {
    if (!await this.nativeTrashContext.local() || !this.fsPreferences['files.enableTrash']) return super.execute(uris);
    const selected = URI.getDistinctParents(uris);
    if (!selected.length) return;
    // Retain upstream provider capability. No arbitrary Trash declaration.
    if (!this.fileService.hasCapability(selected[0], 4096)) { await this.nativeTrashMessages.error('The current provider does not support Trash. The selected items were retained.'); return; }
    const options = { recursive: true, useTrash: true };
    if (this.approvalFence) throw fail('Another native Trash selection is pending.');
    this.approvalFence = this.trackEditors(selected);
    let completed = 0;
    try {
      if (!await this.confirm(selected, options)) return;
      // Cocoa permits one pending sheet. Real multiselection is sequential, not
      // transactional: only successfully trashed items close their editors.
      for (const uri of selected) { await this.delete(uri, options); completed++; }
    } catch (error) {
      if (completed) await this.nativeTrashMessages.warn(`Moved ${completed} of ${selected.length} items to Trash. The remaining operations did not complete. ${error.message}${error.recoveryPath ? `\nRecovery location: ${error.recoveryPath}` : ''}`);
      else if (!error.cancelled) await this.nativeTrashMessages.error(error.recoveryPath ? `${error.message}\nRecovery location: ${error.recoveryPath}` : error.message);
      if (!error.cancelled) this.logger.error(error);
    } finally { this.approvalFence.dispose(); this.approvalFence = undefined; }
  }
}
injectable()(NativeTrashWorkspaceDeleteHandler);
inject(NativeTrashContext)(NativeTrashWorkspaceDeleteHandler.prototype, 'nativeTrashContext');
const { MessageService } = require('@theia/core/lib/common/message-service');
inject(MessageService)(NativeTrashWorkspaceDeleteHandler.prototype, 'nativeTrashMessages');

// Called by the owned frontend ContainerModule, after upstream modules. Existing
// RemoteFileServiceContribution continues to register the derived singleton;
// inherited server injection/init, FileService checks/events and watchers stay.
function bindNativeTrash(bind, rebind, contextApiToken, target = globalThis.window) {
  bind(NativeTrashContext).toDynamicValue(({ container }) => new NativeTrashContext(container.get(contextApiToken), target)).inSingletonScope();
  rebind(RemoteFileSystemProvider).to(NativeTrashRemoteFileSystemProvider).inSingletonScope();
  rebind(WorkspaceDeleteHandler).to(NativeTrashWorkspaceDeleteHandler).inSingletonScope();
}
module.exports = { NativeTrashContext, NativeTrashRemoteFileSystemProvider, NativeTrashWorkspaceDeleteHandler, bindNativeTrash };
