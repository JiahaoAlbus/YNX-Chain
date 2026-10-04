import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {EXCHANGE_RUNTIME_WEB_ASSETS,verifyExchangeVersionedAssets} from '../web/verify-versioned-assets.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=message=>{throw new Error(message)};
export function verifyRuntimeCandidate(archive,commit,readSource){
  if(!/^[a-f0-9]{40}$/.test(commit)||typeof readSource!=='function')fail('SOURCE_INVALID');
  const tar=gunzipSync(archive,{maxOutputLength:64*1024*1024});
  const release=`ynx-exchange-${commit.slice(0,12)}`,entries=new Map();
  let offset=0,terminated=false;
  while(offset+512<=tar.length){
    const header=tar.subarray(offset,offset+512);offset+=512;
    if(header.every(b=>b===0)){if(tar.length-offset<512||!tar.subarray(offset).every(b=>b===0))fail('TAR_TERMINATOR_INVALID');terminated=true;break;}
    const field=(a,n)=>header.subarray(a,a+n).toString().replace(/\0.*$/s,'');
    const octal=(a,n)=>{const v=field(a,n).trim();if(!/^[0-7]+$/.test(v))fail('TAR_OCTAL_INVALID');return parseInt(v,8)};
    const checksum=octal(148,8),normalized=Buffer.from(header);normalized.fill(32,148,156);
    if([...normalized].reduce((a,b)=>a+b,0)!==checksum||field(257,6)!=='ustar'||header[156]!==48)fail('TAR_HEADER_INVALID');
    const name=field(0,100),size=octal(124,12),mode=octal(100,8);
    if(!name.startsWith(`${release}/`)||name.includes('..')||name.includes('\\')||entries.has(name)||size>tar.length-offset)fail('TAR_PATH_OR_LENGTH_INVALID');
    entries.set(name,{data:tar.subarray(offset,offset+size),mode});
    if(!tar.subarray(offset+size,offset+Math.ceil(size/512)*512).every(b=>b===0))fail('TAR_PADDING_INVALID');
    offset+=Math.ceil(size/512)*512;
  }
  if(!terminated)fail('TAR_TERMINATOR_MISSING');
  const get=name=>entries.get(`${release}/${name}`)?.data;
  const expected=['ynx-exchanged',...EXCHANGE_RUNTIME_WEB_ASSETS.map(n=>`apps/exchange/web/${n}`),'BUNDLE_MANIFEST.json','SHA256SUMS'].sort();
  if(JSON.stringify([...entries.keys()].map(n=>n.slice(release.length+1)).sort())!==JSON.stringify(expected))fail('INVENTORY_SET_MISMATCH');
  for(const [name,entry] of entries)if(entry.mode!==(name===`${release}/ynx-exchanged`?0o755:0o644))fail('FILE_MODE_INVALID');
  const manifest=JSON.parse(get('BUNDLE_MANIFEST.json'));
  if(manifest.sourceCommit!==commit||manifest.release!==release||manifest.productId!=='ynx-exchange'||!/^[a-f0-9]{40}$/.test(manifest.sourceTree)||!Array.isArray(manifest.entries))fail('MANIFEST_SOURCE_INVALID');
  const manifestPaths=new Set();
  for(const item of manifest.entries){
    const entry=entries.get(item.path);
    if(!entry||manifestPaths.has(item.path)||entry.data.length!==item.bytes||sha(entry.data)!==item.sha256||entry.mode.toString(8)!==item.mode)fail('MANIFEST_ENTRY_INVALID');
    manifestPaths.add(item.path);
  }
  const inventoryExpected=expected.filter(n=>!['BUNDLE_MANIFEST.json','SHA256SUMS'].includes(n)).map(n=>`${release}/${n}`).sort();
  if(JSON.stringify([...manifestPaths].sort())!==JSON.stringify(inventoryExpected))fail('MANIFEST_SET_MISMATCH');
  const sums=new Set();
  for(const line of get('SHA256SUMS').toString().trimEnd().split('\n')){
    const match=/^([a-f0-9]{64})  (.+)$/.exec(line);
    if(!match||sums.has(match[2])||!get(match[2])||sha(get(match[2]))!==match[1])fail('CHECKSUM_INVALID');
    sums.add(match[2]);
  }
  if(JSON.stringify([...sums].sort())!==JSON.stringify(expected.filter(n=>n!=='SHA256SUMS')))fail('CHECKSUM_SET_MISMATCH');
  for(const name of EXCHANGE_RUNTIME_WEB_ASSETS)if(!get(`apps/exchange/web/${name}`).equals(readSource(`apps/exchange/web/${name}`)))fail('SOURCE_ASSET_MISMATCH');
  const binary=get('ynx-exchanged');
  if(binary.length<20||binary.toString('hex',0,4)!=='7f454c46'||binary[4]!==2||binary[5]!==1||binary.readUInt16LE(18)!==62||!binary.includes(Buffer.from(commit)))fail('BINARY_IDENTITY_INVALID');
  const graph=verifyExchangeVersionedAssets(get('apps/exchange/web/index.html').toString(),get('apps/exchange/web/app.js').toString(),name=>get(`apps/exchange/web/${name}`));
  return {sourceCommit:commit,sourceTree:manifest.sourceTree,release,archiveBytes:archive.length,archiveSha256:sha(archive),entryCount:entries.size,binaryBytes:binary.length,binarySha256:sha(binary),graph,entries:[...entries].map(([path,{data,mode}])=>({path,bytes:data.length,sha256:sha(data),mode:mode.toString(8)})),deployedPublic:false,installed:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [archive,commit]=process.argv.slice(2),root=path.resolve(import.meta.dirname,'../../..');
  const result=verifyRuntimeCandidate(readFileSync(archive),commit,name=>execFileSync('git',['show',`${commit}:${name}`],{cwd:root}));
  if(result.sourceTree!==execFileSync('git',['rev-parse',`${commit}^{tree}`],{cwd:root,encoding:'utf8'}).trim())fail('SOURCE_TREE_MISMATCH');
  console.log(JSON.stringify(result,null,2));
}
