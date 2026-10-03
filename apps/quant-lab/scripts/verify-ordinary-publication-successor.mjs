import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const manifest=JSON.parse(readFileSync(new URL('../integration/ordinary-publication-successor-20261003.json',import.meta.url),'utf8'));
const git=args=>execFileSync('git',args,{cwd:root,maxBuffer:4*1024*1024});
const text=args=>git(args).toString('utf8').trim();
const requireGate=(value,label)=>{if(!value)throw Error(label);};
requireGate(/^[a-f0-9]{40}$/.test(manifest.sourceCommit),'source commit');
requireGate(text(['rev-parse',manifest.sourceCommit+'^{tree}'])===manifest.sourceTree,'source tree');
requireGate(Array.isArray(manifest.objects)&&manifest.objects.length===11,'object set');
const seen=new Set();
for(const object of manifest.objects){
  requireGate(typeof object.path==='string'&&!seen.has(object.path)&&!object.path.includes('..')&&!path.isAbsolute(object.path),'path/duplicate');
  requireGate(/^(apps\/quant-lab\/(web|server|scripts|tests)\/|internal\/quantlab\/)/.test(object.path),'owner scope');
  seen.add(object.path);
  requireGate(text(['rev-parse',manifest.sourceCommit+':'+object.path])===object.blob,'source blob');
  const bytes=git(['cat-file','blob',object.blob]);
  requireGate(bytes.length===object.bytes&&createHash('sha256').update(bytes).digest('hex')===object.sha256,'source bytes/digest');
  requireGate(readFileSync(path.join(root,object.path)).equals(bytes),'working bytes');
}
requireGate(Object.values(manifest.truth).every(value=>value===false),'unproven truth');
console.log(JSON.stringify({classification:'LOCAL_EXACT_SOURCE_NOT_RELEASE_PROOF',sourceCommit:manifest.sourceCommit,sourceTree:manifest.sourceTree,verifiedObjects:seen.size,passed:true,publicVerified:false}));
