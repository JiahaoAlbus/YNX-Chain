import {spawnSync} from 'node:child_process';import path from 'node:path';
const cwd=path.resolve(import.meta.dirname,'../..');const r=spawnSync(process.execPath,['--test','packages/wallet-auth/test/sourceparent-gcc-normal.test.mjs'],{cwd,stdio:'inherit'});if(r.error)throw r.error;process.exitCode=r.status??1;
