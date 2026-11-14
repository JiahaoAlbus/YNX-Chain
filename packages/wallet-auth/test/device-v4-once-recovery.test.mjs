import {mkdtempSync,rmSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const native=fileURLToPath(new URL('../native/',import.meta.url)),fallback=process.env.YNX_TEST_SOURCE_NATIVE??native;
const fixture=fileURLToPath(new URL('./native/device-v4-once-recovery.cpp',import.meta.url));
const root=mkdtempSync(join(homedir(),'.ynx-v4-recovery-public-'));
const args=['-std=c++17','-I'+native,'-I'+fallback,fixture,'-o',join(root,'probe')];if(process.platform!=='darwin')args.push('-lcrypto');
const opts={encoding:'utf8',env:{...process.env,TMPDIR:root},maxBuffer:4<<20};
const build=spawnSync('clang++',args,opts);if(build.status!==0){console.error(build.stderr);console.error('PUBLIC fixture retained at '+root);process.exit(1);}
const run=spawnSync(join(root,'probe'),[root],opts);if(run.status!==0){console.error(run.stderr);console.error('PUBLIC fixture retained at '+root);process.exit(1);}
rmSync(root,{recursive:true,force:true});console.log('actual journal: 11 original-outcome and corruption controls; no signing re-entry');
