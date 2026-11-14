import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {nativePayFailureCode} from './pay-business-client.mjs';
const write=value=>process.stdout.write(JSON.stringify(value)+'\n');
// GUI sends DATA only. The optional original owner module is selected and
// hashed at build time, never by user input, URL, IPC packet or environment.
try{
 const configFile=path.resolve(path.dirname(process.argv[1]),'desktop-runtime.json');
 const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
 if(!config.runtime){write({phase:'unavailable',code:'NATIVE_PAY_NORMAL_MAIN_SOURCE_NOT_SUPPLIED',normalMainEntry:false,clientStarted:true,mainApproval:false,submission:false});process.exitCode=2;}
 else{
  if(!Array.isArray(config.runtimeFiles)||!config.runtimeFiles.length||config.runtimeFiles.length>512||config.runtimeFiles.filter(ref=>ref?.path===config.runtime&&ref?.sha256===config.sha256).length!==1||new Set(config.runtimeFiles.map(ref=>ref?.path)).size!==config.runtimeFiles.length)throw Object.assign(Error(),{code:'NATIVE_PAY_NORMAL_RUNTIME_IDENTITY_MISMATCH'});
  const file=path.resolve(path.dirname(configFile),config.runtime);
  if(!file.startsWith(path.dirname(configFile)+path.sep)||createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==config.sha256)throw Object.assign(Error(),{code:'NATIVE_PAY_NORMAL_RUNTIME_IDENTITY_MISMATCH'});
  for(const ref of config.runtimeFiles){if(!ref||typeof ref.path!=='string'||!/^normal-runtime\/[A-Za-z0-9_./-]+$/.test(ref.path)||ref.path.split('/').some(p=>!p||p==='.'||p==='..')||! /^[0-9a-f]{64}$/.test(ref.sha256))throw Object.assign(Error(),{code:'NATIVE_PAY_NORMAL_RUNTIME_IDENTITY_MISMATCH'});const dependency=path.resolve(path.dirname(configFile),ref.path);if(!dependency.startsWith(path.dirname(configFile)+path.sep)||fs.realpathSync(dependency)!==path.join(fs.realpathSync(path.dirname(configFile)),ref.path)||fs.lstatSync(dependency).isSymbolicLink()||createHash('sha256').update(fs.readFileSync(dependency)).digest('hex')!==ref.sha256)throw Object.assign(Error(),{code:'NATIVE_PAY_NORMAL_RUNTIME_IDENTITY_MISMATCH'});}
  const module=await import(pathToFileURL(file).href);
  if(typeof module.openNativePayMainEntry!=='function')throw Object.assign(Error(),{code:'NATIVE_PAY_NORMAL_MAIN_SOURCE_NOT_SUPPLIED'});
  const entry=await module.openNativePayMainEntry();
  try{
   const raw=fs.readFileSync(0);if(!raw.length||raw.length>4096)throw Object.assign(Error(),{code:'NATIVE_PAY_MAIN_INPUT_INVALID'});
   const request=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(raw));
   const result=request.action==='status'?await entry.status():await entry.invoke(request);write(result);
  }finally{if(typeof entry.close==='function')await entry.close();}
 }
}catch(error){write({phase:'unavailable',code:nativePayFailureCode(error,'NATIVE_PAY_NORMAL_MAIN_SOURCE_UNAVAILABLE'),mainApproval:false,submission:false});process.exitCode=2;}
