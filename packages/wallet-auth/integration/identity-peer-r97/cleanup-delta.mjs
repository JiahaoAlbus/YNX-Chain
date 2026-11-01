import assert from 'node:assert/strict';
export async function runCleanupDelta({OriginalIdentityPeerCall:Runtime}){
 let cases=0;
 for(const thrown of [undefined,null,false,0,'']){
  let peerRetired=0,callRetired=0,peerClosed=0,callClosed=0;
  const peer={retire(){peerRetired++;throw thrown;},join(){},close(){peerClosed++;}};
  const call={retire(){callRetired++;throw Error('later error must not replace first');},join(){},close(){callClosed++;}};
  const runtime=new Runtime(call,peer);let caught=false;
  try{runtime.retire();}catch(error){caught=true;assert.equal(error,thrown);}
  assert(caught);assert.equal(runtime.outcome().firstCausePresent,true);assert.equal(runtime.outcome().firstCause,thrown);
  await runtime.close();assert.equal(peerRetired,1);assert.equal(callRetired,1);assert.equal(peerClosed,1);assert.equal(callClosed,1);cases++;
 }
 let closed=0,joined=0;
 const first=Error('PUBLIC first close failure');
 const runtime=new Runtime({retire(){},join(){joined++;},close(){closed++;throw first;}},{retire(){},join(){joined++;},close(){closed++;}});
 const a=runtime.close(),b=runtime.close();assert.equal(a,b);
 await assert.rejects(a,error=>error===first);await assert.rejects(runtime.close(),error=>error===first);
 assert.equal(closed,2);assert.equal(joined,2);assert.equal(runtime.outcome().cleanupCause,first);cases++;
 return {newCases:cases,actualRuntime:true,actualNative:false,grant:false};
}
