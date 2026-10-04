'use strict';
const SHELL_ARGS_PREFERENCE = 'terminal.integrated.shellArgs.osx';
const QUIET_BASH_ARGS = Object.freeze(['--noprofile', '--norc']);

function ownRegistration(schema, args, nativeRegistration) {
  const overrides = schema.defaultOverrides.get(SHELL_ARGS_PREFERENCE);
  const matches = [...overrides].flatMap(([scope, values]) => values.filter(entry => entry[1] === args).map(entry => ({ scope, values, entry })));
  if (matches.length !== 1) throw Error('The retained terminal default registration cannot be identified.');
  const { scope, entry } = matches[0], id = entry[0];
  let disposed = false;
  return { dispose() {
    if (disposed) return; disposed = true;
    const current = schema.defaultOverrides.get(SHELL_ARGS_PREFERENCE), values = current?.get(scope);
    const index = values?.indexOf(entry) ?? -1;
    if (index < 0) return;
    if (entry[0] !== id || entry[1] !== args) throw Error('The owned terminal default registration changed.');
    const oldValue = schema.getDefaultValue(SHELL_ARGS_PREFERENCE, undefined);
    // Theia 1.76 removeOverride tests `if (index)`, missing index zero; its
    // registerOverride also reuses ids. Never dispose a different same-id entry.
    // A retained native disposable is deliberately held without invoking that
    // buggy remover; this exact captured tuple is the only removable record.
    void nativeRegistration;
    values.splice(index, 1);
    if (!values.length) current.delete(scope);
    if (!current.size) schema.defaultOverrides.delete(SHELL_ARGS_PREFERENCE);
    const newValue = schema.getDefaultValue(SHELL_ARGS_PREFERENCE, undefined);
    const equal = oldValue === newValue || Array.isArray(oldValue) && Array.isArray(newValue)
      && oldValue.length === newValue.length && oldValue.every((value, i) => value === newValue[i]);
    if (!equal) schema.defaultValueChangedEmitter.fire(schema.changeFor(SHELL_ARGS_PREFERENCE, undefined, current, oldValue, newValue));
  } };
}

class LocalTerminalDefaults {
  constructor(contextApi, preferenceSchemaService) {
    this.contextApi = contextApi; this.schema = preferenceSchemaService;
    this.stopped = false;
  }
  initialize() {
    if (this.initialization) return this.initialization;
    this.initialization = (async () => {
      let context;
      try { context = await this.contextApi.getContext(); } catch { return; }
      if (this.stopped || context?.mode !== 'local') return;
      await this.schema.ready;
      if (this.stopped) return;
      if (!(this.schema.defaultOverrides instanceof Map) || typeof this.schema.getDefaultValue !== 'function'
        || typeof this.schema.changeFor !== 'function' || typeof this.schema.defaultValueChangedEmitter?.fire !== 'function') throw Error('Review the retained terminal default cleanup contract.');
      // Default scope only. User/workspace/folder/session settings remain
      // authoritative, and no settings file or shell initialization is read.
      const args = Object.freeze([...QUIET_BASH_ARGS]);
      const nativeRegistration = this.schema.registerOverride(SHELL_ARGS_PREFERENCE, undefined, args);
      const registration = ownRegistration(this.schema, args, nativeRegistration);
      // Real registerOverride emits synchronously; a shutdown listener may run
      // before it returns the disposable. Do not leak that late registration.
      if (this.stopped) registration.dispose();
      else this.registration = registration;
    })();
    return this.initialization;
  }
  onStop() {
    this.stopped = true;
    const registration = this.registration; this.registration = undefined;
    registration?.dispose();
  }
}
module.exports = { LocalTerminalDefaults, SHELL_ARGS_PREFERENCE, QUIET_BASH_ARGS };
