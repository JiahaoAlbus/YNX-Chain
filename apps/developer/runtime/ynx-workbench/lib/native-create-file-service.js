'use strict';
// Keep the original FileService will/did/failure envelope; replace only the
// protected commit step for this one owned Explorer request.
function bindNativeCreateFileService(rebind, FileService, { decorate, injectable }) {
  const active = new WeakMap();
  class NativeCreateFileService extends FileService {
    async createExplorerResource(uri, transaction) {
      if (!transaction.current()) throw Error('Creation request is stale');
      const options = { overwrite: false };
      active.set(options, { service: this, uri, transaction });
      try { return await this.create(uri, undefined, options); }
      finally { active.delete(options); }
    }

    async doCreate(uri, value, options) {
      const pending = options && active.get(options);
      if (!pending) return super.doCreate(uri, value, options);
      active.delete(options);
      if (pending.service !== this || !pending.uri.isEqual(uri) || !pending.transaction.current()) {
        throw Error('Creation request is stale');
      }
      // Parent-owned native commit validates the one-use token, exact URI
      // and workspace/window generation again, and returns actual file stats.
      // FileService emits success/failure only after this promise settles.
      return pending.transaction.commit(uri);
    }
  }
  decorate(injectable(), NativeCreateFileService);
  rebind(FileService).to(NativeCreateFileService).inSingletonScope();
}

module.exports = { bindNativeCreateFileService };
