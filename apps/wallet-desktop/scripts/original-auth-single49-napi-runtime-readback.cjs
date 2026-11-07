// Original A post-link actual-runtime load only. No Source acquisition/account IO.
const fs=require('node:fs'),crypto=require('node:crypto');
if(process.argv.length!==4)throw Error('NAPI_RUNTIME_EXACT_ARGS');
const [image,kind]=process.argv.slice(2),v=process.versions;
if(kind==='node24'){if(v.node!=='24.19.0'||v.modules!=='137'||v.napi!=='10'||v.electron)throw Error('NAPI_NODE24_RUNTIME_REQUIRED');}
else if(kind==='electron42'){if(v.electron!=='42.10.0'||v.node!=='24.18.1'||v.modules!=='146'||v.napi!=='10')throw Error('NAPI_ELECTRON42_RUNTIME_REQUIRED');}
else throw Error('NAPI_RUNTIME_KIND');
const pin=()=>{const s=fs.lstatSync(image);if(!s.isFile()||s.isSymbolicLink())throw Error('NAPI_IMAGE_NOT_REGULAR');const b=fs.readFileSync(image);return{bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')};};
const before=pin(),native=require(image);for(const n of ['acquireOriginalAITaskActionClientV6Source','acquireOriginalProductSessionDeviceV4ManagementSource'])if(typeof native[n]!=='function')throw Error('NAPI_ORIGINAL_EXPORT_MISSING:'+n);
if(JSON.stringify(before)!==JSON.stringify(pin()))throw Error('NAPI_IMAGE_CHANGED_DURING_LOAD');
console.log(JSON.stringify({kind,versions:{node:v.node,electron:v.electron??null,modules:v.modules,napi:v.napi},image:before,actualImageLoaded:true,SourceAcquired:false,RootAdmission:false,SourceAdmission:false,installed:false}));
