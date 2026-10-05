'use strict';
const { ParcelWatcherOptions } = require('@theia/filesystem/lib/node/parcel-watcher/parcel-options');
const { FileSystemWatcherService } = require('@theia/filesystem/lib/common/filesystem-watcher-protocol');
const { createParcelFileSystemWatcherService } = require('@theia/filesystem/lib/node/filesystem-backend-module');

function bindLocalFilesystemWatcher(rebind, environment = process.env, platform = process.platform) {
  if (platform !== 'darwin' || environment.YNX_WORKSPACE_MODE !== 'local') return;
  // FSEvents can subscribe successfully yet emit no changes on mounted Data
  // volumes. Parcel's native kqueue backend observes the selected filesystem
  // directly. Keep Theia's dispatcher, reference counts, excludes and errors;
  // do not translate volume paths or synthesize file changes from UI commands.
  rebind(ParcelWatcherOptions).toConstantValue({ backend: 'kqueue' });
  // The retained 1.76 child entry parses `watchOptions`, but its constructor
  // consumes `parcelOptions`. Use Theia's supported in-process factory so the
  // actual native subscription receives the DI options. Parcel still uses its
  // own native worker; no polling, wider filesystem grants or new IPC channel.
  rebind(FileSystemWatcherService).toDynamicValue(createParcelFileSystemWatcherService).inSingletonScope();
}

module.exports = { bindLocalFilesystemWatcher };
