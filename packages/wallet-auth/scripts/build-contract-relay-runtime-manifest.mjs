import fs from 'node:fs';import crypto from 'node:crypto';import path from 'node:path';
const root=import.meta.dirname,sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const [H,expectedBytes,expectedSHA]=process.argv.slice(2);
if(!path.isAbsolute(H??'')||!/^\d+$/.test(expectedBytes??'')||!/^[a-f0-9]{64}$/.test(expectedSHA??''))throw Error('exact canonical handoff path/bytes/SHA required');
const raw=fs.readFileSync(H);if(raw.length!==Number(expectedBytes)||sha(raw)!==expectedSHA)throw Error('canonical handoff differs');
const h=JSON.parse(raw),get=suffix=>{const r=h.evidence.find(x=>x.path.endsWith(suffix));if(!r)throw Error('missing original manifest');const b=fs.readFileSync(r.path);if(b.length!==r.bytes||sha(b)!==r.sha256)throw Error('normal manifest differs');return{ref:r,body:JSON.parse(b)};};
const a=get('/original-auth-runtime-manifest.json'),w=get('/walletconnect-runtime-manifest.json');
if(a.body.version!=='YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1'||a.body.files.length!==h.runtime.Auth.files||w.body.kind!=='YNX-WALLETCONNECT-PRODUCTION-CLOSURE/v1'||w.body.sdk.version!==h.versionSDK||w.body.files.length!==h.runtime.WalletConnect.files||w.body.packages.length!==h.runtime.WalletConnect.packages||w.body.edges.length!==h.runtime.WalletConnect.edges||a.ref.sha256!==h.runtime.Auth.manifestSHA256)throw Error('normal closure identity differs');
const rows=new Map();let shared=0;
function add(f,bytes){
 if(typeof f.path!=='string'||!f.path||f.path.startsWith('/')||f.path.includes('\\')||f.path.split('/').some(x=>!x||x==='.'||x==='..')||!/^[\x20-\x7e]+$/.test(f.path)||f.path==='native/original-ide-contract-relay-runtime-manifest.json'||!Number.isSafeInteger(bytes)||bytes<0||bytes>16777216||!/^[a-f0-9]{64}$/.test(f.sha256)||(bytes===0&&f.sha256!=='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'))throw Error('normal file entry differs');
 const row={bytes,path:f.path,sha256:f.sha256},old=rows.get(f.path);if(old){if(old.bytes!==row.bytes||old.sha256!==row.sha256)throw Error('normal closures conflict');shared++;}else rows.set(f.path,row);
}
for(const f of a.body.files)add(f,f.bytes);for(const f of w.body.files)add(f,f.size);
const files=[...rows.values()].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
if(files.length!==a.body.files.length+w.body.files.length-shared)throw Error('union coverage differs');
const executor=rows.get('src/walletconnect-contract-initiator-boundary.js');if(!executor)throw Error('initiator executor absent');
// Same already-established Native closure schema/canonical encoding; not a
// new proof, privilege ABI, standalone graph or a registration certificate.
const body=Buffer.from(JSON.stringify({files,version:'YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1'}));
const out=fs.mkdtempSync(path.join(root,'evidence/manifest-')),manifest=path.join(out,'original-ide-contract-relay-runtime-manifest.json');
fs.writeFileSync(manifest,body,{flag:'wx',mode:0o600});
const result={normalSDK:{handoff:H,bytes:raw.length,sha256:sha(raw),commit:h.commit},parents:[a.ref,w.ref],manifest:{path:manifest,bytes:body.length,sha256:sha(body)},fileCount:files.length,sharedIdentical:shared,totalBytes:files.reduce((n,f)=>n+f.bytes,0),executor,installedSourceRoot:null,NativeAdmission:false,platformQualified:false,network:false,normalSuccessorWillRequireRegeneration:true};
fs.writeFileSync(path.join(out,'UNION.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result));
