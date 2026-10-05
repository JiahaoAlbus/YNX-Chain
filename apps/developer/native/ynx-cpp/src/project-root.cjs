const { isAbsolute, resolve } = require('node:path');
function cppProjectRoot(environment) {
  const local = environment.YNX_WORKSPACE_MODE === 'local';
  if (local && (environment.YNX_CORE_WORKSPACE || environment.YNX_CORE_SESSION_ID
    || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(environment.YNX_LOCAL_PROJECT_ID || ''))) return undefined;
  if (!local && environment.YNX_LOCAL_WORKSPACE) return undefined;
  const root = local ? environment.YNX_LOCAL_WORKSPACE : environment.YNX_CORE_WORKSPACE;
  return typeof root === 'string' && isAbsolute(root) && resolve(root) === root ? root : undefined;
}
module.exports = { cppProjectRoot };
