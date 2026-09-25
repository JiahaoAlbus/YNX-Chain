import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(`server/${path}`, 'utf8');

test('production Card service loads TypeScript without ambient NODE_OPTIONS', () => {
  const service = read('./deployment/ynx-cardd.service');
  assert.match(service, /^ExecStart=\/usr\/bin\/node --import tsx \/opt\/ynx-card\/current\/apps\/card\/server\/main\.ts$/m);
  assert.match(service, /^ExecStartPre=\/usr\/bin\/node /m);
  assert.match(service, /^NoNewPrivileges=true$/m);
  assert.match(service, /^ProtectSystem=strict$/m);
  const pkg = JSON.parse(read('../package.json')) as { dependencies: Record<string, string>; devDependencies?: Record<string, string> };
  assert.equal(pkg.dependencies.tsx, '4.23.1');
  assert.equal(pkg.devDependencies?.tsx, undefined);
});

test('candidate runtime starts the same explicit TypeScript loader', () => {
  assert.match(read('./deployment/candidate-runtime.mjs'), /spawn\(process\.execPath,\['--import','tsx','server\/main\.ts'\]/);
});
