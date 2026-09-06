import {parseDurabilityModel,readDurabilityModel} from "./extension-durability.js";
// This is the explicit Core v1 adapter contract, not a full EVM capability claim.
export const NATIVE_FEE_MODEL = Object.freeze({version:"ynx-ethereum-native-v1",chainId:"0x1917",transactionType:"0x0",feeYNXT:"1",feeWei:"0xde0b6b3a7640000",gas:"0x61a8",gasPrice:"0x246139ca8000",decimals:18,amountQuantumWei:"0xde0b6b3a7640000",scope:"whole-YNXT plain native transfers",fullEVM:false,eip1559:false});
export const NATIVE_UNIT=10n**18n;
export function capabilityError(code,message){throw Object.assign(new Error(message),{code})}
export function parseFeeModel(value){
  if(!value||typeof value!=="object"||Array.isArray(value)||typeof value.enabled!=="boolean"||Object.entries(NATIVE_FEE_MODEL).some(([key,expected])=>value[key]!==expected))capabilityError("RPC_CAPABILITY_UNAVAILABLE","YNX RPC has not proven its amount units and transfer capability. Nothing was signed.");
  return Object.freeze({...NATIVE_FEE_MODEL,enabled:value.enabled,...(Object.hasOwn(value,"durability")?{durability:parseDurabilityModel(value.durability)}:{})});
}
export async function readFeeModel(rpc){
  if(await rpc("eth_chainId",[])!==NATIVE_FEE_MODEL.chainId)capabilityError("WRONG_NETWORK","Provider RPC did not prove YNX Testnet 0x1917.");
  let model;try{model=await rpc("ynx_getFeeModel",[])}catch{capabilityError("RPC_CAPABILITY_UNAVAILABLE","YNX RPC cannot prove its amount units. Balance and transaction preparation are unavailable.")}
  return parseFeeModel(model);
}
export function requireNativeTransfer(model){if(!parseFeeModel(model).enabled)capabilityError("NATIVE_TRANSFER_DISABLED","This RPC reports legacy whole-YNXT units. Ethereum transaction signing is disabled.")}
export async function readNativeTransferCapability(rpc){
  const feeModel=await readFeeModel(rpc);requireNativeTransfer(feeModel);const durabilityModel=await readDurabilityModel(rpc);
  if(await rpc("eth_chainId",[])!==NATIVE_FEE_MODEL.chainId)capabilityError("WRONG_NETWORK","RPC changed away from YNX Testnet during the capability check.");
  return Object.freeze({feeModel,durabilityModel});
}
export function nativeBalanceDetails(raw,model){
  const verified=parseFeeModel(model);
  if(typeof raw!=="string"||!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/u.test(raw))capabilityError("INVALID_RPC_RESPONSE","RPC returned an invalid balance quantity.");
  const amount=BigInt(raw),unit=verified.enabled?NATIVE_UNIT:1n;
  if(amount%unit!==0n)capabilityError("INVALID_RPC_RESPONSE","RPC balance does not match the whole-YNXT contract.");
  return Object.freeze({chainId:verified.chainId,rawBalance:raw,rawUnit:verified.enabled?"wei":"whole-YNXT",amountYNXT:String(amount/unit),symbol:"YNXT",ethereumNativeTransferEnabled:verified.enabled,fullEVM:false});
}
export async function readNativeBalance(rpc,params){
  const before=await readFeeModel(rpc),raw=await rpc("eth_getBalance",params),after=await readFeeModel(rpc);
  if(before.enabled!==after.enabled)capabilityError("RPC_CAPABILITY_CHANGED","RPC amount units changed during balance loading. Retry the read.");
  return nativeBalanceDetails(raw,after);
}
export function validateNativeTransferInput(input,model){
  requireNativeTransfer(model);
  const amount=BigInt(input.value);
  if(!input.to||input.from?.toLowerCase()===input.to.toLowerCase()||amount<=0n||amount%NATIVE_UNIT!==0n||amount/NATIVE_UNIT>9223372036854775807n||(input.data??"0x")!=="0x"||input.type!==undefined&&![0,"0x0"].includes(input.type)||input.accessList!==undefined||input.maxFeePerGas!==undefined||input.maxPriorityFeePerGas!==undefined)capabilityError("UNSUPPORTED_NATIVE_TRANSFER","Current YNX RPC supports positive whole-YNXT plain native transfers within signed int64 amounts only. Full EVM calls and typed transactions are not enabled.");
}
