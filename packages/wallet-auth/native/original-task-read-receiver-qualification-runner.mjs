// PRIVATE fixed Root-selected receiver-purpose runner. Pure DATA output, not a
// Source/Root/permission. Go mints its private permit only after actual held
// Source/originals/code/current/OS identity pre/post AND. No provider from stdin.
import{canonical,sha}from'./original-auth-identity-source-verifier.mjs';
import{dispatchOriginalSourceV2}from'./original-auth-source-v2-dispatch.mjs';
import{TASK_READ_RECEIVER_SOURCE_PURPOSE as PURPOSE,projectOriginalTaskReadReceiverRegistrationV1DATA}from'./original-task-read-receiver-source-contract.mjs';
const reject=()=>{throw Error('TASK_READ_RECEIVER_QUALIFICATION_REJECTED')};
const exact=(x,keys)=>{if(!x||Object.getPrototypeOf(x)!==Object.prototype||Object.keys(x).length!==keys.length||keys.some(k=>!Object.hasOwn(x,k)))reject()};
// Optional concrete getters exist only as a PUBLIC test seam in this private
// module. The actual stdin entry passes neither and accepts no function/path.
export async function qualifyOriginalTaskReadReceiverDATA(input,get,getCurrent){
 exact(input,['source','taskSource','receiverRegistrationOriginal']);const t=input.taskSource;exact(t,['rootIdentity','subjectOwner','authority','realm','tenant','version','projectionOriginalB64','observedMS','expiresMS']);
 if(input.source?.policy?.signatureContract?.purpose!==PURPOSE||Buffer.byteLength(canonical(input.source))>2097152)reject();
 if(typeof t.projectionOriginalB64!=='string'||t.projectionOriginalB64.length>1398104||!/^[A-Za-z0-9_-]+$/.test(t.projectionOriginalB64))reject();const original=Buffer.from(t.projectionOriginalB64,'base64url');if(original.length<1||original.length>1048576||original.toString('base64url')!==t.projectionOriginalB64)reject();
 if(typeof input.receiverRegistrationOriginal!=='string'||Buffer.byteLength(input.receiverRegistrationOriginal)>65536)reject();const receiver=projectOriginalTaskReadReceiverRegistrationV1DATA(JSON.parse(input.receiverRegistrationOriginal)),result=await dispatchOriginalSourceV2(input.source,get,getCurrent),p=result.projection,s=p.selection.taskReadReceiverV1;
 if(p.historical===true||p.dataOnly!==true||p.nativeAdmission!==false||p.status!=='active'||!s||canonical(p.rootIdentityDATA)!==canonical(t.rootIdentity)||s.subjectOwner!==t.subjectOwner||s.authority!==t.authority||s.realm!==t.realm||s.tenant!==t.tenant||canonical(s.sourceVersion)!==canonical(t.version)||s.sourceProjection.bytes!==original.length||s.sourceProjection.sha256!==sha(original))reject();
 if(!/^[1-9][0-9]{0,15}$/.test(t.observedMS)||!/^[1-9][0-9]{0,15}$/.test(t.expiresMS)||BigInt(t.expiresMS)<=BigInt(t.observedMS)||BigInt(s.issuedMS)<BigInt(t.observedMS)||BigInt(s.expiresMS)>BigInt(t.expiresMS)||Date.now()<Number(t.observedMS)||Date.now()>=Number(t.expiresMS))reject();
 const actual={};for(const k of Object.keys(receiver))actual[k]=s[k];if(canonical(actual)!==canonical(receiver))reject();
 return Object.freeze({projection:p,currentRaw:result.currentRaw,scopeOriginal:canonical(s),scopeHead:sha(canonical(s)),effectExpiresAtMs:Math.min(p.expiresAtMs,Number(s.expiresMS),Number(t.expiresMS)),dataOnly:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false,listenCapability:false});
}
async function stdin(){try{if(process.argv.length!==2)reject();let n=0,parts=[];for await(const b of process.stdin){n+=b.length;if(n>4194304)reject();parts.push(b)}const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)),input=JSON.parse(raw);if(canonical(input)!==raw)reject();const out=Buffer.from(canonical(await qualifyOriginalTaskReadReceiverDATA(input)));if(out.length>1048576)reject();await new Promise((yes,no)=>process.stdout.write(out,e=>e?no(e):yes()))}catch(error){const code=typeof error?.message==='string'&&/^[A-Z0-9_: -]{1,200}$/.test(error.message)?error.message:'UNCLASSIFIED';process.stderr.write('TASK_READ_RECEIVER_QUALIFICATION_REJECTED:'+code+'\n');process.exitCode=65}}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)await stdin();
