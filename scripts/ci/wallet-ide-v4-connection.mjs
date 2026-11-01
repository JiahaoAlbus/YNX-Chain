import {fileURLToPath} from 'node:url';
import {dirname,join,resolve,relative} from 'node:path';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readdirSync,copyFileSync,mkdirSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const pkg=join(root,'packages/wallet-auth'),base=process.env.WALLET_AUTH_TEST_BASE_ROOT??pkg;
function child(args,env=process.env){const r=spawnSync(process.execPath,args,{stdio:'inherit',env});if(r.error)throw r.error;if(r.status!==0)throw Error(`NORMAL_V4_CONTROLS_FAILED status=${r.status} signal=${r.signal}`);}
if(process.argv.includes('--types-only')===false)child(['--test',join(pkg,'test/original-wallet-ide-v4-connection.test.mjs')],{...process.env,WALLET_AUTH_TEST_BASE_ROOT:base});
const temp=mkdtempSync(join(process.env.RUNNER_TEMP??process.env.TMPDIR??tmpdir(),'normal-v4-types-'));
try{
 function collect(directory){for(const d of readdirSync(directory,{withFileTypes:true})){const p=join(directory,d.name);if(d.isDirectory())collect(p);else if(d.isFile()&&/\.d\.(?:ts|mts)$/.test(p)){const to=join(temp,relative(base,p));mkdirSync(dirname(to),{recursive:true});copyFileSync(p,to);}}}
 collect(join(base,'src'));collect(join(base,'native'));
 mkdirSync(join(temp,'src'),{recursive:true});mkdirSync(join(temp,'test'),{recursive:true});
 copyFileSync(join(pkg,'src/original-wallet-ide-v4-connection.d.ts'),join(temp,'src/original-wallet-ide-v4-connection.d.ts'));
 copyFileSync(join(pkg,'test/original-wallet-ide-v4-connection.types.mts'),join(temp,'test/original-wallet-ide-v4-connection.types.mts'));
 writeFileSync(join(temp,'package.json'),' {"type":"module"}\n');
 const tsc=join(base,'node_modules/typescript/bin/tsc');if(!existsSync(tsc))throw Error('NORMAL_TYPESCRIPT_NOT_SUPPLIED');
 child([tsc,'--strict','--noEmit','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','--typeRoots',join(base,'node_modules/@types'),join(temp,'test/original-wallet-ide-v4-connection.types.mts')]);
 console.log('NEW_V4_NORMAL_TYPES_PASS eight refusals');
}finally{rmSync(temp,{recursive:true,force:true});}
