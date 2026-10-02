import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const source = fileURLToPath(new URL('../ios/YNXVideo/ProductDeviceKey.swift', import.meta.url));
const fixture = fileURLToPath(new URL('./native-key-check.swift', import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), 'ynx-video-native-key-check-'));
try {
  const executable = path.join(temporary, 'native-key-check');
  const compile = spawnSync('xcrun', ['swiftc', '-module-cache-path', path.join(temporary, 'modules'), source, fixture, '-o', executable], {stdio: 'inherit'});
  if (compile.error) throw compile.error;
  if (compile.status !== 0) throw new Error(`Swift fixture compilation failed (${compile.status})`);
  const check = spawnSync(executable, [], {stdio: 'inherit'});
  if (check.error) throw check.error;
  if (check.status !== 0) throw new Error(`Device key fixture failed (${check.status})`);
} finally {
  await rm(temporary, {recursive: true, force: true});
}
