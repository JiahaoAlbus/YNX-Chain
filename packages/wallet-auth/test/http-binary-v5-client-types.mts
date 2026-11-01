import{openOriginalHTTPBinaryClientV5}from'../src/original-http-binary-v5-client.js';
const c=await openOriginalHTTPBinaryClientV5();const ctx=Object.freeze({signal:new AbortController().signal});
const p=c.prepareOriginalRequest({requestId:'PUBLIC',expectedSlotRevision:'0',rollbackTarget:'',bodySnapshot:{bodyOriginal:new Uint8Array([255]),contentType:'multipart/form-data; boundary=x'},abortContext:ctx});
const v=await c.produceOriginalProof(p);const no:false=v.SourceAdmission;void no;await c.submitPrepared(p,ctx);await c.close();
// @ts-expect-error no URL/provider injection
openOriginalHTTPBinaryClientV5({url:'https://attacker.invalid'});
// @ts-expect-error ordinary DATA cannot construct private packet
c.readOriginalRequestDATA({});
