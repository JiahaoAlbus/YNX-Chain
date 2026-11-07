// New merged relay issuer context only. No Root, protected placement or Native.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..'),pkg=path.join(root,'packages/wallet-auth'),out=path.join(root,'ide-relay-issuance-normal-controls');
fs.mkdirSync(out,{recursive:true});
execFileSync(process.execPath,['--test','test/relay-issuance-successor.test.mjs'],{cwd:pkg,stdio:'inherit',timeout:120000});
for(const relative of ['native/original-auth-identity-source-v2-verifier.mjs','src/original-auth-source-issuance-v2.js','src/original-ide-relay-issuance.js','src/original-ide-relay-issuance-selection.js'])execFileSync(process.execPath,['--check',relative],{cwd:pkg,stdio:'inherit',timeout:30000});
fs.writeFileSync(path.join(out,'RESULT.json'),JSON.stringify({passed:true,newMergedContextControls:5,productionRuntime:{node:process.version,openssl:process.versions.openssl},syntaxFiles:4,RootAdmission:false,protectedPlacement:false,realSigning:false,NativeCompiled:false})+'\n');
