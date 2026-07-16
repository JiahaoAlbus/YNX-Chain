import { WalletAuthError } from "./canonical.js";

const ALPHABET="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function encodeBase64url(bytes){
  if(!(bytes instanceof Uint8Array))throw new WalletAuthError("INVALID_ENCODING","Base64url input must be bytes");
  let output="";
  for(let index=0;index<bytes.length;index+=3){
    const a=bytes[index]??0,b=bytes[index+1]??0,c=bytes[index+2]??0;
    const value=(a<<16)|(b<<8)|c;
    output+=ALPHABET[(value>>>18)&63]+ALPHABET[(value>>>12)&63]+(index+1<bytes.length?ALPHABET[(value>>>6)&63]:"=")+(index+2<bytes.length?ALPHABET[value&63]:"=");
  }
  return output.replace(/=+$/g,"").replace(/\+/g,"-").replace(/\//g,"_");
}

export function decodeBase64url(value,label="base64url value"){
  if(typeof value!=="string"||!/[A-Za-z0-9_-]/.test(value)||!/^[A-Za-z0-9_-]+$/.test(value)||value.length%4===1)throw new WalletAuthError("INVALID_ENCODING",`${label} is invalid`);
  const normalized=value.replace(/-/g,"+").replace(/_/g,"/");
  const padded=normalized+"=".repeat((4-normalized.length%4)%4);
  const output=[];
  for(let index=0;index<padded.length;index+=4){
    const chars=[padded[index],padded[index+1],padded[index+2],padded[index+3]];
    const values=chars.map((character)=>character==="="?0:ALPHABET.indexOf(character));
    if(values.some((item)=>item<0))throw new WalletAuthError("INVALID_ENCODING",`${label} is invalid`);
    const combined=(values[0]<<18)|(values[1]<<12)|(values[2]<<6)|values[3];
    output.push((combined>>>16)&255);
    if(chars[2]!=="=")output.push((combined>>>8)&255);
    if(chars[3]!=="=")output.push(combined&255);
  }
  return Uint8Array.from(output);
}
