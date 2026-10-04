'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const raw=fs.readFileSync('build-manifest.json');
if(sha(raw)!=='7b69b496454d712d162292751239121eb077e53a4520b676d0ad47107a65fa34')throw Error('FROZEN_MANIFEST_MISMATCH');
const m=JSON.parse(raw);
const sourceConfig=fs.readFileSync('vercel-source.json');
if(sha(sourceConfig)!==m.deploymentConfigSha256)throw Error('SOURCE_CONFIG_MISMATCH');
const expectedConfig=JSON.parse(sourceConfig),runtimeConfig=JSON.parse(fs.readFileSync('vercel.json'));
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
for(const key of ['version','framework','installCommand','buildCommand','outputDirectory','rewrites','headers'])if(JSON.stringify(canonical(runtimeConfig[key]))!==JSON.stringify(canonical(expectedConfig[key])))throw Error('RUNTIME_CONFIG_SEMANTICS_MISMATCH:'+key);
for(const key of ['routes','redirects','cleanUrls','trailingSlash','builds','functions','crons','env'])if(Object.hasOwn(runtimeConfig,key)&&!Object.hasOwn(expectedConfig,key))throw Error('UNEXPECTED_RUNTIME_CONFIG:'+key);

const actual=[];function walk(d){for(const n of fs.readdirSync(d).sort()){const p=path.join(d,n),s=fs.lstatSync(p);if(s.isSymbolicLink())throw Error('SYMLINK');if(s.isDirectory())walk(p);else if(s.isFile())actual.push(path.relative('dist',p).split(path.sep).join('/'));else throw Error('SPECIAL_FILE');}}walk('dist');
if(actual.length!==m.files.length||actual.some((p,i)=>p!==m.files[i].path))throw Error('OUTPUT_SET_MISMATCH');
for(const f of m.files){const b=fs.readFileSync('dist/'+f.path);if(b.length!==f.bytes||sha(b)!==f.sha256)throw Error('BYTES_MISMATCH:'+f.path);}
console.log('EXACT_SOCIAL_OUTPUT_PASS',m.files.length,process.version,m.webSource,m.deploymentConfigSha256);
