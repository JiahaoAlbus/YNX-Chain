'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const root=__dirname;
const manifest=JSON.parse(fs.readFileSync(path.join(root,'artifact-files.json'),'utf8'));
if(manifest.schema!=='ynx-social-frozen-web-files/v1'||!Array.isArray(manifest.files))throw Error('INVALID_BUILD_MANIFEST');
const expected=new Set();
for(const entry of manifest.files){
 if(typeof entry.path!=='string'||entry.path.startsWith('/')||entry.path.split('/').some(p=>!p||p==='.'||p==='..')||expected.has(entry.path))throw Error('INVALID_ARTIFACT_PATH');
 expected.add(entry.path);
 const file=path.join(root,entry.path);
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink())throw Error('NONREGULAR_ARTIFACT:'+entry.path);
 const bytes=fs.readFileSync(file);
 if(bytes.length!==entry.bytes||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('ARTIFACT_BYTES_MISMATCH:'+entry.path);
}
function walk(dir){for(const name of fs.readdirSync(dir)){const file=path.join(dir,name),stat=fs.lstatSync(file);if(stat.isSymbolicLink())throw Error('SYMLINK_REJECTED');if(stat.isDirectory())walk(file);else if(!stat.isFile()||!expected.has(path.relative(root,file).split(path.sep).join('/')))throw Error('UNLISTED_OUTPUT:'+file);}}
walk(path.join(root,'dist'));
if(!expected.has('dist/index.html')||!expected.has('dist/.well-known/ynx-social-build.json')||!expected.has('vercel.json')||!expected.has('verify-build.cjs'))throw Error('MISSING_BUILD_CONTRACT');
console.log('PASS frozen Social web build contract source='+manifest.source.commit+' files='+manifest.files.length+' output=dist; not deployment or runtime acceptance');
