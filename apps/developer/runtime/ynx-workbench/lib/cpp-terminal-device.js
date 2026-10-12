'use strict';
const { realpath } = require('node:fs/promises');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
// Read only the genuine PTY of this backend's dedicated C++ holder. The
// correlation marker supplies no authority beyond the existing project sandbox.
function createCppTerminalDevice(processManager, TerminalProcess, env = process.env) {
  return async (id, request, workspace) => {
    if (process.platform !== 'darwin' || env.YNX_WORKSPACE_MODE !== 'local' || !UUID.test(request || '') || !Number.isSafeInteger(id) || id < 0 || workspace !== env.YNX_LOCAL_WORKSPACE)
      throw Error('C/C++ terminal scope is invalid');
    const terminal = processManager.get(id), options = terminal?.options;
    if (!(terminal instanceof TerminalProcess) || options.isPseudo || options.command !== '/usr/bin/tail' || JSON.stringify(options.args) !== '["-f","/dev/null"]' ||
        options.options?.env?.YNX_CPP_DEBUG_TERMINAL !== request || options.options.cwd !== workspace || await realpath(workspace) !== workspace)
      throw Error('C/C++ terminal is not owned by this request');
    if (processManager.get(id) !== terminal || !Number.isSafeInteger(terminal.pid) || terminal.pid <= 1 || !/^\/dev\/ttys[0-9]+$/.test(terminal.terminal?.ptsName || ''))
      throw Error('C/C++ terminal has ended');
    return { device: terminal.terminal.ptsName };
  };
}
module.exports = { createCppTerminalDevice, UUID };
