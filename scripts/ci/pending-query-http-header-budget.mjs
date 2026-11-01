import {spawnSync} from 'node:child_process';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');const r=spawnSync(process.execPath,['--test',path.join(root,'packages/wallet-auth/test/pending-query-http-header-budget.test.mjs')],{stdio:'inherit',timeout:60000});if(r.error)throw r.error;if(r.status!==0)throw Error(JSON.stringify({status:r.status,signal:r.signal}));
