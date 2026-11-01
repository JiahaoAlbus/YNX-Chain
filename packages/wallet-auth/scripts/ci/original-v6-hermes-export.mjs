import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';
const r=spawnSync(process.execPath,['--test',fileURLToPath(new URL('../../test/original-v6-hermes-export.test.mjs',import.meta.url))],{stdio:'inherit',env:process.env});if(r.status!==0)process.exit(r.status??1);
