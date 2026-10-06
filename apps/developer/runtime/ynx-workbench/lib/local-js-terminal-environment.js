'use strict';
const { URI } = require('@theia/core');
const { getRootPath } = require('@theia/terminal/lib/node/shell-process');
const installed = new WeakSet();
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
// This marker selects environment semantics, not authority. Launch admission
// remains the existing authenticated local supervisor and sandbox boundary.
function install(prototype) {
  if (installed.has(prototype)) return;
  installed.add(prototype);
  const create = prototype.create;
  prototype.create = function (options) {
    const env = options?.env;
    if (process.env.YNX_WORKSPACE_MODE !== 'local' || env?.YNX_WORKSPACE_MODE !== 'local' ||
        !UUID.test(env.YNX_JS_DEBUG_LAUNCH || '') || !UUID.test(env.YNX_LOCAL_PROJECT_ID || '') ||
        !/^[a-f0-9]{64}$/.test(env.YNX_JS_DEBUG_CREDENTIAL || '') || options.strictEnv === true)
      return create.call(this, options);
    const prepared = { ...options };
    this.validateTerminalOptions(prepared);
    const merged = this.environmentUtils.mergeProcessEnv(env);
    this.applyToProcessEnvironment(URI.fromFilePath(getRootPath(prepared.rootURI)), merged);
    // DAP's explicit values apply after inherited/extension environment, just
    // as the old shell command's env assignments did, without printing them.
    for (const [key, value] of Object.entries(env)) {
      if (value === null) delete merged[key];
      else if (typeof value === 'string') merged[key] = value;
    }
    return create.call(this, { ...prepared, env: merged, strictEnv: true });
  };
}
module.exports = { install };
