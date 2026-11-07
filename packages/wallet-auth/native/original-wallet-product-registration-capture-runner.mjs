// Fixed private WPR NodeHost subprocess. This entry has no public provider,
// source/key/owner/clock selector or alternate dispatch. DATA is not admission.
import {canonical} from './original-auth-identity-source-verifier.mjs';
const INPUT_MAX=2097152,OUTPUT_MAX=33554432,ERROR='WPR_REGISTRATION_CAPTURE_RUNNER_INVALID\n';
const fail=()=>{throw Error('WPR_REGISTRATION_CAPTURE_RUNNER_INVALID')};
let stdoutErrorPresent=false;process.stdout.on('error',()=>{stdoutErrorPresent=true});
function exact(x,keys){if(!x||Object.getPrototypeOf(x)!==Object.prototype||Object.keys(x).length!==keys.length||Object.keys(x).some(k=>!keys.includes(k)))fail()}
function inspect(x){
 exact(x,['operation','node','rootRaw','enrollmentRaw','profileRaw','headRaw','policy','previous']);if(x.operation!=='auth-source-v2-native-node/v1')fail();
 exact(x.node,['origin','spki','nativeChainId']);if(Object.values(x.node).some(v=>typeof v!=='string'||!v||v.length>2048))fail();
 exact(x.policy,['rootDigest','enrollmentDigest','endpoint','spki','signatureContract','applicationId','productId','platform']);
 exact(x.policy.signatureContract,['purpose','enrollmentFrame','profileFrame','currentFrame']);if(x.policy.signatureContract.purpose!=='wallet-native-product-source-v1')fail();
 if(Object.values(x.policy.signatureContract).some(v=>typeof v!=='string'||!v||v.length>512))fail();for(const k of ['rootDigest','enrollmentDigest','endpoint','spki','applicationId','productId','platform'])if(typeof x.policy[k]!=='string'||!x.policy[k]||x.policy[k].length>4096)fail();
 for(const [k,cap] of [['rootRaw',16384],['enrollmentRaw',393216],['profileRaw',393216],['headRaw',393216]])if(typeof x[k]!=='string'||!x[k]||Buffer.byteLength(x[k])>cap)fail();
 exact(x.previous,['sequence','floor','head','timeFloor','executionHeight']);for(const k of ['sequence','floor','timeFloor'])if(!Number.isSafeInteger(x.previous[k])||x.previous[k]<0)fail();if(x.previous.floor>x.previous.sequence||typeof x.previous.head!=='string'||!(x.previous.head===''||/^[0-9a-f]{64}$/.test(x.previous.head))||typeof x.previous.executionHeight!=='string'||!/^(0|[1-9][0-9]*)$/.test(x.previous.executionHeight)||BigInt(x.previous.executionHeight)>0xffffffffffffffffn)fail();return x;
}
// Completion means every write callback completed. A broken pipe may retain
// a physical prefix; Native must reject nonzero exit/truncated output as UNKNOWN.
async function writeOriginal(bytes){if(!(bytes instanceof Uint8Array)||!bytes.byteLength||bytes.byteLength>OUTPUT_MAX)fail();for(let at=0;at<bytes.byteLength;at+=65536){if(stdoutErrorPresent)fail();const chunk=bytes.subarray(at,Math.min(at+65536,bytes.byteLength));await new Promise((resolve,reject)=>{const onError=e=>{process.stdout.off('error',onError);reject(e)};process.stdout.once('error',onError);process.stdout.write(chunk,e=>{process.stdout.off('error',onError);if(e)reject(e);else resolve()})});if(stdoutErrorPresent)fail()}}
try{
 if(process.argv.length!==2)fail();let total=0;const parts=[];for await(const chunk of process.stdin){total+=chunk.length;if(total>INPUT_MAX)fail();parts.push(chunk)}
 const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.concat(parts)),input=JSON.parse(text);if(canonical(input)!==text)fail();inspect(input);
 const {captureOriginalWalletProductSourceV2}=await import('./original-auth-source-v2-dispatch.mjs');
 const {encodeWPRRegistrationCaptureOriginalDATA}=await import('./original-wallet-product-registration-capture.mjs');
 const result=await captureOriginalWalletProductSourceV2(input);const original=encodeWPRRegistrationCaptureOriginalDATA(result);await writeOriginal(original);
}catch{process.exitCode=65;process.stderr.write(ERROR)}
