#!/usr/bin/env node
// Independent cross-built Linux QA candidate. Never installs/starts a service,
// changes systemd delegation, creates a VM or downloads a containment runtime.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const args=process.argv.slice(2),allowed=new Set(['--plan','--out-dir','--expect-head','--arch','--sandbox-sha256']);
const option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1]};
for(let i=0;i<args.length;i++){if(!allowed.has(args[i]))throw Error('Unknown Linux QA builder option');if(args[i]!=='--plan'&&!args[++i])throw Error('Missing builder value')}
const arch=option('--arch')??'amd64',expected=option('--expect-head'),pin=option('--sandbox-sha256'),out=option('--out-dir');if(!['amd64','arm64'].includes(arch))throw Error('Unsupported Linux QA architecture');
const env={...process.env,GOOS:'linux',GOARCH:arch,CGO_ENABLED:'0',GOWORK:'off',GOFLAGS:'',GOMAXPROCS:'2'};
function run(file,args,options={}){const r=spawnSync(file,args,{cwd:root,env,encoding:'utf8',maxBuffer:48<<20,...options});if(r.error||r.status)throw Error(`${file} failed: ${r.error?.message??r.stderr?.slice(-4000)}`);return r.stdout.trim()}
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function jsonStream(raw){let start=-1,depth=0,q=false,e=false;const values=[];for(let i=0;i<raw.length;i++){const c=raw[i];if(start<0){if(c==='{'){start=i;depth=1}continue}if(q){if(e)e=false;else if(c==='\\')e=true;else if(c==='"')q=false;continue}if(c==='"')q=true;else if(c==='{')depth++;else if(c==='}'&&!--depth){values.push(JSON.parse(raw.slice(start,i+1)));start=-1}}if(start>=0)throw Error('Incomplete dependency graph');return values}
function snapshot(){
 const head=run('git',['rev-parse','HEAD']);if(expected&&head!==expected)throw Error('Exact source HEAD mismatch');const dirty=run('git',['status','--porcelain=v1','--untracked-files=all']);
 const names=new Set(['go.mod','go.sum','apps/network/qa/build-linux.mjs']);
 for(const p of jsonStream(run('go',['list','-mod=readonly','-deps','-test','-json','./apps/network/contribution','./cmd/ynx-network-helper']))){if(!p.Dir?.startsWith(root+path.sep))continue;for(const field of ['GoFiles','TestGoFiles','XTestGoFiles','EmbedFiles'])for(const name of p[field]??[]){const file=path.relative(root,path.isAbsolute(name)?name:path.join(p.Dir,name));if(!file.startsWith('..'))names.add(file)}}
 function nested(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())nested(file);else if(/\.(go|wasm)$/.test(item.name)||['go.mod','go.sum'].includes(item.name))names.add(path.relative(root,file))}}nested(path.join(root,'apps/network/wasmworker'));
 const inputs=[...names].sort().map(p=>({path:p,bytes:fs.statSync(path.join(root,p)).size,sha256:sha(fs.readFileSync(path.join(root,p)))}));
 return {head,branch:run('git',['branch','--show-current']),dirty:dirty!=='',dirtyPaths:dirty.split('\n').filter(Boolean),inputs,inputSHA256:sha(JSON.stringify({head,inputs})),goVersion:run('go',['version'])};
}
const source=snapshot();
if(args.includes('--plan')){process.stdout.write(JSON.stringify({kind:'YNX-NETWORK-LINUX-QA-PLAN/v1',target:`linux/${arch}`,source,productionEnabled:false,installed:false})+'\n');process.exit(0)}
if(source.dirty)throw Error('Preserve dirty source; commit the complete candidate before packaging');
if(!pin||!/^[0-9a-f]{64}$/.test(pin))throw Error('Independent existing /usr/bin/bwrap SHA256 required; no runtime path selector');
if(!out||!path.isAbsolute(out)||path.resolve(out)!==out)throw Error('Independent absolute output parent required');fs.mkdirSync(out,{recursive:true,mode:0o700});
const identity=sha(JSON.stringify({head:source.head,inputs:source.inputSHA256,arch,sandbox:pin}));const destination=path.join(out,`ynx-network-linux-qa-${arch}-${source.head.slice(0,12)}-${identity.slice(0,8)}`);if(fs.existsSync(destination))throw Error('Existing Linux candidate preserved');
const stage=fs.mkdtempSync(path.join(out,'.network-linux-build-'));const worker=path.join(stage,'ynx-network-task-worker');
const workerEnv={...env,GOTOOLCHAIN:'local',GOMODCACHE:process.env.YNX_NETWORK_WORKER_GOMODCACHE};if(!path.isAbsolute(workerEnv.GOMODCACHE??''))throw Error('Explicit independent worker module cache required');
const go=path.join(run('go',['env','GOROOT']),'bin/go');
run(go,['build','-mod=readonly','-trimpath','-buildvcs=false','-p','1','-o',worker,'.'],{cwd:path.join(root,'apps/network/wasmworker'),env:workerEnv});
const workerPin=sha(fs.readFileSync(worker));
run(go,['build','-mod=readonly','-trimpath','-buildvcs=false','-p','1','-ldflags',`-X main.sourceRevision=${source.head} -X main.resourceWorkerSHA256=${workerPin} -X main.resourceSandboxSHA256=${pin}`,'-o',path.join(stage,'ynx-network-helper'),'./cmd/ynx-network-helper']);
run(go,['test','-mod=readonly','-trimpath','-buildvcs=false','-p','1','-c','-o',path.join(stage,'contribution.test'),'./apps/network/contribution']);
run(go,['build','-mod=readonly','-trimpath','-buildvcs=false','-p','1','-o',path.join(stage,'ynx-network-resource-probe'),'./qa/linux-resource-probe'],{cwd:path.join(root,'apps/network/wasmworker'),env:workerEnv});
fs.writeFileSync(path.join(stage,'START.command'),'#!/bin/sh\nset -eu\nqa_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$qa_dir/ynx-network-helper" "$@"\n',{flag:'wx',mode:0o755});
fs.writeFileSync(path.join(stage,'READ_ME.txt'),`YNX Network independent Linux QA\nSource ${source.head}\nNormal entry ./START.command (existing helper defaults; production resource NewDisabled)\nControlled fixture CLI uses one fixed worker with compiled worker and existing system bwrap pins. Requires an already scheduled nonroot systemd Delegate=cpu memory pids, DelegateSubgroup=supervisor unit with reserved name ynx-network-resource-32lowerhex.service. No delegate/root/userns/seccomp/cgroup2 support means UNSUPPORTED; no unsandboxed fallback.\ncontribution.test and ynx-network-resource-probe are explicit closed QA artifacts, never product job code. Their paths are not accepted in product task JSON.\nNo original proof verifier or canonical resource issuer/Native consent supplied. No Source/Root/human grant, rewards or public contribution.\nNot installed, publisher signed, deployed or runtime-qualified. Linux evidence never qualifies macOS.\n`,{flag:'wx',mode:0o600});
const final=snapshot();if(final.head!==source.head||final.inputSHA256!==source.inputSHA256||final.dirty)throw Error('Source changed during Linux build; staging preserved');
const outputs=fs.readdirSync(stage).sort().map(name=>{const p=path.join(stage,name);return {path:name,bytes:fs.statSync(p).size,sha256:sha(fs.readFileSync(p))}});
fs.writeFileSync(path.join(stage,'source-manifest.json'),JSON.stringify({kind:'YNX-NETWORK-LINUX-QA/v1',builtAt:new Date().toISOString(),target:`linux/${arch}`,source,workerSHA256:workerPin,sandboxPath:'/usr/bin/bwrap',sandboxSHA256:pin,closedRuntimeSelector:'^TestLinuxContainedRuntime$',outputs,productionEnabled:false,publisherSigned:false,installed:false,runtimeVerified:false,originalProofVerifierSupplied:false},null,2)+'\n',{flag:'wx',mode:0o600});
fs.renameSync(stage,destination);process.stdout.write(JSON.stringify({bundle:destination,source:source.head,target:`linux/${arch}`,outputs:outputs.length,inputs:source.inputs.length,productionEnabled:false,installed:false,runtimeVerified:false})+'\n');
