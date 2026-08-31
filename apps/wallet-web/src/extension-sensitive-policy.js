export const SENSITIVE_REPLAY_KEY="ynx.extension.sensitive.replay.v1";
export const SENSITIVE_REPLAY_LIMIT=2048;
export const SENSITIVE_METHODS=Object.freeze(["eth_requestAccounts","wallet_requestPermissions","personal_sign","eth_signTypedData_v4","eth_sendTransaction"]);
const ADDRESS=/^0x[0-9a-fA-F]{40}$/u,SIGNATURE=/^0x[0-9a-fA-F]{130}$/u,HASH=/^0x[0-9a-fA-F]{64}$/u,HEX=/^0x(?:[0-9a-fA-F]{2})*$/u,QUANTITY=/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u;
function reject(code,message){throw Object.assign(new Error(message),{code})}

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
  if((method==="personal_sign"||method==="eth_signTypedData_v4")&&!SIGNATURE.test(result||""))reject("INVALID_SIGNATURE","Wallet backend returned an invalid signature.");
  if(method==="eth_sendTransaction"&&!HASH.test(result||""))reject("INVALID_TRANSACTION_HASH","Wallet backend returned an invalid transaction hash.");
  return result;
}
