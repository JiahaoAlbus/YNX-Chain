import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import defaults from '../../ynx-workbench/lib/local-python-defaults.js';
const require = createRequire(new URL('../package.json', import.meta.url));
require('reflect-metadata');
const { PreferenceSchemaServiceImpl } = require('@theia/core/lib/common/preferences/preference-schema-service');
const { PreferenceServiceImpl } = require('@theia/core/lib/common/preferences/preference-service');
const { PreferenceScope } = require('@theia/core/lib/common/preferences/preference-scope');
const key = 'python.defaultInterpreterPath', executable = '/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/bin/python3.9';
test('early Default registration survives later Python schema and real preference resolution preserves explicit values', async () => {
  const schema = new PreferenceSchemaServiceImpl(); schema.logger = { warn() {} }; schema.validScopes = [PreferenceScope.Default, PreferenceScope.User, PreferenceScope.Workspace, PreferenceScope.Folder];
  schema.preferenceContributions = { getContributions: () => [] }; schema.init(); await schema.ready;
  const contribution = new defaults.LocalPythonDefaults({ getContext: async () => ({ mode: 'local', pythonDefault: executable }) }, schema);
  await contribution.initialize();
  schema.addSchema({ properties: { [key]: { type: 'string', default: 'python' } } });
  assert.equal(schema.getDefaultValue(key), executable);
  const service = new PreferenceServiceImpl(); service.schemaService = schema;
  service.preferenceProviders.set(PreferenceScope.Default, { canHandleScope: () => true, resolve: name => ({ value: schema.getDefaultValue(name) }) });
  assert.equal(service.resolve(key).value, executable);
  for (const scope of [PreferenceScope.User, PreferenceScope.Workspace, PreferenceScope.Folder]) {
    const explicit = '/project/env-' + scope + '/python';
    service.preferenceProviders.set(scope, { canHandleScope: () => true, resolve: () => ({ value: explicit }) });
    assert.equal(service.resolve(key).value, explicit);
  }
  // This registration lives only in this frontend process; no settings or
  // extension interpreter-selection storage is written by the contribution.
});
test('hosted, unavailable or out-of-bound Python does not change defaults', async () => {
  for (const context of [{ mode: 'hosted', pythonDefault: executable }, { mode: 'local' }, { mode: 'local', pythonDefault: '/usr/bin/python3' }, { mode: 'local', pythonDefault: '/Library/Developer/CommandLineTools/../bad' }]) {
    await new defaults.LocalPythonDefaults({ getContext: async () => context }, { registerOverride: () => assert.fail('unexpected override') }).initialize();
  }
});

test('unavailable context service cannot prevent IDE startup', async () => {
  await new defaults.LocalPythonDefaults({ getContext: async () => { throw new Error('offline'); } }, { registerOverride: () => assert.fail('unexpected override') }).initialize();
});
