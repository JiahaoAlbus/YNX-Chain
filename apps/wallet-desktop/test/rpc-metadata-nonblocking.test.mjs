import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,unlinkSync,rmdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
test('abnormal FIFO diagnostic path cannot block the main process before regular-file guard',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'wallet-metadata-fifo-')),file=path.join(dir,'trace');
 try {
   const fifo=spawnSync('/usr/bin/mkfifo',[file],{timeout:1000});assert.equal(fifo.status,0);
   const module=process.env.WALLET_METADATA_RECORDER_SOURCE??fileURLToPath(new URL('../src/rpc-metadata-failure-record.mjs',import.meta.url));
   const code=`import {recordRPCMetadataFailure} from ${JSON.stringify(pathToFileURL(module).href)};const e=Object.assign(Error('PUBLIC'),{data:{code:'RPC_TIMEOUT'},rpcMetadataObservation:{method:'ynx_getFeeModel',stage:'fetch',httpStatus:null,elapsedMs:10000}});if(recordRPCMetadataFailure(e,${JSON.stringify(file)})!==false)process.exitCode=2;`;
   const child=spawnSync(process.execPath,['--input-type=module','-e',code],{timeout:1500,encoding:'utf8'});
   assert.equal(child.error,undefined,'diagnostic FIFO must not time out or block');assert.equal(child.status,0,child.stderr);
 } finally {try{unlinkSync(file);}catch{}rmdirSync(dir);}
});
