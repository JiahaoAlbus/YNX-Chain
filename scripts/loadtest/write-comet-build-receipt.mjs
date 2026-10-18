// Retain the exact consensus dependency beside the application candidate.
// This inspects a cross-built program; it does not start any node.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const [directory,...extra]=process.argv.slice(2);
if(!directory||extra.length)throw Error('one candidate directory required');
const root=path.resolve(directory),binary=path.join(root,'cometbft');
const st=fs.lstatSync(binary);
if(fs.lstatSync(root).isSymbolicLink()||!st.isFile()||st.isSymbolicLink()||st.size<32||st.size>64*1024*1024)throw Error('consensus candidate type/size bound');
const bytes=fs.readFileSync(binary);
if(bytes.readUInt32LE(0)!==0xfeedfacf||bytes.readUInt32LE(4)!==0x0100000c)throw Error('consensus candidate is not Mach-O arm64');
const run=(command,args)=>execFileSync(command,args,{encoding:'utf8',timeout:5000,maxBuffer:1024*1024}).trim();
const module=JSON.parse(run('go',['list','-m','-json','github.com/cometbft/cometbft']));
if(module.Path!=='github.com/cometbft/cometbft'||module.Version!=='v0.38.23'||module.Replace||!module.Sum)throw Error('consensus dependency differs from pinned unreplaced module');
const buildInfo=run('go',['version','-m',binary]);
for(const expected of ['GOOS=darwin','GOARCH=arm64','CGO_ENABLED=0','github.com/cometbft/cometbft/cmd/cometbft',module.Version,module.Sum])if(!buildInfo.includes(expected))throw Error('consensus build target/module mismatch: '+expected);
const app=JSON.parse(fs.readFileSync(path.join(root,'build-receipt.json'),'utf8'));
const head=run('git',['rev-parse','HEAD']);
if(app.sourceCommit!==head||app.sourceDirty||run('git',['status','--porcelain','--untracked-files=no'])!=='')throw Error('application/source identity changed');
const after=fs.lstatSync(binary);
if(after.isSymbolicLink()||st.dev!==after.dev||st.ino!==after.ino||st.size!==after.size||st.mtimeMs!==after.mtimeMs)throw Error('consensus candidate changed while inspecting');
const receipt={schema:1,status:'cross_built_dependency_not_executed',applicationSource:head,applicationSourcePins:app.sourcePins,module:{path:module.Path,version:module.Version,sum:module.Sum},compiler:run('go',['version']),buildInfo,target:app.target,binary:{name:'cometbft',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},buildCommand:['go','build','-p','1','-trimpath','-o','<exclusive-candidate-directory>/cometbft','github.com/cometbft/cometbft/cmd/cometbft'],nativeRuntimeSmoke:null,nodesStarted:false,networkPerformance:null,oldFrozenBinarySHA256:'60d991c4fe429e6fe942ebbcb7447a059328c6bcafbe9b09acd263db658bd840',interpretation:'New exact dependency candidate. Not a byte-identical restoration or replacement of the old missing cache binary. Use a separately pinned recipe after native verification and Root scheduling.'};
fs.writeFileSync(path.join(root,'comet-build-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({status:receipt.status,module:receipt.module,...receipt.binary}));
