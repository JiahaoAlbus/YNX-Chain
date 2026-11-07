import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';import path from'node:path';
const pkg=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
for(const args of[['--test',path.join(pkg,'test/ide-cloud-lookup-typed.test.mjs')],[path.join(pkg,'node_modules/typescript/bin/tsc'),'--noEmit','--strict','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext',path.join(pkg,'test/ide-cloud-lookup-typed.types.mts')]]){const r=spawnSync(process.execPath,args,{cwd:pkg,stdio:'inherit',env:process.env});if(r.status!==0)process.exit(r.status??1)}
