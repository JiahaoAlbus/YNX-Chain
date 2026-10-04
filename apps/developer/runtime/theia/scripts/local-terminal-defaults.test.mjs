import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { PreferenceSchemaServiceImpl } = require('@theia/core/lib/common/preferences/preference-schema-service');
const { PreferenceServiceImpl } = require('@theia/core/lib/common/preferences/preference-service');
const { DefaultsPreferenceProvider } = require('@theia/core/lib/common/preferences/defaults-preference-provider');
const { PreferenceProviderImpl } = require('@theia/core/lib/common/preferences/preference-provider-impl');
const { PreferenceLanguageOverrideService } = require('@theia/core/lib/common/preferences/preference-language-override-service');
const { PreferenceScope } = require('@theia/core/lib/common/preferences/preference-scope');
const { LocalTerminalDefaults, SHELL_ARGS_PREFERENCE: key, QUIET_BASH_ARGS } = require('../../ynx-workbench/lib/local-terminal-defaults');
// Only storage is in-memory. All default overrides, scoped lookup, array merge,
// provider events and preference inspection use unchanged retained Theia code.
class MemoryProvider extends PreferenceProviderImpl {
  constructor(scope, values = {}) { super(); this.scope = scope; this.values = values; this._ready.resolve(); }
  getPreferences() { return this.values; }
  canHandleScope(scope) { return this.scope === scope; }
  setPreference() { assert.fail('A default contribution must never write user settings.'); }
}
async function fixture(t, userArgs) {
  const schema = new PreferenceSchemaServiceImpl(), scopes = [PreferenceScope.Default, PreferenceScope.User, PreferenceScope.Workspace, PreferenceScope.Folder, PreferenceScope.Session];
  schema.validScopes = scopes; schema.logger = { warn: message => assert.fail(message) };
  schema.preferenceContributions = { getContributions: () => [{ schema: { properties: { [key]: { type: 'array', items: { type: 'string' }, default: ['-l'] } } } }] };
  schema.init(); await schema.ready;
  const overrides = new PreferenceLanguageOverrideService(); overrides.preferenceSchemaService = schema;
  const defaults = new DefaultsPreferenceProvider(); defaults.preferenceSchemaService = schema; defaults.preferenceOverrideService = overrides; defaults.init();
  const providers = new Map([[PreferenceScope.Default, defaults]]);
  for (const scope of scopes.slice(1)) providers.set(scope, new MemoryProvider(scope, scope === PreferenceScope.User && userArgs !== undefined ? { [key]: userArgs } : {}));
  const preferences = new PreferenceServiceImpl(); preferences.schemaService = schema; preferences.preferenceOverrideService = overrides;
  preferences.logger = { warn: message => assert.fail(message) }; preferences.providerProvider = scope => providers.get(scope);
  preferences.init(); await preferences.ready;
  t.after(() => { preferences.dispose(); for (const provider of providers.values()) provider.dispose(); schema.dispose(); });
  return { schema, preferences, providers };
}
test('early local initialize changes only native default args before layout and cleanup restores prior defaults', async t => {
  const f = await fixture(t), contribution = new LocalTerminalDefaults({ getContext: async () => ({ mode: 'local' }) }, f.schema);
  t.after(() => contribution.onStop());
  assert.deepEqual(f.preferences.get(key), ['-l']);
  // Actual FrontendApplication calls/awaits initialize before initializeLayout.
  const lifecycle = readFileSync(require.resolve('@theia/core/lib/browser/frontend-application'), 'utf8');
  assert.ok(lifecycle.indexOf("this.measure('startContributions'") < lifecycle.indexOf("this.measure('initializeLayout'"));
  const initializing = contribution.initialize(); assert.equal(contribution.initialize(), initializing); await initializing;
  assert.deepEqual(f.preferences.get(key), QUIET_BASH_ARGS);
  assert.deepEqual(f.preferences.inspect(key).defaultValue, QUIET_BASH_ARGS);
  assert.equal(f.preferences.inspect(key).globalValue, undefined);
  contribution.onStop(); contribution.onStop(); assert.deepEqual(f.preferences.get(key), ['-l']);
});
test('real preference service keeps explicit user args including empty arrays above local defaults', async t => {
  for (const args of [['-l'], ['--noprofile', '-i'], []]) {
    const f = await fixture(t, args), contribution = new LocalTerminalDefaults({ getContext: async () => ({ mode: 'local' }) }, f.schema);
    t.after(() => contribution.onStop()); await contribution.initialize();
    assert.deepEqual(f.preferences.get(key), args); assert.deepEqual(f.preferences.inspect(key).globalValue, args);
    assert.deepEqual(f.preferences.inspect(key).defaultValue, QUIET_BASH_ARGS);
    contribution.onStop(); assert.deepEqual(f.preferences.get(key), args);
  }
});
test('hosted, invalid and unavailable context never override real terminal defaults', async t => {
  for (const getContext of [async () => ({ mode: 'hosted' }), async () => undefined, async () => { throw Error('context unavailable'); }]) {
    const f = await fixture(t), contribution = new LocalTerminalDefaults({ getContext }, f.schema);
    await contribution.initialize(); assert.deepEqual(f.preferences.get(key), ['-l']);
    assert.equal(contribution.registration, undefined); contribution.onStop();
  }
});
test('stopping pending context or schema readiness cannot install a late default override', async t => {
  const f = await fixture(t); let answer;
  const context = new Promise(resolve => { answer = resolve; });
  const first = new LocalTerminalDefaults({ getContext: () => context }, f.schema), waiting = first.initialize();
  first.onStop(); answer({ mode: 'local' }); await waiting; assert.deepEqual(f.preferences.get(key), ['-l']);
  let ready; const pending = new Promise(resolve => { ready = resolve; });
  const second = new LocalTerminalDefaults({ getContext: async () => ({ mode: 'local' }) }, { ready: pending, registerOverride: (...args) => f.schema.registerOverride(...args) });
  const started = second.initialize(); await Promise.resolve(); second.onStop(); ready(); await started;
  assert.deepEqual(f.preferences.get(key), ['-l']);
});
test('synchronous real default-change shutdown disposes the returned late registration', async t => {
  const f = await fixture(t), contribution = new LocalTerminalDefaults({ getContext: async () => ({ mode: 'local' }) }, f.schema);
  const listener = f.schema.onDidChangeDefaultValue(event => { if (event.newValue?.includes('--norc')) contribution.onStop(); });
  t.after(() => listener.dispose()); await contribution.initialize();
  assert.deepEqual(f.preferences.get(key), ['-l']); assert.equal(contribution.registration, undefined);
});
test('stopping our default contribution preserves an unrelated later native override', async t => {
  const f = await fixture(t), contribution = new LocalTerminalDefaults({ getContext: async () => ({ mode: 'local' }) }, f.schema);
  await contribution.initialize(); const later = f.schema.registerOverride(key, undefined, ['-i']); t.after(() => later.dispose());
  const scopes = f.schema.defaultOverrides.get(key), values = [...scopes.values()][0], unrelated = values[0];
  assert.equal(values[0][0], values[1][0], 'Retained native ids are reused; tuple ownership is required.');
  contribution.onStop(); assert.deepEqual(f.preferences.get(key), ['-i']);
  assert.equal(values.length, 1); assert.equal(values[0], unrelated);
  contribution.onStop(); assert.equal(values.length, 1); assert.equal(values[0], unrelated);
});
test('native default change events report restoration exactly once after removing our index-zero tuple', async t => {
  const f = await fixture(t), events = [], listener = f.schema.onDidChangeDefaultValue(event => events.push(event));
  t.after(() => listener.dispose());
  const contribution = new LocalTerminalDefaults({ getContext: async () => ({ mode: 'local' }) }, f.schema);
  await contribution.initialize(); contribution.onStop(); contribution.onStop();
  assert.equal(events.length, 2); assert.deepEqual(events[0].newValue, QUIET_BASH_ARGS);
  assert.deepEqual(events[1].oldValue, QUIET_BASH_ARGS); assert.deepEqual(events[1].newValue, ['-l']);
  assert.equal(events[1].key, key); assert.equal(events[1].overrideIdentifier, undefined);
});
