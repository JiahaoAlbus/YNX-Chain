import { nativeBindingAdapter } from './bindingNativeAdapter';
/** Actual normal service metadata contract. This is not device/history authority. */
export const accountBindingEndpoint = 'https://social.ynxweb4.com/v4/account-binding';
export const socialOfficialOrigin = 'https://social.ynxweb4.com';
export const accountBindingInput = Object.freeze({ status: 'UNAVAILABLE_AUTH_PRODUCER' as const, deployment: 'NOT_DEPLOYED' as const, nativeTransport: 'NORMAL_NATIVE_ADAPTER_MATCHED_NOT_ADMITTED_RUNTIME_CALLBACK_NOT_VERIFIED' as const, missingCallsite: 'VeilSocialApp -> approved new-path auth callback -> requestAccountBinding' });
export type AccountBindingMetadata = Readonly<{status:'ACCOUNT_BOUND';subject:string;generation:number;deviceAuthorization:'REQUIRED'}>;
export type AccountBindingResult = Readonly<{kind:'metadata';metadata:AccountBindingMetadata}> | Readonly<{kind:'unavailable';reason:'INVALID_INPUT'|'ORIGIN_NOT_ALLOWED'|'TIMEOUT'|'TRANSPORT_UNAVAILABLE'|'HTTP_NOT_VERIFIED'|'INVALID_RESPONSE'}>;
function invalid():never{throw Error('VEIL_ACCOUNT_BINDING_INVALID');}
export function decodeAccountBinding(raw:unknown):AccountBindingMetadata {
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||![null,Object.prototype].includes(Object.getPrototypeOf(raw)))return invalid();
  const d=Object.getOwnPropertyDescriptors(raw),keys=Reflect.ownKeys(d);
  if(keys.length!==4||keys.some(k=>typeof k!=='string'||!['status','subject','generation','deviceAuthorization'].includes(k)))return invalid();
  for(const k of keys){if(typeof k!=='string')return invalid();const descriptor=d[k];if(!descriptor||!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))return invalid();}
  const status=d.status?.value,subject=d.subject?.value,generation=d.generation?.value,deviceAuthorization=d.deviceAuthorization?.value;
  if(status!=='ACCOUNT_BOUND'||deviceAuthorization!=='REQUIRED'||typeof subject!=='string'||!subject.trim()||subject.length>1024||/[\u0000-\u001f\u007f]/.test(subject)||!Number.isSafeInteger(generation)||generation<0)return invalid();
  for(let i=0;i<subject.length;i++){const c=subject.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const n=subject.charCodeAt(++i);if(!(n>=0xdc00&&n<=0xdfff))return invalid();}else if(c>=0xdc00&&c<=0xdfff)return invalid();}
  return Object.freeze({status,subject,generation,deviceAuthorization});
}
/** Flat exact JSON parser rejects duplicate names before JSON.parse loses them. */
export function decodeAccountBindingText(text:string):AccountBindingMetadata {
  if(typeof text!=='string'||text.length>8192||new TextEncoder().encode(text).length>8192)return invalid();
  const begin=/^[ \t\r\n]*\{/.exec(text);if(!begin)return invalid();let offset=begin[0].length;
  const pair=/[ \t\r\n]*("(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*")[ \t\r\n]*:[ \t\r\n]*("(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)[ \t\r\n]*([,}])/y;
  const value:Record<string,unknown>=Object.create(null);
  while(true){pair.lastIndex=offset;const match=pair.exec(text);if(!match)return invalid();const keyText=match[1],valueText=match[2],delimiter=match[3];if(typeof keyText!=='string'||typeof valueText!=='string'||(delimiter!==','&&delimiter!=='}'))return invalid();const key:unknown=JSON.parse(keyText);if(typeof key!=='string'||Object.hasOwn(value,key))return invalid();value[key]=JSON.parse(valueText);offset=pair.lastIndex;if(delimiter==='}')break;}
  if(!/^[ \t\r\n]*$/.test(text.slice(offset)))return invalid();return decodeAccountBinding(value);
}
/** Dormant until the approved new auth callback exists. No token UI/storage. */
export function requestAccountBinding(grantToken:string):Promise<AccountBindingResult>{
  // Native MIME/callback lifetime source repairs were independently reviewed.
  // Real runtime/callback qualification remains unverified; keep requests refused.
  grantToken='';
  return Promise.resolve(Object.freeze({kind:'unavailable',reason:'TRANSPORT_UNAVAILABLE'}));
}
