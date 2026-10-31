// A binding of actual bytes only. No expected digest, signer, permission,
// service identity or content trust can be supplied to this function.
import{sha3_512}from'@noble/hashes/sha3.js';
import{sha512}from'@noble/hashes/sha2.js';
import{bytesToHex}from'@noble/hashes/utils.js';
const typed=Object.getPrototypeOf(Uint8Array.prototype),getLength=Object.getOwnPropertyDescriptor(typed,'byteLength').get,getBuffer=Object.getOwnPropertyDescriptor(typed,'buffer').get,set=Uint8Array.prototype.set;
const invalid=()=>{throw Object.assign(new Error('Actual unshared content bytes required'),{code:'PUBLIC_CONTENT_BYTES_INVALID'})};
export function bindPublicContentBytes(input){
 let n,b;try{n=getLength.call(input);b=getBuffer.call(input)}catch{invalid()}
 if(!(input instanceof Uint8Array)||!Number.isSafeInteger(n)||n<0||typeof SharedArrayBuffer!=='undefined'&&b instanceof SharedArrayBuffer)invalid();
 const actual=new Uint8Array(n);try{set.call(actual,input)}catch{invalid()}
 return Object.freeze({bytes:BigInt(n).toString(),sha3_512:bytesToHex(sha3_512(actual)),sha512:bytesToHex(sha512(actual))});
}
