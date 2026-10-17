// A native WKWebView is still a browser to Theia. Adapt only these default
// bindings; pretending to be Electron would change unrelated runtime behavior.
function wrap(Contribution, target, transform) {
  const prototype = Contribution.prototype;
  if (Object.hasOwn(prototype, '__ynxNativeFileKeybindings')) return;
  const original = prototype.registerKeybindings;
  Object.defineProperty(prototype, '__ynxNativeFileKeybindings', {value:true});
  prototype.registerKeybindings = function (registry) {
    if (!target.ynxDesktopFiles) return original.call(this, registry);
    const contribution = this;
    const defaults = new Proxy(registry, {
      get(object, property) {
        if (property === 'registerKeybinding') {
          return (binding, ...args) => object.registerKeybinding(transform(binding, contribution), ...args);
        }
        const value = Reflect.get(object, property, object);
        return typeof value === 'function' ? value.bind(object) : value;
      },
    });
    return original.call(this, defaults);
  };
}
function install({WorkspaceContribution, SymbolContribution, commands, target}) {
  wrap(WorkspaceContribution, target, binding => {
    if ([commands.OPEN.id, commands.OPEN_FILE.id].includes(binding.command)
      && ['ctrlcmd+alt+o', 'ctrlcmd+o'].includes(binding.keybinding)) {
      return {...binding, command:commands.OPEN_FILE.id, keybinding:'ctrlcmd+o'};
    }
    return binding;
  });
  wrap(SymbolContribution, target, (binding, contribution) => {
    if (binding.command === contribution.command.id && binding.keybinding === 'ctrlcmd+o') {
      return {...binding, keybinding:'ctrlcmd+t'};
    }
    return binding;
  });
}
module.exports = {install};
