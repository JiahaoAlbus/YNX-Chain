import test from 'node:test';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
// Source CI uses the selected complete SDK's declared TypeScript tool. The
// product runtime does not execute this test or acquire any capability.
test('migration and existing typed declarations retain exact kind and false authority flags',()=>{
 const entry=import.meta.resolve('@ynx-chain/wallet-auth'),require=createRequire(entry),compiler=require.resolve('typescript/bin/tsc');
 try{execFileSync(process.execPath,[compiler,'--noEmit','--strict','--skipLibCheck','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022',fileURLToPath(new URL('./migration-finality.typecheck.mts',import.meta.url)),fileURLToPath(new URL('./typed-action-finality-pipeline.typecheck.mts',import.meta.url))],{stdio:'pipe',timeout:30000});}
 catch(error){throw Error(Buffer.concat([error.stdout??Buffer.alloc(0),error.stderr??Buffer.alloc(0)]).toString('utf8'),{cause:error});}
});
