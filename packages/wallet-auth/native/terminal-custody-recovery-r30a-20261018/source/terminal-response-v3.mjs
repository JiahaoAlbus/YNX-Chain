// Pure bounded encoding only. No filesystem, signing, Source admission or grant.
// The sole SDK owning journal must supply originals from its actual Native loan.
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {canonicalJSON,WalletAuthError} from '@ynx-chain/wallet-auth';
const fail=code=>{throw new WalletAuthError(code,code);};
const sha=x=>createHash('sha256').update(x).digest('hex');
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function fields(x,keys){
 if(!x||types.isProxy(x)||Object.getPrototypeOf(x)!==Object.prototype)fail('TERMINAL_CUSTODY_SHAPE');
 const ds=Object.getOwnPropertyDescriptors(x);if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!ds[k]?.enumerable||!Object.hasOwn(ds[k],'value')))fail('TERMINAL_CUSTODY_SHAPE');
}
function parse(raw,max){if(typeof raw!=='string'||!raw.length||Buffer.byteLength(raw)>max)fail('TERMINAL_CUSTODY_CAPACITY');let v;try{v=JSON.parse(raw);}catch{fail('TERMINAL_CUSTODY_SHAPE');}if(canonicalJSON(v)!==raw)fail('TERMINAL_CUSTODY_CANONICAL');return v;}
export function prepareOriginalPrivateTerminalV3(config){
 fields(config,['enteredRaw','inputRaw','associationRaw','responseRaw','stateAfterDigest']);
 const {enteredRaw,inputRaw,associationRaw,responseRaw,stateAfterDigest}=config;
 const entered=parse(enteredRaw,8192),input=parse(inputRaw,262144),association=parse(associationRaw,8192),response=parse(responseRaw,65536);
 fields(entered,['version','kind','requestDigest','associationDigest','operation','phase','requestId','stateBeforeDigest']);
 fields(input,['requestId','operation','phase','body','proofHeader','carrierVersion','referenceAction']);
 fields(association,['account','clientId','productId','platform','applicationId','deviceId']);
 if(Object.values(association).some(x=>typeof x!=='string'||!x||Buffer.byteLength(x)>512)||input.carrierVersion!=='YNX-PRODUCT-SESSION-PRIVATE/v4'||input.operation!=='handleReturn'||input.phase!=='effect'||input.referenceAction!=='complete'||input.proofHeader!==null||typeof input.requestId!=='string'||!/^req_[A-Za-z0-9_-]{12,80}$/.test(input.requestId)||input.requestId.includes('\n'))fail('TERMINAL_CUSTODY_INPUT');
 if(entered.version!==1||entered.kind!=='entered'||entered.requestDigest!==sha(inputRaw)||entered.associationDigest!==sha(associationRaw)||entered.operation!==input.operation||entered.phase!==input.phase||entered.requestId!==input.requestId||!hex(entered.stateBeforeDigest)||!hex(stateAfterDigest))fail('TERMINAL_CUSTODY_BINDING');
 fields(response,['status','headers','body']);
 if(!Number.isInteger(response.status)||response.status<200||response.status>599||typeof response.body!=='string')fail('TERMINAL_CUSTODY_RESPONSE');
 const headers=response.headers;if(!headers||Object.getPrototypeOf(headers)!==Object.prototype||Object.keys(headers).length>32||Object.entries(headers).some(([k,v])=>!/^[a-z0-9-]+$/.test(k)||typeof v!=='string'||Buffer.byteLength(v)>16384)||headers['x-request-id']!==input.requestId||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(headers['content-type']??'')||!/(^|,)\s*no-store\s*(,|$)/i.test(headers['cache-control']??''))fail('TERMINAL_CUSTODY_RESPONSE');
 if(Object.hasOwn(headers,'content-length')&&headers['content-length']!==String(Buffer.byteLength(response.body)))fail('TERMINAL_CUSTODY_RESPONSE');
 const payload=parse(response.body,65536),success=response.status<300;fields(payload,success?['ok','requestId','result','schemaVersion']:['ok','requestId','error','schemaVersion']);
 if(payload.ok!==success||payload.requestId!==input.requestId||payload.schemaVersion!==2)fail('TERMINAL_CUSTODY_RESPONSE');
 if(success){if(!payload.result||Object.keys(association).some(k=>payload.result[k]!==association[k]))fail('TERMINAL_CUSTODY_ASSOCIATION');}
 else{fields(payload.error,['code','message']);if(typeof payload.error.code!=='string'||! /^[A-Z][A-Z0-9_]{2,63}$/.test(payload.error.code)||typeof payload.error.message!=='string'||payload.error.message.length>300)fail('TERMINAL_CUSTODY_RESPONSE');}
 // All derived operands remain checked above; e commits the WHOLE entered original.
 const terminal={v:3,k:'terminal',e:sha(enteredRaw),s:stateAfterDigest,x:responseRaw};
 const raw=canonicalJSON(terminal);if(Buffer.byteLength(raw)>8192)fail('TERMINAL_CUSTODY_CAPACITY');
 return Object.freeze({raw,bytes:Buffer.byteLength(raw),sha256:sha(raw),responseDigest:sha(responseRaw)});
}
