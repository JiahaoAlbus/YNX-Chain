import {createOriginalIDEHeldRead} from '../src/original-held-session-read.mjs';
const read=createOriginalIDEHeldRead();
const proof=await read.createBusinessProof({method:'GET',path:'/original',body:'',requiredScopes:['original.read']});
const verified:true=proof.signatureVerified;
const noRoot:false=read.status().RootAdmission;
const close:Promise<void>=read.close();
void [verified,noRoot,close];
// @ts-expect-error writes cannot enter the existing-read caller
read.createBusinessProof({method:'POST',path:'/original',body:'',requiredScopes:[]});
// @ts-expect-error provider/session/Source injection is not a production API
createOriginalIDEHeldRead({source:{},session:{}});
// @ts-expect-error callers do not provide a second AbortContext
read.createBusinessProof({method:'GET',path:'/original',body:'',requiredScopes:[]},{signal:new AbortController().signal});
// @ts-expect-error a read owner cannot create a connected state
const connected:true=read.status().connected;
void connected;
