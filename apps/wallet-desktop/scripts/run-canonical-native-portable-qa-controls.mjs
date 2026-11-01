// Only new portable DATA/recipe controls; never compiles or loads Native.
import fs from'node:fs';import path from'node:path';import os from'node:os';import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';
if(process.argv.length>3)throw Error('PORTABLE_QA_CONTROLS_ARGUMENTS');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..'),output=process.argv[2]?path.resolve(process.argv[2]):fs.mkdtempSync(path.join(os.tmpdir(),'portable-qa-controls-'));
fs.mkdirSync(output,{recursive:true});
const test=spawnSync(process.execPath,['--test','apps/wallet-desktop/scripts/test/canonical-native-portable-qa-profile.test.mjs'],{cwd:root,encoding:'utf8',maxBuffer:4<<20});
fs.writeFileSync(path.join(output,'new-portable-data.log'),(test.stdout??'')+(test.stderr??''));
const result={kind:'CANONICAL_PORTABLE_QA_DATA_CONTROLS/v1',passed:test.status===0&&!test.error,status:test.status,signal:test.signal??null,compilerExecuted:false,helperExecuted:false,NativeLoaded:false,RootAdmission:false,SourceAdmission:false,ElectronLoad:false,actualOS13Runtime:false,installed:false};
fs.writeFileSync(path.join(output,'RESULT.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify({output,...result})+'\n');if(!result.passed)process.exitCode=1;
