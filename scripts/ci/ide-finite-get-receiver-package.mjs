import fs from 'node:fs';import path from 'node:path';import {execFileSync,spawnSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'../..'),out=path.join(root,'ide-finite-get-receiver-controls'),packdir=path.join(root,'canonical-common-source-package');
const archives=fs.readdirSync(packdir).filter(x=>x.endsWith('.tgz'));if(archives.length!==1)throw Error('EXACT_ONE_NORMAL_ARCHIVE_REQUIRED');
const consumer=fs.mkdtempSync(path.join(out,'production-'));fs.writeFileSync(path.join(consumer,'package.json'),'{"private":true}\n');
execFileSync('npm',['install','--omit=dev','--ignore-scripts','--no-audit','--no-fund','--prefix',consumer,path.join(packdir,archives[0])],{stdio:'inherit',timeout:120000});
const pkg=path.join(consumer,'node_modules/@ynx-chain/wallet-auth'),entry=path.join(pkg,'native/original-ide-finite-get-receiver-originals.mjs');
const original=fs.readFileSync(path.join(root,'packages/wallet-auth/native/original-ide-finite-get-receiver-originals.mjs'));if(!original.equals(fs.readFileSync(entry)))throw Error('PACKED_ORIGINAL_DIFFERS');
const input=fs.readFileSync(path.join(root,'packages/wallet-auth/test/fixtures/ide-finite-get-receiver-public-input.json'));
const r=spawnSync(process.execPath,[entry],{input,encoding:'utf8',timeout:15000,maxBuffer:262144,env:{}});if(r.status!==0)throw Error('PACKED_CLI_FAILED:'+r.stderr);const x=JSON.parse(r.stdout);if(x.dataOnly!==true||x.authorized!==false||x.memberOriginal!=='AQID')throw Error('PACKED_DATA_DIFFERS');
// Tooling TypeScript is a declared normal dependency, not injected dev state.
const {generateIDEFiniteGETReceiverClosureDATA}=await import(pathToFileURL(path.join(pkg,'scripts/ide-finite-get-receiver-closure.mjs')));const graph=generateIDEFiniteGETReceiverClosureDATA();if(!graph.manifest.files.some(r=>r.path==='native/original-ide-finite-get-receiver-originals.mjs'))throw Error('PACKED_GRAPH_MISSING');fs.writeFileSync(path.join(out,'PACKED_RECEIVER_STATIC_CLOSURE.json'),JSON.stringify(graph)+'\n');
fs.writeFileSync(path.join(out,'PACKED_RESULT.json'),JSON.stringify({passed:true,productionInstall:true,files:graph.manifest.files.length,edges:graph.report.edges.length,originalScriptSame:true,privateCLI:true,RootAdmission:false,NativeAdmission:false})+'\n');
