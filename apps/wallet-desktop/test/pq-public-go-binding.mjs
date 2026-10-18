// QA transport only, not a policy authority or signature verifier. The caller
// supplies its original parent-retained State BEFORE starting the fresh process.
// No certificate, restored result, credential or private key is an input.
export function encodePublicGoRestoreBinding({state,owner,executionHeight,nativeChainId}){
 const fail=()=>{throw Error('QA_ORIGINAL_PUBLIC_BINDING_REQUIRED');};
 if(!(state instanceof Uint8Array)||!state.length||state.length>256*1024||!/^0x[0-9a-f]{40}$/.test(owner))fail();
 for(const value of [executionHeight,nativeChainId])if(typeof value!=='string'||!/^[1-9][0-9]*$/.test(value)||BigInt(value)>18446744073709551615n)fail();
 let policy;try{policy=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(state));}catch{fail();}
 if(!policy||!['YNX-ACCOUNT-POLICY/v1','YNX-ACCOUNT-POLICY/v2'].includes(policy.version)||!Array.isArray(policy.records)||!policy.records.some(row=>row.owner===owner))fail();
 return Buffer.from(JSON.stringify({version:'ynx-wallet-restore-interop-v1',owner,executionHeight,nativeChainId,policy},null,2)+'\n');
}
