import {constants,lstatSync,readdirSync,readFileSync,readSync,openSync,closeSync,fstatSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const sha=value=>createHash('sha256').update(value).digest('hex');
const manifestSHA256='e42daa8f10986ec9876f5fdbcb8a7ac7e9276019e6f3f1fda26a9f71846dc882';
function inputs(){
 const raw=readFileSync(new URL('./original-cloud-sdk-inputs.json',import.meta.url));
 if(sha(raw)!==manifestSHA256)throw Error('Original Cloud SDK source manifest differs.');
 return JSON.parse(raw);
}
function directory(path){const stat=lstatSync(path);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Regular original Cloud SDK directory required.');}
function capture(root){
 const record=inputs();directory(root);
 if(JSON.stringify(readdirSync(root).sort())!==JSON.stringify(record.files.map(row=>row.path).sort()))throw Error('Complete original Cloud SDK inventory differs.');
 const captured=[];
 for(const row of record.files){
  const path=join(root,row.path),fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
   const before=fstatSync(fd);if(!before.isFile()||(before.mode&0o777)!==row.mode||before.size!==row.bytes||before.size>1024*1024)throw Error('Original Cloud SDK source leaf differs.');
   const buffer=Buffer.alloc(row.bytes+1);let length=0;
   while(length<buffer.length){const count=readSync(fd,buffer,length,buffer.length-length,null);if(!count)break;length+=count;}
   const bytes=buffer.subarray(0,length),after=fstatSync(fd),named=lstatSync(path);
   if(!named.isFile()||named.isSymbolicLink()||before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||named.dev!==after.dev||named.ino!==after.ino||named.size!==after.size||named.mtimeMs!==after.mtimeMs||named.ctimeMs!==after.ctimeMs||bytes.length!==row.bytes||sha(bytes)!==row.sha256)throw Error('Original Cloud SDK source leaf differs.');
   captured.push({row,bytes});
  }finally{closeSync(fd);}
 }
 return {record,captured};
}
function destination(codeRoot,create=false){
 if(typeof codeRoot!=='string'||resolve(codeRoot)!==codeRoot||!codeRoot.endsWith('/Contents/Resources/code'))throw Error('Exact packaged code root required for original Cloud SDK.');
 directory(codeRoot);let root=codeRoot;
 for(const part of ['apps','cloud']){root=join(root,part);if(create&&!existsSync(root))mkdirSync(root);directory(root);}
 return join(root,'sdk');
}
function receipt(record){return Object.freeze({schema:'YNX_IDE_ORIGINAL_CLOUD_SDK_DISTRIBUTION_V1',sourceCommit:record.commit,sourceTree:record.tree,sourceRoleTree:record.roleTree,sourceRole:record.sourceRole,destination:record.destination,packageName:record.packageName,version:record.version,files:record.files,sourceManifestSHA256:manifestSHA256,sourceOnly:true,SourceGranted:false,approvalCurrent:false,deploymentQualified:false});}
export function copyOriginalCloudSDK(sourceRoot,codeRoot){
 const {record,captured}=capture(sourceRoot),target=destination(codeRoot,true);
 mkdirSync(target); // Never merge a prior or partial candidate.
 for(const {row,bytes} of captured)writeFileSync(join(target,row.path),bytes,{flag:'wx',mode:row.mode});
 capture(target);return receipt(record);
}
export function verifyOriginalCloudSDK(codeRoot){return receipt(capture(destination(codeRoot)).record);}
export function addOriginalCloudSDKComponent(components,resources){
 const codeRoot=join(resources,'code'),sdk=join(codeRoot,'apps/cloud/sdk');
 if(!existsSync(sdk))return; // General SBOM fixtures need not select this role.
 const record=verifyOriginalCloudSDK(codeRoot),purl=`pkg:npm/%40ynx/cloud-client@${record.version}`;
 if(components.some(row=>row['bom-ref']===purl))throw Error('Duplicate original Cloud SDK SBOM role.');
 components.push({type:'library','bom-ref':purl,name:record.packageName,version:record.version,purl,scope:'required',properties:[{name:'ynx:sourceCommit',value:record.sourceCommit},{name:'ynx:sourceRoleTree',value:record.sourceRoleTree},{name:'ynx:sourceManifestSha256',value:record.sourceManifestSHA256}]});
}
export function sealOriginalCloudSDK(resources){
 const record=verifyOriginalCloudSDK(join(resources,'code')),path=join(resources,'build-provenance.json'),provenance=JSON.parse(readFileSync(path,'utf8'));
 provenance.originalCloudSDKDistribution=record;writeFileSync(path,JSON.stringify(provenance,null,2)+'\n');return record;
}
export function verifyOriginalCloudSDKDistribution(resources){
 const expected=verifyOriginalCloudSDK(join(resources,'code')),provenance=JSON.parse(readFileSync(join(resources,'build-provenance.json'),'utf8'));
 if(JSON.stringify(provenance.originalCloudSDKDistribution)!==JSON.stringify(expected))throw Error('Original Cloud SDK distribution provenance differs.');
 return expected;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [action,...args]=process.argv.slice(2);let result;
 if(action==='--copy')result=copyOriginalCloudSDK(args[0],args[1]);
 else if(action==='--verify')result=verifyOriginalCloudSDKDistribution(dirname(args[0]));
 else if(action==='--seal')result=sealOriginalCloudSDK(args[0]);
 else throw Error('Use --copy, --verify or --seal for the original Cloud SDK source role.');
 console.log(JSON.stringify(result));
}
