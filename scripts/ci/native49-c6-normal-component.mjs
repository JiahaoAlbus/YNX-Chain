import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const file=fileURLToPath(new URL('../../apps/wallet-desktop/test/native49-c6-normal-component.test.mjs',import.meta.url));
const r=spawnSync(process.execPath,['--test',file],{stdio:'inherit'});if(r.error)throw r.error;process.exitCode=r.status??1;
