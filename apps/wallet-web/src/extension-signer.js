import {Transaction,Wallet,getBytes,keccak256} from "ethers";
import {extensionIdentity} from "./extension-vault.js";
import {normalizeExtensionTransaction} from "./extension-sensitive-policy.js";

const CHAIN_ID=6423,CHAIN_HEX="0x1917",QUANTITY=/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u,HASH=/^0x[0-9a-fA-F]{64}$/u;
function fail(code,message){throw Object.assign(new Error(message),{code})}
function quantity(value,label){if(typeof value!=="string"||!QUANTITY.test(value))fail("INVALID_RPC_RESPONSE",`${label} is invalid.`);return value}
function account(secretHex,expected){const identity=extensionIdentity(secretHex);if(identity.account!==expected.toLowerCase())fail("SIGNER_ACCOUNT_MISMATCH","Unlocked vault does not match the approved account.");return new Wallet(`0x${secretHex}`)}

export async function signExtensionRequest({secretHex,expectedAccount,method,params,rpc}){
  if(typeof rpc!=="function")fail("RPC_UNAVAILABLE","YNX Testnet RPC is unavailable.");const wallet=account(secretHex,expectedAccount);
  if(wallet.address.toLowerCase()!==expectedAccount.toLowerCase())fail("SIGNER_ACCOUNT_MISMATCH","Ethereum signer does not match the approved account.");
  if(method==="personal_sign")return wallet.signMessage(getBytes(params[0]));
  if(method==="eth_signTypedData_v4"){
    let typed;try{typed=JSON.parse(params[1])}catch{fail("INVALID_TYPED_DATA","Typed data is invalid JSON.")}
    const domain=typed?.domain,types=typed?.types,message=typed?.message;if(!domain||!types||!message||typeof types!=="object")fail("INVALID_TYPED_DATA","Typed data is incomplete.");
    let domainChain;try{domainChain=BigInt(domain.chainId)}catch{fail("WRONG_NETWORK","Typed data does not declare YNX Testnet.")}if(domainChain!==BigInt(CHAIN_ID))fail("WRONG_NETWORK","Typed data does not declare YNX Testnet.");
    const signingTypes={...types};delete signingTypes.EIP712Domain;return wallet.signTypedData(domain,signingTypes,message);
  }
  if(method!=="eth_sendTransaction")fail(4200,"Unsupported signer method.");
  const input=normalizeExtensionTransaction(params[0]),chainId=await rpc("eth_chainId",[]);if(chainId!==CHAIN_HEX)fail("WRONG_NETWORK","Provider RPC did not prove YNX Testnet 0x1917.");
  const nonce=input.nonce??quantity(await rpc("eth_getTransactionCount",[expectedAccount,"pending"]),"Transaction nonce"),gasLimit=input.gas??quantity(await rpc("eth_estimateGas",[input]),"Gas estimate"),dynamic=input.type==="0x2"||input.maxFeePerGas!==undefined||input.maxPriorityFeePerGas!==undefined;
  const fees=dynamic?{type:2,maxPriorityFeePerGas:input.maxPriorityFeePerGas??quantity(await rpc("eth_maxPriorityFeePerGas",[]),"Priority fee"),maxFeePerGas:input.maxFeePerGas??quantity(await rpc("eth_gasPrice",[]),"Maximum fee")}:{type:input.type==="0x1"?1:0,gasPrice:input.gasPrice??quantity(await rpc("eth_gasPrice",[]),"Gas price")};
  const rawTransaction=await wallet.signTransaction({...fees,chainId:CHAIN_ID,nonce,gasLimit,to:input.to,value:input.value,data:input.data,...(input.accessList?{accessList:input.accessList}:{})});
  const parsed=Transaction.from(rawTransaction);if(parsed.from?.toLowerCase()!==expectedAccount.toLowerCase()||parsed.chainId!==BigInt(CHAIN_ID)||parsed.to?.toLowerCase()!==input.to.toLowerCase()||parsed.value!==BigInt(input.value)||parsed.data.toLowerCase()!==input.data.toLowerCase())fail("SIGNED_TRANSACTION_MISMATCH","Signed transaction does not match the reviewed request.");
  const transactionHash=keccak256(rawTransaction);if(!HASH.test(transactionHash))fail("INVALID_TRANSACTION_HASH","Signed transaction hash is invalid.");return Object.freeze({rawTransaction,transactionHash:transactionHash.toLowerCase()});
}
