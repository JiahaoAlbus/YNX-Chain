// Shared public bytes; no key, provider, authority or signing port.
import {hexToBytes} from '@noble/hashes/utils.js';
import {pqError} from './pq-wallet-contract.js';
export const PQ_U64_MAX=(1n<<64n)-1n;
export function pqU64(value) {
  if (typeof value !== 'bigint' && !(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value))) throw pqError('PQ_U64_REQUIRED');
  const n = BigInt(value);
  if (n < 0n || n > PQ_U64_MAX) throw pqError('PQ_U64_OUT_OF_RANGE');
  return n;
}
export function pqHexBytes(value,size){if(typeof value!=='string'||value.length!==size*2||!/^[0-9a-f]+$/.test(value))throw pqError('PQ_CANONICAL_HEX_REQUIRED');return hexToBytes(value);}
export function publicBytesEqual(a,b){return a.length===b.length&&a.every((v,i)=>v===b[i]);}
