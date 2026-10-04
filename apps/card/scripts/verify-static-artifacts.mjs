import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,readdirSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {pathToFileURL} from 'node:url';

export const canonical=value=>JSON.stringify(value&&typeof value==='object'
  ?Array.isArray(value)?value.map(item=>JSON.parse(canonical(item))):Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(canonical(value[key]))]))
  :value);
export const sha256=value=>createHash('sha256').update(value).digest('hex');
export function envelopeFiles(root,ignoreMetadata=false){
  const walk=directory=>readdirSync(directory).flatMap(name=>{
    const path=resolve(directory,name),key=relative(root,path).split('\\').join('/');
    if(ignoreMetadata&&(key==='.vercel'||key==='artifact-files.json'))return [];
    const stat=lstatSync(path);
    if(stat.isSymbolicLink())throw new Error('CARD_ENVELOPE_SYMLINK_FORBIDDEN');
    if(stat.isDirectory())return walk(path);
    if(!stat.isFile())throw new Error('CARD_ENVELOPE_FILE_TYPE_INVALID');
    const bytes=readFileSync(path);
    return [{path:key,bytes:bytes.length,sha256:sha256(bytes)}];
  });
  return walk(root).sort((a,b)=>a.path.localeCompare(b.path));
}
export function verifyStaticArtifacts(root){
  const manifest=JSON.parse(readFileSync(resolve(root,'artifact-files.json'),'utf8'));
  if(manifest.schemaVersion!=='ynx.card.static-envelope.v2'||!Array.isArray(manifest.files)||!manifest.files.length)throw new Error('CARD_ENVELOPE_MANIFEST_INVALID');
  const expected=new Map();
  for(const row of manifest.files){
    if(typeof row.path!=='string'||!row.path||row.path.startsWith('/')||row.path.includes('\\')||row.path.split('/').some(part=>!part||part==='.'||part==='..')||expected.has(row.path)||!Number.isSafeInteger(row.bytes)||row.bytes<0||!/^[a-f0-9]{64}$/.test(row.sha256))throw new Error('CARD_ENVELOPE_MANIFEST_INVALID');
    expected.set(row.path,row);
  }
  const actual=envelopeFiles(root,true);
  if(actual.length!==expected.size)throw new Error('CARD_ENVELOPE_FILE_SET_MISMATCH');
  for(const row of actual){
    const pinned=expected.get(row.path);
    if(!pinned)throw new Error('CARD_ENVELOPE_FILE_SET_MISMATCH');
    if(row.path==='vercel.json'){
      if(sha256(canonical(JSON.parse(readFileSync(resolve(root,row.path),'utf8'))))!==manifest.configCanonicalSha256)throw new Error('CARD_ENVELOPE_CONFIG_MISMATCH');
    }else if(row.bytes!==pinned.bytes||row.sha256!==pinned.sha256)throw new Error('CARD_ENVELOPE_BYTES_MISMATCH: '+row.path);
  }
  const identity=JSON.parse(readFileSync(resolve(root,'dist-web/runtime-identity.json'),'utf8'));
  if(identity.sourceCommit!==manifest.sourceCommit||identity.sourceTree!==manifest.sourceTree||identity.cardApiCompatibility?.backendSourceCommit!==manifest.backendSourceCommit)throw new Error('CARD_ENVELOPE_IDENTITY_MISMATCH');
  return actual.length;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log('CARD_EXACT_STATIC_ENVELOPE_PASS '+verifyStaticArtifacts(process.cwd()));
