// This finite source cohort runs only its four new PUBLIC integrations + types.
// Auth's prior eight mathematics and Native component controls are reused.
import path from'node:path';import{fileURLToPath}from'node:url';import{execFileSync}from'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),pkg=root+'/packages/wallet-auth';
execFileSync(process.execPath,['--test','test/device-v4-linux-source-sdk-intake.test.mjs'],{cwd:pkg,stdio:'inherit',timeout:180000});
execFileSync(process.execPath,['node_modules/typescript/lib/tsc.js','--noEmit','--strict','--exactOptionalPropertyTypes','--target','es2022','--module','nodenext','--moduleResolution','nodenext','--types','node','test/device-v4-linux-source-sdk-intake.types.mts'],{cwd:pkg,stdio:'inherit',timeout:180000});
