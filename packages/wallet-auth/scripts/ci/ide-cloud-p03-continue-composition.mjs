import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';
const r=spawnSync(process.execPath,['--test',fileURLToPath(new URL('../../test/ide-cloud-p03-continue-composition.test.mjs',import.meta.url))],{env:process.env,stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);
