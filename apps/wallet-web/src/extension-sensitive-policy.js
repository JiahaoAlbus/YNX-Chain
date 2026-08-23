export const SENSITIVE_REPLAY_KEY="ynx.extension.sensitive.replay.v1";
export const SENSITIVE_REPLAY_LIMIT=2048;
export const SENSITIVE_METHODS=Object.freeze(["eth_requestAccounts","wallet_requestPermissions","personal_sign","eth_signTypedData_v4","eth_sendTransaction"]);
const ADDRESS=/^0x[0-9a-fA-F]{40}$/u,SIGNATURE=/^0x[0-9a-fA-F]{130}$/u,HASH=/^0x[0-9a-fA-F]{64}$/u,HEX=/^0x(?:[0-9a-fA-F]{2})*$/u,QUANTITY=/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u;
const TX_KEYS=new Set(["accessList","chainId","data","from","gas","gasPrice","input","maxFeePerGas","maxPriorityFeePerGas","nonce","to","type","value"]);
function reject(code,message){throw Object.assign(new Error(message),{code})}

function accessList(value){
  if(value===undefined)return undefined;
  if(!Array.isArray(value)||value.length>256)reject("INVALID_SENSITIVE_PARAMS","Transaction accessList is invalid.");
  return Object.freeze(value.map((item)=>{
    if(!item||typeof item!=="object"||Array.isArray(item)||Object.keys(item).sort().join(",")!=="address,storageKeys"||!ADDRESS.test(item.address)||!Array.isArray(item.storageKeys)||item.storageKeys.length>256||item.storageKeys.some((key)=>!/^0x[0-9a-fA-F]{64}$/u.test(key)))reject("INVALID_SENSITIVE_PARAMS","Transaction accessList is invalid.");
    return Object.freeze({address:item.address.toLowerCase(),storageKeys:Object.freeze(item.storageKeys.map((key)=>key.toLowerCase()))});
  }));
}

export function normalizeExtensionTransaction(value){
  if(!value||typeof value!=="object"||Array.isArray(value))reject("INVALID_SENSITIVE_PARAMS","eth_sendTransaction parameters are not canonical.");
  const keys=Object.keys(value);if(keys.some((key)=>!TX_KEYS.has(key))||!ADDRESS.test(value.from||"")||!ADDRESS.test(value.to||""))reject("INVALID_SENSITIVE_PARAMS","eth_sendTransaction parameters are not canonical.");
  if(value.data!==undefined&&value.input!==undefined&&value.data.toLowerCase()!==value.input.toLowerCase())reject("INVALID_SENSITIVE_PARAMS","Transaction data and input disagree.");
  const data=value.data??value.input??"0x",quantityFields=["value","nonce","gas","gasPrice","maxFeePerGas","maxPriorityFeePerGas"];
  if(!HEX.test(data)||data.length>16386||quantityFields.some((key)=>value[key]!==undefined&&!QUANTITY.test(value[key])))reject("INVALID_SENSITIVE_PARAMS","eth_sendTransaction parameters are not canonical.");
  if(value.chainId!==undefined&&value.chainId!=="0x1917")reject("WRONG_NETWORK","Transaction does not declare YNX Testnet 0x1917.");
  if(value.type!==undefined&&!['0x0','0x1','0x2'].includes(value.type))reject("INVALID_SENSITIVE_PARAMS","Transaction type is unsupported.");
  const dynamic=value.type==="0x2"||value.maxFeePerGas!==undefined||value.maxPriorityFeePerGas!==undefined;
  if((dynamic&&value.gasPrice!==undefined)||(!dynamic&&value.type==="0x2")||(value.maxPriorityFeePerGas!==undefined&&value.maxFeePerGas!==undefined&&BigInt(value.maxPriorityFeePerGas)>BigInt(value.maxFeePerGas)))reject("INVALID_SENSITIVE_PARAMS","Legacy and EIP-1559 fee fields are mutually exclusive.");
  const list=accessList(value.accessList);
  return Object.freeze({from:value.from.toLowerCase(),to:value.to.toLowerCase(),value:value.value??"0x0",data:data.toLowerCase(),...(value.nonce!==undefined?{nonce:value.nonce}:{}),...(value.gas!==undefined?{gas:value.gas}:{}),...(value.gasPrice!==undefined?{gasPrice:value.gasPrice}:{}),...(value.maxFeePerGas!==undefined?{maxFeePerGas:value.maxFeePerGas}:{}),...(value.maxPriorityFeePerGas!==undefined?{maxPriorityFeePerGas:value.maxPriorityFeePerGas}:{}),...(value.chainId!==undefined?{chainId:value.chainId}:{}),...(value.type!==undefined?{type:value.type}:{}),...(list!==undefined?{accessList:list}:{})});
}

export function parseSensitiveRequest(message,now=Date.now()){
  if(!SENSITIVE_METHODS.includes(message?.method))return null;
  if(typeof message.requestId!=="string"||!Number.isSafeInteger(message.deadlineAt)||message.deadlineAt<=now)reject("BRIDGE_EXPIRED","Sensitive wallet request expired.");
  const params=message.params;
  if(message.method==="eth_requestAccounts"){
    if(params!==undefined&&(!Array.isArray(params)||params.length!==0))reject("INVALID_SENSITIVE_PARAMS","eth_requestAccounts accepts no parameters.");
    return Object.freeze({method:message.method,expectedAccount:null});
  }
  if(message.method==="wallet_requestPermissions"){
    const request=Array.isArray(params)&&params.length===1?params[0]:null;
    if(!request||typeof request!=="object"||Array.isArray(request)||Object.keys(request).join(",")!=="eth_accounts"||typeof request.eth_accounts!=="object"||request.eth_accounts===null||Array.isArray(request.eth_accounts)||Object.keys(request.eth_accounts).length!==0)reject("INVALID_SENSITIVE_PARAMS","wallet_requestPermissions accepts only eth_accounts.");
    return Object.freeze({method:message.method,expectedAccount:null});
  }
  if(message.method==="personal_sign"){
    if(!Array.isArray(params)||params.length!==2||typeof params[0]!=="string"||!HEX.test(params[0])||params[0].length>8194||!ADDRESS.test(params[1]))reject("INVALID_SENSITIVE_PARAMS","personal_sign parameters are invalid.");
    return Object.freeze({method:message.method,expectedAccount:params[1].toLowerCase()});
  }
  if(message.method==="eth_signTypedData_v4"){
    if(!Array.isArray(params)||params.length!==2||!ADDRESS.test(params[0])||typeof params[1]!=="string"||params[1].length<2||params[1].length>65536)reject("INVALID_SENSITIVE_PARAMS","eth_signTypedData_v4 parameters are invalid.");
    let typed;try{typed=JSON.parse(params[1])}catch{reject("INVALID_SENSITIVE_PARAMS","eth_signTypedData_v4 data is invalid JSON.")}
    if(!typed||typeof typed!=="object"||Array.isArray(typed))reject("INVALID_SENSITIVE_PARAMS","eth_signTypedData_v4 data is invalid.");
    return Object.freeze({method:message.method,expectedAccount:params[0].toLowerCase()});
  }
  const tx=Array.isArray(params)&&params.length===1?normalizeExtensionTransaction(params[0]):null;if(!tx)reject("INVALID_SENSITIVE_PARAMS","eth_sendTransaction parameters are not canonical.");
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
  if((method==="personal_sign"||method==="eth_signTypedData_v4")&&!SIGNATURE.test(result||""))reject("INVALID_SIGNATURE","Wallet backend returned an invalid signature.");
  if(method==="eth_sendTransaction"&&!HASH.test(result||""))reject("INVALID_TRANSACTION_HASH","Wallet backend returned an invalid transaction hash.");
  return result;
}
