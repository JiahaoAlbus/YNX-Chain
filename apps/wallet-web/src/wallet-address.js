import {evmAddressFromYNX,ynxAddressFromEVM} from "../../../packages/wallet-auth/src/crypto.js";
import {getAddress} from "ethers";

// Presentation and input boundary only. Standard provider/storage identity stays
// the exact same 20-byte Ethereum address; the SDK validates the YNX checksum.
export function toEVMAddress(value){
  if(typeof value!=="string")throw Object.assign(new Error("Wallet address is invalid."),{code:"INVALID_ACCOUNT"});
  if(value.startsWith("ynx1"))return evmAddressFromYNX(value);
  if(!/^0x[0-9a-fA-F]{40}$/.test(value))throw Object.assign(new Error("Ethereum compatibility address is invalid."),{code:"INVALID_ACCOUNT"});
  let address;try{address=getAddress(value).toLowerCase()}catch{throw Object.assign(new Error("Ethereum compatibility address checksum is invalid."),{code:"INVALID_ACCOUNT"})}
  ynxAddressFromEVM(address);return address;
}
export function toYNXAddress(value){return ynxAddressFromEVM(toEVMAddress(value))}
