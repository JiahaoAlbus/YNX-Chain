import {
  createEvmProductLoginChallenge,
  createEvmProductLoginSigningRequest,
  verifyEvmProductLoginProof,
} from '@ynx-chain/wallet-auth';

const MAX_INPUT_BYTES=32*1024;

async function readInput(){
  const chunks=[];let bytes=0;
  for await(const chunk of process.stdin){
    bytes+=chunk.length;
    if(bytes>MAX_INPUT_BYTES)throw new Error('INVALID_INPUT');
    chunks.push(chunk);
  }
  if(bytes===0)throw new Error('INVALID_INPUT');
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

try{
  const input=await readInput();
  if(input?.action==='create'){
    const challenge=createEvmProductLoginChallenge(input.challenge);
    const signingRequest=createEvmProductLoginSigningRequest(challenge);
    process.stdout.write(JSON.stringify({challenge,signingRequest})+'\n');
  }else if(input?.action==='verify'){
    const verified=await verifyEvmProductLoginProof(input.proof,{
      challenge:input.expectedChallenge,
      clockSkewMs:0,
      verifyContractSignature:null,
    },new Date(input.at));
    process.stdout.write(JSON.stringify({verified:{
      account:verified.account,accountType:verified.accountType,chainId:verified.chainId,
      productId:verified.productId,scopes:verified.scopes,providerKind:verified.providerKind,
      nonce:verified.nonce,requestId:verified.requestId,
    }})+'\n');
  }else throw new Error('INVALID_ACTION');
}catch(error){
  // Never echo a challenge, signature, request body, or environment value.
  process.stdout.write(JSON.stringify({error:{code:error?.code||'INVALID_INPUT'}})+'\n');
  process.exitCode=1;
}
