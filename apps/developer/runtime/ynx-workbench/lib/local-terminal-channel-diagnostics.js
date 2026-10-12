'use strict';
const installed = new WeakSet();
function installOn(prototype, TerminalProcess) {
  if (installed.has(prototype)) return;
  installed.add(prototype);
  const configure = prototype.configure;
  prototype.configure = function (service) {
    const owner = this;
    const wrapped = new Proxy(service, { get(target, key) {
      if (key !== 'registerChannelHandler') { const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; }
      return (path, handler) => {
        if (path !== '/services/terminals/:id') return target.registerChannelHandler(path, handler);
        owner.logger.info('YNX_TERMINAL_CHANNEL id=-1 phase=registered');
        return target.registerChannelHandler(path, (params, channel) => {
          const id = Number(params.id), process = owner.processManager.get(id);
          const safeId = Number.isSafeInteger(id) ? id : -1;
          owner.logger.info(`YNX_TERMINAL_CHANNEL id=${Number.isSafeInteger(id) ? id : -1} phase=open present=${!!process} matches=${process instanceof TerminalProcess}`);
          let input = false, output = false;
          const observed = new Proxy(channel, { get(object, property) {
            if (property === 'onMessage') return listener => object.onMessage(event => {
              if (!input) { input = true; owner.logger.info(`YNX_TERMINAL_CHANNEL id=${safeId} phase=input`); }
              listener(event);
            });
            if (property === 'getWriteBuffer') return (...args) => {
              if (!output) { output = true; owner.logger.info(`YNX_TERMINAL_CHANNEL id=${safeId} phase=buffer-request`); }
              return object.getWriteBuffer(...args);
            };
            const value = Reflect.get(object, property, object); return typeof value === 'function' ? value.bind(object) : value;
          }});
          return handler(params, observed);
        });
      };
    }});
    return configure.call(this, wrapped);
  };
}
function install() { installOn(require('@theia/terminal/lib/node/terminal-backend-contribution').TerminalBackendContribution.prototype, require('@theia/process/lib/node').TerminalProcess); }
module.exports = { install, installOn };
