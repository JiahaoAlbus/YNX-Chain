import fs from'node:fs';import path from'node:path';import{fileURLToPath}from'node:url';import{relocateOriginalAuthRuntime,pinRegular}from'./original-auth-runtime-relocate.mjs';
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),repo=path.resolve(app,'../..'),native=path.join(app,'native','root14-product45');
if(process.argv.length!==2)throw Error('NATIVE_PORTABLE_FIXED_STAGE_ZERO_ARGUMENTS');
const config=JSON.parse(fs.readFileSync(path.join(app,'native','original-wallet-portable-runtime-inputs.json'),'utf8'));
const relative=p=>{if(typeof p!=='string'||path.isAbsolute(p)||p.split('/').some(s=>!s||s==='.'||s==='..')||p.includes('\\'))throw Error('NATIVE_PORTABLE_RELATIVE_INPUT');return path.join(repo,p);};
const library=r=>({...r,input:{...r.input,path:relative(r.input.path)},licenses:r.licenses.map(l=>({...l,input:{...l.input,path:relative(l.input.path)}}))});
const input=pinRegular(path.join(native,'original-auth-identity.linked.node'));
const result=relocateOriginalAuthRuntime({version:1,adhocQA:true,inputModule:input,outputDirectory:path.join(native,'.original-auth-portable-component'),libraries:config.libraries.map(library)});
// Publish only complete verified copies into the original normal component's
// fixed sibling layout. Never overwrite a previous output or record.
const targetLib=path.join(native,'original-auth-runtime-libs');fs.mkdirSync(targetLib,{mode:0o755});
for(const name of fs.readdirSync(path.join(path.dirname(result.outputModule.path),'original-auth-runtime-libs'))){const from=path.join(path.dirname(result.outputModule.path),'original-auth-runtime-libs',name),to=path.join(targetLib,name);fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);}
const output=path.join(native,'original-auth-identity.node');fs.copyFileSync(result.outputModule.path,output,fs.constants.COPYFILE_EXCL);
const facts={...result,outputModule:pinRegular(output),libraryDirectory:targetLib,libraries:config.libraries.map(l=>pinRegular(path.join(targetLib,l.name))),copiedFromStaging:true,buildRecordGenerated:false,RootAdmission:false,SourceAdmission:false,ElectronLoad:false};
fs.writeFileSync(path.join(native,'original-auth-portable-runtime.json'),JSON.stringify(facts,null,2)+'\n',{flag:'wx',mode:0o644});
console.log(JSON.stringify({portableRuntime:facts.outputModule,dependencyCount:3,relocated:true,adhocQAOnly:true,recordMustFollow:true}));
