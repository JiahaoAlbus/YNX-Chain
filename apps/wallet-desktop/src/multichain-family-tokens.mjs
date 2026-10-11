import {AtomicMultiFile, exactObject, multiError} from './multichain-config.mjs';
import {tronAddress, TRC20_METADATA_LIMITS} from './multichain-tron.mjs';
const invalid = () => {throw multiError('FAMILY_TOKEN_INVALID', 'Check the selected network and token contract.');};
export function validateFamilyToken(token) {
  exactObject(token, ['family', 'network', 'genesis', 'contract', 'name', 'symbol', 'decimals']);
  if (token.family !== 'tron' || !['mainnet', 'shasta', 'nile'].includes(token.network) || typeof token.genesis !== 'string' || !/^[0-9a-f]{64}$/.test(token.genesis) || /^0+$/.test(token.genesis) || !Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 255) invalid();
  if (tronAddress(token.contract).hex !== token.contract) invalid();
  for (const field of ['name', 'symbol']) {const value = token[field], limit = TRC20_METADATA_LIMITS[field]; if (typeof value !== 'string' || !value || value.trim() !== value || [...value].length > limit.codepoints || Buffer.byteLength(value, 'utf8') > limit.utf8Bytes || /[\p{Cc}\p{Cf}<>]/u.test(value)) invalid();}
  return {...token};
}
const key = t => `${t.family}:${t.network}:${t.genesis}:${t.contract}`;
function validate(value) {
  exactObject(value, ['version', 'revision', 'tokens']);
  if (value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.tokens) || value.tokens.length > 16) invalid();
  const tokens = value.tokens.map(validateFamilyToken); if (new Set(tokens.map(key)).size !== tokens.length) invalid();
  return {...value, tokens};
}
export class FamilyTokens {
  constructor({filePath, file} = {}) {this.file = file ?? new AtomicMultiFile({filePath, initial: {version: 1, revision: 0, tokens: []}, validate});}
  read() {return this.file.read();}
  remove(input,revision) {exactObject(input,['family','network','genesis','contract']);const normalized=validateFamilyToken({...input,name:'Removal identity',symbol:'LOCAL',decimals:0});return this.file.mutate(value=>{
    if(value.revision!==revision)throw multiError('MULTICHAIN_CONTEXT_CHANGED','Token catalog changed.');
    const index=value.tokens.findIndex(t=>key(t)===key(normalized));if(index<0)throw multiError('FAMILY_TOKEN_NOT_FOUND','Token was not found on this exact network.');
    value.tokens.splice(index,1);value.revision++;return value;
  });}
  put(input, revision) {const token = validateFamilyToken(input); return this.file.mutate(value => {
    if (value.revision !== revision) throw multiError('MULTICHAIN_CONTEXT_CHANGED', 'Token catalog changed.');
    const index = value.tokens.findIndex(t => key(t) === key(token)); if (index < 0) value.tokens.push(token); else value.tokens[index] = token;
    value.revision++; return value;
  });}
}
