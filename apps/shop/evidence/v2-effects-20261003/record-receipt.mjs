import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const base=path.dirname(fileURLToPath(import.meta.url));
const root=execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const pin=file=>{const bytes=fs.readFileSync(file);return {bytes:bytes.length,sha256:sha(bytes)}};
const results={};
for(const name of ['final-ordinary-race.log','final-tagged-race.log','actual-sdk-effects-race.log']){
 const log=fs.readFileSync(path.join(base,name),'utf8');
 const passed=[...log.matchAll(/^\s*--- PASS: (\S+)/gm)].map(match=>match[1]);
 results[name]={topLevel:passed.filter(name=>!name.includes('/')).length,leaf:passed.filter(name=>!log.includes('=== RUN   '+name+'/')).length,failed:(log.match(/--- FAIL:/g)||[]).length,skipped:(log.match(/--- SKIP:/g)||[]).length,summary:log.trim().split('\n').slice(-2),...pin(path.join(base,name))};
 if(results[name].failed||results[name].skipped||!log.includes('\nPASS\n')) throw new Error('unverified '+name);
}
const sourcePins={};
for(const name of fs.readdirSync(path.join(root,'internal/commerce')).filter(name=>name.endsWith('.go'))){const file='internal/commerce/'+name;sourcePins[file]=pin(path.join(root,file));}
const evidencePins={};
for(const name of fs.readdirSync(base).filter(name=>name!=='receipt.json')) evidencePins[name]=pin(path.join(base,name));
const receipt={sourceBasis:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),schema:13,sharedFrozenSource:'c09cb9b8ad13fe879363f7e6ad3d129912740c7e',results,sourcePins,evidencePins,independentOriginalProbes:'Both original schema11 deleted-native replay cases PASS unchanged; original FAIL logs retained',externalSourceAdmission:{payInvoiceHandoff:true,aiGeneration:true,settlement:false,orderTransition:false,providerTest:false,sellerAuthorityRevocation:false,aiStream:false},limitations:{controlledActorBinder:true,softwareQAKeys:true,publicBusinessVerified:false,realWalletApproval:false,nativeInstalled:false,productionV2Mounted:false,releaseAccepted:false,refundExecution:false,fullGoalComplete:false},setupNotes:['Initial targeted run selected no tests because the local Python executable did not write the test file; no-pass result was rejected and file created with apply_patch.','A temporary composition copy first used a relative source path and reran stale original failures; corrected to exact owned absolute source paths.','Initial RawMessage journal reopen failures retained; exact wire bytes now preserved as byte arrays.']};
fs.writeFileSync(path.join(base,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({results,receiptSha256:sha(fs.readFileSync(path.join(base,'receipt.json')))}));
