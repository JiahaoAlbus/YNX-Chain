'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const raw=fs.readFileSync('build-manifest.json');
if(sha(raw)!=='7b69b496454d712d162292751239121eb077e53a4520b676d0ad47107a65fa34')throw Error('FROZEN_MANIFEST_MISMATCH');
const m=JSON.parse(raw);
if(sha(fs.readFileSync('vercel.json'))!==m.deploymentConfigSha256)throw Error('CONFIG_MISMATCH');
const actual=[];function walk(d){for(const n of fs.readdirSync(d).sort()){const p=path.join(d,n),s=fs.lstatSync(p);if(s.isSymbolicLink())throw Error('SYMLINK');if(s.isDirectory())walk(p);else if(s.isFile())actual.push(path.relative('dist',p).split(path.sep).join('/'));else throw Error('SPECIAL_FILE');}}walk('dist');
if(actual.length!==m.files.length||actual.some((p,i)=>p!==m.files[i].path))throw Error('OUTPUT_SET_MISMATCH');
for(const f of m.files){const b=fs.readFileSync('dist/'+f.path);if(b.length!==f.bytes||sha(b)!==f.sha256)throw Error('BYTES_MISMATCH:'+f.path);}
console.log('EXACT_SOCIAL_OUTPUT_PASS',m.files.length,process.version,m.webSource,m.deploymentConfigSha256);
