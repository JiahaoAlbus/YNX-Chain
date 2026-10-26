// Pure DATA validation for the next independently evidenced deployment.
// This is not an endpoint selector, TLS connection, receipt authenticator or
// Source/POST authority. Do not wire a candidate into NORMAL_OPERATOR here.
const fail=code=>{throw Object.assign(Error(code),{code});};
const hex=(s,n)=>typeof s==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(s);
function binding(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join('|')!=='chainId|genesisHash|origin|reportedCommit|reportedRelease|spkiSha256')fail('OPERATOR_DEPLOYMENT_BINDING_INVALID');
 let origin;try{origin=new URL(input.origin);}catch{fail('OPERATOR_DEPLOYMENT_BINDING_INVALID');}
 if(origin.protocol!=='https:'||origin.origin!==input.origin||origin.username||origin.password||origin.search||origin.hash||input.chainId!==6423||!hex(input.reportedCommit,40)||!hex(input.genesisHash,64)||!hex(input.spkiSha256,64)||typeof input.reportedRelease!=='string'||!/^[A-Za-z0-9._-]{1,160}$/.test(input.reportedRelease))fail('OPERATOR_DEPLOYMENT_BINDING_INVALID');
 return Object.freeze({...input});
}
export function inspectFullOperatorDeploymentIdentity(expected,observed){
 const fixed=binding(expected);
 if(!observed||typeof observed!=='object'||Array.isArray(observed)||Object.keys(observed).sort().join('|')!=='genesis|origin|spkiSha256|status')fail('OPERATOR_DEPLOYMENT_OBSERVATION_INVALID');
 if(observed.origin!==fixed.origin)fail('OPERATOR_DEPLOYMENT_ORIGIN_DIFFERS');
 if(!hex(observed.spkiSha256,64)||observed.spkiSha256!==fixed.spkiSha256)fail('OPERATOR_DEPLOYMENT_SPKI_DIFFERS');
 const status=observed.status;
 if(status?.chainId!==fixed.chainId||status.catchingUp!==false||status.persistence!==true||status.persistenceError!==''||!hex(status.build?.commit,40)||status.build.commit!==fixed.reportedCommit||status.build.release!==fixed.reportedRelease)fail('OPERATOR_DEPLOYMENT_VERSION_OR_HEALTH_DIFFERS');
 if(observed.genesis?.height!==0||observed.genesis.hash!==fixed.genesisHash)fail('OPERATOR_DEPLOYMENT_GENESIS_DIFFERS');
 return Object.freeze({identityMatches:true,reportedCommit:fixed.reportedCommit,liveReadback:false,TLSAuthenticated:false,receiptAuthenticated:false,SourceQualified:false,broadcastAuthorized:false});
}
