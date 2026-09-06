import {Transaction,TypedDataEncoder,Wallet,accessListify,formatEther,getAddress,getBytes,toQuantity} from "ethers";
import {extensionIdentity} from "./extension-vault.js";

const CHAIN_ID=6423,CHAIN_HEX="0x1917",QUANTITY=/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u,HEX=/^0x(?:[0-9a-fA-F]{2})*$/u;
const preparedRequests=new WeakSet(),TX_FIELDS=new Set(["from","to","value","data","chainId","nonce","gas","gasLimit","gasPrice","maxFeePerGas","maxPriorityFeePerGas","type","accessList"]);
function fail(code,message){throw Object.assign(new Error(message),{code})}
function freeze(value){for(const child of Object.values(value))if(child&&typeof child==="object")freeze(child);return Object.freeze(value)}
function quantity(value,label,{zero=true}={}){if(typeof value!=="string"||!QUANTITY.test(value)||!zero&&BigInt(value)===0n)fail("INVALID_TRANSACTION_FIELDS",`${label} must be a valid hexadecimal quantity.`);return toQuantity(BigInt(value))}
function address(value){try{return getAddress(value).toLowerCase()}catch{fail("INVALID_SIGNER_ACCOUNT","The transaction account or recipient is invalid.")}}
function signingFields(transaction){const{from,...fields}=transaction;return{...fields,nonce:Number(BigInt(fields.nonce))}}
async function verifyChain(rpc){if(await rpc("eth_chainId",[])!==CHAIN_HEX)fail("WRONG_NETWORK","Provider RPC did not prove YNX Testnet 0x1917.")}
async function feeRpc(rpc,method,params){try{return await rpc(method,params)}catch{fail("RPC_FEE_UNAVAILABLE","YNX Testnet cannot provide a complete network fee. Nothing was signed.")}}

async function prepareTransaction(expectedAccount,input,rpc){
  if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).some(key=>!TX_FIELDS.has(key)))fail("INVALID_TRANSACTION","The transaction contains unsupported fields.");
  const from=address(input.from),to=input.to===null||input.to===undefined?null:address(input.to);
  if(from!==expectedAccount||input.chainId!==undefined&&![CHAIN_ID,String(CHAIN_ID),CHAIN_HEX].includes(input.chainId))fail("INVALID_TRANSACTION","Transaction account or chain does not match the reviewed account.");
  if(input.gas!==undefined&&input.gasLimit!==undefined&&input.gas!==input.gasLimit)fail("INVALID_TRANSACTION","Conflicting gas and gasLimit values are not allowed.");
  if(input.type!==undefined&&![0,1,2,"0x0","0x1","0x2"].includes(input.type))fail("INVALID_TRANSACTION","Unsupported transaction type.");
  const dynamic=input.maxFeePerGas!==undefined||input.maxPriorityFeePerGas!==undefined,type=input.type===undefined?(dynamic?2:input.accessList!==undefined?1:0):Number(input.type);
  if(type!==2&&dynamic||type===2&&input.gasPrice!==undefined||type===0&&input.accessList!==undefined)fail("INVALID_TRANSACTION","Transaction type, access list and fee fields are inconsistent.");
  const data=input.data??"0x";
  if(typeof data!=="string"||!HEX.test(data)||data.length>16386||to===null&&data==="0x")fail("INVALID_TRANSACTION","Transaction data is invalid or contract creation has no bytecode.");
  const tx={from,to,value:quantity(input.value??"0x0","Value"),data:data.toLowerCase(),chainId:CHAIN_HEX,type};
  for(const key of["nonce","gasPrice","maxFeePerGas","maxPriorityFeePerGas"])if(input[key]!==undefined)tx[key]=quantity(input[key],key,{zero:["nonce","maxPriorityFeePerGas"].includes(key)});
  if(input.gas!==undefined||input.gasLimit!==undefined)tx.gasLimit=quantity(input.gasLimit??input.gas,"Gas limit",{zero:false});
  if(type!==0){try{tx.accessList=accessListify(input.accessList??[])}catch{fail("INVALID_TRANSACTION","Transaction access list is invalid.")}}
  await verifyChain(rpc);
  const nonce=quantity(await rpc("eth_getTransactionCount",[from,"pending"]),"Pending nonce");
  if(tx.nonce!==undefined&&tx.nonce!==nonce)fail("TRANSACTION_NONCE_CHANGED","The requested nonce differs from the pending nonce. Review a new transaction.");
  if(BigInt(nonce)>BigInt(Number.MAX_SAFE_INTEGER))fail("INVALID_TRANSACTION","The nonce exceeds the supported range.");tx.nonce=nonce;
  if(type===2){
    const block=await feeRpc(rpc,"eth_getBlockByNumber",["latest",false]),baseFee=BigInt(quantity(block?.baseFeePerGas,"Base fee"));
    tx.maxPriorityFeePerGas??=quantity(await feeRpc(rpc,"eth_maxPriorityFeePerGas",[]),"Priority fee");tx.maxFeePerGas??=toQuantity(baseFee*2n+BigInt(tx.maxPriorityFeePerGas));
    if(BigInt(tx.maxFeePerGas)<baseFee+BigInt(tx.maxPriorityFeePerGas))fail("INVALID_TRANSACTION_FEE","Maximum fee does not cover the current base and priority fees.");
  }else tx.gasPrice??=quantity(await feeRpc(rpc,"eth_gasPrice",[]),"Gas price",{zero:false});
  const estimateInput={...tx,type:toQuantity(type)};delete estimateInput.gasLimit;
  const estimate=BigInt(quantity(await feeRpc(rpc,"eth_estimateGas",[estimateInput]),"Gas estimate",{zero:false}));
  if(estimate<21000n||tx.gasLimit!==undefined&&BigInt(tx.gasLimit)<estimate)fail("INVALID_TRANSACTION_GAS","The gas limit is below the network estimate.");tx.gasLimit??=toQuantity((estimate*120n+99n)/100n);
  const balance=BigInt(quantity(await rpc("eth_getBalance",[from,"pending"]),"Balance")),maximumFee=BigInt(tx.gasLimit)*BigInt(tx.gasPrice??tx.maxFeePerGas);
  if(balance<BigInt(tx.value)+maximumFee)fail("INSUFFICIENT_FUNDS","Insufficient YNXT to cover the amount and maximum network fee.");Transaction.from(signingFields(tx)).unsignedSerialized;return freeze(tx);
}

export async function prepareExtensionRequest({expectedAccount,method,params,rpc}){
  const account=address(expectedAccount);let normalized,review;
  if(method==="personal_sign"){
    if(!Array.isArray(params)||params.length!==2||address(params[1])!==account||typeof params[0]!=="string"||!HEX.test(params[0])||params[0].length>8194)fail("INVALID_SENSITIVE_PARAMS","Message parameters are invalid.");
    const bytes=getBytes(params[0]);let messageText;try{messageText=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes)}catch{messageText="Invalid UTF-8; review the exact messageHex bytes."}
    normalized=[params[0],account];review={account,messageHex:params[0],messageBytes:bytes.length,messageText,warning:"This signature may authorize external actions. Invisible and directional characters are escaped; the full hexadecimal bytes are authoritative."};
  }else if(method==="eth_signTypedData_v4"){
    if(!Array.isArray(params)||params.length!==2||address(params[0])!==account||typeof params[1]!=="string"||params[1].length>65536)fail("INVALID_TYPED_DATA","Typed data parameters are invalid.");
    let typed;try{
      typed=JSON.parse(params[1]);const{domain,types,message,primaryType}=typed;if(!domain||!types||!message||BigInt(domain.chainId)!==BigInt(CHAIN_ID))throw new Error();
      const signingTypes={...types};delete signingTypes.EIP712Domain;if(TypedDataEncoder.from(signingTypes).primaryType!==primaryType)throw new Error();TypedDataEncoder.hash(domain,signingTypes,message);
      const domainType=TypedDataEncoder.getPayload(domain,signingTypes,message).types.EIP712Domain;
      if(types.EIP712Domain!==undefined&&(!Array.isArray(types.EIP712Domain)||types.EIP712Domain.length!==domainType.length||domainType.some((field,index)=>types.EIP712Domain[index]?.name!==field.name||types.EIP712Domain[index]?.type!==field.type)))throw new Error();
      if(types.EIP712Domain===undefined)types.EIP712Domain=domainType;
    }catch{fail("INVALID_TYPED_DATA","Typed data cannot be signed exactly as displayed on YNX Testnet.")}
    normalized=[account,JSON.stringify(typed)];review={...typed,account,warning:"This signature may authorize transfers or spending permissions. Review every domain, type and message field."};
  }else if(method==="eth_sendTransaction"){
    if(typeof rpc!=="function"||!Array.isArray(params)||params.length!==1)fail("RPC_UNAVAILABLE","Transaction preparation requires YNX Testnet RPC.");
    const tx=await prepareTransaction(account,params[0],rpc),maximumFee=BigInt(tx.gasLimit)*BigInt(tx.gasPrice??tx.maxFeePerGas);
    normalized=[tx];review={account,...tx,amount:formatEther(tx.value),maximumFee:formatEther(maximumFee),total:formatEther(BigInt(tx.value)+maximumFee),symbol:"YNXT",warning:"This exact transaction will be signed and broadcast. Contract calls may transfer assets or grant permissions beyond the displayed native amount."};
  }else fail(4200,"Unsupported signer method.");
  const prepared=freeze({account,method,params:normalized,review});preparedRequests.add(prepared);return prepared;
}
export function extensionReviewText(review){return JSON.stringify(review,null,2).replace(/[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufeff\uffa0]/gu,char=>`\\u${char.charCodeAt(0).toString(16).padStart(4,"0")}`)}

export async function signExtensionRequest({secretHex,expectedAccount,prepared,rpc,assertAuthorized}){
  if(!preparedRequests.has(prepared)||typeof assertAuthorized!=="function")fail("UNREVIEWED_REQUEST","Prepare and review this exact request before signing.");preparedRequests.delete(prepared);
  if(prepared.account!==expectedAccount?.toLowerCase()||extensionIdentity(secretHex).account!==prepared.account)fail("SIGNER_ACCOUNT_MISMATCH","Unlocked vault does not match the approved account.");
  await assertAuthorized();const{method,params}=prepared,wallet=new Wallet(`0x${secretHex}`);let result;
  if(method==="eth_sendTransaction"){
    if(typeof rpc!=="function")fail("RPC_UNAVAILABLE","YNX Testnet RPC is unavailable.");await verifyChain(rpc);
    if(quantity(await rpc("eth_getTransactionCount",[prepared.account,"pending"]),"Pending nonce")!==params[0].nonce)fail("TRANSACTION_NONCE_CHANGED","The pending nonce changed after review. Prepare and review again.");
    await assertAuthorized();const fields=signingFields(params[0]),expected=Transaction.from(fields).unsignedSerialized,rawTransaction=await wallet.signTransaction(fields),parsed=Transaction.from(rawTransaction);
    if(parsed.from?.toLowerCase()!==prepared.account||parsed.unsignedSerialized!==expected)fail("SIGNED_TRANSACTION_MISMATCH","Signed transaction does not match the approved snapshot.");result=Object.freeze({rawTransaction,transactionHash:parsed.hash});
  }else if(method==="personal_sign")result=await wallet.signMessage(getBytes(params[0]));
  else{const typed=JSON.parse(params[1]),types={...typed.types};delete types.EIP712Domain;result=await wallet.signTypedData(typed.domain,types,typed.message)}
  await assertAuthorized();return result;
}
