// New profile controls only; no Native compilation or GUI.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
execFileSync(process.execPath,['--test',fileURLToPath(new URL('./test/canonical-native-qa-profile.test.mjs',import.meta.url))],{stdio:'inherit',env:{...process.env,YNX_QA_PROFILE_SOURCE_ROOT:root}});
