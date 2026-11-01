import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const r=spawnSync(process.execPath,['--test','test/wallet-pay-dispatch-matching.test.mjs'],{cwd:root,stdio:'inherit'});
if(r.error)throw r.error;if(r.status!==0)process.exitCode=r.status??1;
