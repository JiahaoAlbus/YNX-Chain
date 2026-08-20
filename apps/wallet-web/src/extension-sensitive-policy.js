export const SENSITIVE_REPLAY_KEY="ynx.extension.sensitive.replay.v1";
export const SENSITIVE_REPLAY_LIMIT=2048;
export const SENSITIVE_METHODS=Object.freeze(["eth_requestAccounts","wallet_requestPermissions","wallet_revokePermissions","wallet_watchAsset","personal_sign","eth_signTypedData_v4","eth_sendTransaction"]);
const ADDRESS=/^0x[0-9a-fA-F]{40}$/u,SIGNATURE=/^0x[0-9a-fA-F]{130}$/u,HASH=/^0x[0-9a-fA-F]{64}$/u,HEX=/^0x(?:[0-9a-fA-F]{2})*$/u,QUANTITY=/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u,SAFE_TEXT=/^[\x20-\x7e]{1,128}$/u;
function reject(code,message){throw Object.assign(new Error(message),{code})}

export function parseSensitiveRequest(message,now=Date.now()){
  if(!SENSITIVE_METHODS.includes(message?.method))return null;
  if(typeof message.requestId!=="string"||!Number.isSafeInteger(message.deadlineAt)||message.deadlineAt<=now)reject("BRIDGE_EXPIRED","Sensitive wallet request expired.");
  const params=message.params;
  if(message.method==="eth_requestAccounts"){
    if(params!==undefined&&(!Array.isArray(params)||params.length!==0))reject("INVALID_SENSITIVE_PARAMS","eth_requestAccounts accepts no parameters.");
    return Object.freeze({method:message.method,expectedAccount:null});
  }
  if(message.method==="wallet_requestPermissions"||message.method==="wallet_revokePermissions"){
    exactAccountPermission(params,message.method);return Object.freeze({method:message.method,expectedAccount:null});
  }
  if(message.method==="wallet_watchAsset"){
    exactWatchAsset(params);return Object.freeze({method:message.method,expectedAccount:null});
  }
  if(message.method==="personal_sign"){
    if(!Array.isArray(params)||params.length!==2||typeof params[0]!=="string"||!HEX.test(params[0])||params[0].length>8194||!ADDRESS.test(params[1]))reject("INVALID_SENSITIVE_PARAMS","personal_sign parameters are invalid.");
    return Object.freeze({method:message.method,expectedAccount:params[1].toLowerCase()});
  }
  if(message.method==="eth_signTypedData_v4"){
    if(!Array.isArray(params)||params.length!==2||!ADDRESS.test(params[0])||typeof params[1]!=="string"||params[1].length>32768)reject("INVALID_SENSITIVE_PARAMS","eth_signTypedData_v4 parameters are invalid.");
    exactTypedData(params[1]);return Object.freeze({method:message.method,expectedAccount:params[0].toLowerCase()});
  }
  const tx=Array.isArray(params)&&params.length===1?params[0]:null,keys=tx&&typeof tx==="object"&&!Array.isArray(tx)?Object.keys(tx).sort():[];
  if(!tx||keys.join(",")!==["data","from","to","value"].join(",")||!ADDRESS.test(tx.from)||!ADDRESS.test(tx.to)||!QUANTITY.test(tx.value)||!HEX.test(tx.data)||tx.data.length>16386)reject("INVALID_SENSITIVE_PARAMS","eth_sendTransaction parameters are not canonical.");
  return Object.freeze({method:message.method,expectedAccount:tx.from.toLowerCase()});
}

export async function consumeSensitiveRequest(storage,message,now=Date.now()){
  if(!storage||typeof storage.get!=="function"||typeof storage.set!=="function")reject("REPLAY_STORE_UNAVAILABLE","Sensitive request replay storage is unavailable.");
  const stored=await storage.get(SENSITIVE_REPLAY_KEY),raw=stored?.[SENSITIVE_REPLAY_KEY],live=Array.isArray(raw)?raw.filter((item)=>item&&typeof item.requestId==="string"&&Number.isSafeInteger(item.deadlineAt)&&item.deadlineAt>now):[];
  if(live.some((item)=>item.requestId===message.requestId))reject("REQUEST_REPLAYED","Sensitive wallet request was already consumed.");
  if(live.length>=SENSITIVE_REPLAY_LIMIT)reject("REPLAY_CAPACITY","Sensitive request replay storage reached capacity.");
  const next=[...live,{requestId:message.requestId,deadlineAt:message.deadlineAt}].sort((a,b)=>a.requestId.localeCompare(b.requestId));
  await storage.set({[SENSITIVE_REPLAY_KEY]:next});return Object.freeze({requestId:message.requestId,deadlineAt:message.deadlineAt});
}

export function validateSensitiveResult(method,result){
  if(method==="eth_requestAccounts"){
    if(!Array.isArray(result)||result.length<1||result.some((account)=>!ADDRESS.test(account)))reject("INVALID_ACCOUNT","Wallet backend returned invalid accounts.");
    return Object.freeze(result.map((account)=>account.toLowerCase()));
  }
  if(method==="personal_sign"&&!SIGNATURE.test(result||""))reject("INVALID_SIGNATURE","Wallet backend returned an invalid signature.");
  if(method==="eth_signTypedData_v4"&&!SIGNATURE.test(result||""))reject("INVALID_SIGNATURE","Wallet backend returned an invalid typed-data signature.");
  if(method==="eth_sendTransaction"&&!HASH.test(result||""))reject("INVALID_TRANSACTION_HASH","Wallet backend returned an invalid transaction hash.");
  if(method==="wallet_requestPermissions"&&(!Array.isArray(result)||result.some((permission)=>!plain(permission)||permission.parentCapability!=="eth_accounts")))reject("INVALID_PERMISSION_RESULT","Wallet backend returned invalid permissions.");
  if(method==="wallet_revokePermissions"&&result!==null)reject("INVALID_PERMISSION_RESULT","Wallet backend returned an invalid revoke result.");
  if(method==="wallet_watchAsset"&&typeof result!=="boolean")reject("INVALID_WATCH_ASSET_RESULT","Wallet backend returned an invalid asset-watch result.");
  return result;
}

function exactAccountPermission(params,method){
  const value=Array.isArray(params)&&params.length===1&&plain(params[0])?params[0]:null;
  if(!value||Object.keys(value).length!==1||!plain(value.eth_accounts)||Object.keys(value.eth_accounts).length!==0)reject("INVALID_SENSITIVE_PARAMS",`${method} accepts only the exact eth_accounts permission.`);
}
function exactWatchAsset(params){
  const request=Array.isArray(params)&&params.length===1&&plain(params[0])?params[0]:null,options=request&&plain(request.options)?request.options:null;
  if(!request||Object.keys(request).sort().join(",")!=="options,type"||request.type!=="ERC20"||!options)reject("INVALID_SENSITIVE_PARAMS","wallet_watchAsset requires one ERC20 asset request.");
  if(!["address","decimals","image","symbol"].includes(Object.keys(options)[0])&&Object.keys(options).length===0)reject("INVALID_SENSITIVE_PARAMS","wallet_watchAsset options are invalid.");
  if(Object.keys(options).some((key)=>!["address","symbol","decimals","image"].includes(key))||!ADDRESS.test(options.address)||typeof options.symbol!=="string"||!SAFE_TEXT.test(options.symbol)||options.symbol.length>11||(options.decimals!==undefined&&(!Number.isInteger(options.decimals)||options.decimals<0||options.decimals>255)))reject("INVALID_SENSITIVE_PARAMS","wallet_watchAsset ERC20 options are invalid.");
  if(options.image!==undefined){try{const image=new URL(options.image);if(image.protocol!=="https:"||image.username||image.password||image.search||image.hash)throw new Error();}catch{reject("INVALID_SENSITIVE_PARAMS","wallet_watchAsset image must be a clean HTTPS URL.")}}
}
function exactTypedData(serialized){
  let value;try{value=JSON.parse(serialized)}catch{reject("INVALID_SENSITIVE_PARAMS","eth_signTypedData_v4 must contain JSON.")}
  if(!plain(value)||Object.keys(value).sort().join(",")!=="domain,message,primaryType,types"||!plain(value.types)||!plain(value.domain)||!plain(value.message)||typeof value.primaryType!=="string"||!SAFE_TEXT.test(value.primaryType)||!Object.prototype.hasOwnProperty.call(value.types,value.primaryType))reject("INVALID_SENSITIVE_PARAMS","eth_signTypedData_v4 data is invalid.");
  const chainId=value.domain.chainId;if(chainId!==6423&&chainId!=="0x1917")reject("WRONG_CHAIN","EIP-712 domain is not YNX Testnet.");
  if(typeof value.domain.name!=="string"||!SAFE_TEXT.test(value.domain.name)||(value.domain.verifyingContract!==undefined&&!ADDRESS.test(value.domain.verifyingContract)))reject("INVALID_SENSITIVE_PARAMS","EIP-712 domain is invalid.");
  for(const fields of Object.values(value.types)){if(!Array.isArray(fields)||fields.length<1||fields.length>64||fields.some((field)=>!plain(field)||Object.keys(field).sort().join(",")!=="name,type"||typeof field.name!=="string"||!SAFE_TEXT.test(field.name)||typeof field.type!=="string"||!SAFE_TEXT.test(field.type)))reject("INVALID_SENSITIVE_PARAMS","EIP-712 types are invalid.")}
}
function plain(value){return value!==null&&typeof value==="object"&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype}
