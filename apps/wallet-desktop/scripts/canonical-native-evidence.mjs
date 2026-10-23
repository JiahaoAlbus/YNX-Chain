import {createHash} from 'node:crypto';
import {CANONICAL_NATIVE_EVIDENCE_TESTS,canonicalSourcePath} from './canonical-package.mjs';

/** Offline packaging DATA, never a compiler input or executable entrypoint.
 * electron-builder excludes *.test.mjs from dependencies. Preserve only this
 * closed source-inspection pair from the selected immutable Git composition.
 * Never use a directory scan, a receipt-selected name, or a mutable SDK copy. */
export function canonicalNativeEvidencePlan(sdkVersion,readSource){
 const contents=new Map(),rows=[],publicRows=[];
 if(!['1.3.0-pq.3.32-auth.13','1.3.0-pq.3.32-auth.14','1.3.0-pq.3.32-auth.18','1.3.0-pq.3.32-auth.19'].includes(sdkVersion))return {contents,rows,public:publicRows};
 if(typeof readSource!=='function')throw Error('Native evidence source reader required');
 for(const sourcePath of CANONICAL_NATIVE_EVIDENCE_TESTS){
  const source=readSource(sourcePath);
  if(!Buffer.isBuffer(source)||source.length===0||source.length>262144)throw Error('Native evidence source differs: '+sourcePath);
  const bytes=Buffer.from(source),target=canonicalSourcePath(sourcePath),sha256=createHash('sha256').update(bytes).digest('hex');
  contents.set(target,bytes);
  rows.push({path:target,type:'file',unpacked:false,executable:false,physicalMode:null,bytes:bytes.length,sha256});
  publicRows.push({sourcePath,path:target,bytes:bytes.length,sha256,role:'git-bound-source-inspection-evidence'});
 }
 return {contents,rows,public:publicRows};
}
