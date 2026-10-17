import {AtomicMultiFile, exactObject, rpcURL, multiError} from './multichain-config.mjs';
export function validateFamilyNetwork(input) {
  exactObject(input, ['family', 'network', 'rpcUrl', 'genesis']);
  const supported = input.family === 'bitcoin' ? ['mainnet', 'testnet3', 'testnet4', 'signet'] : input.family === 'tron' ? ['mainnet', 'shasta', 'nile'] : [];
  if (!supported.includes(input.network) || input.family === 'bitcoin' && input.genesis !== null || input.family === 'tron' && (typeof input.genesis !== 'string' || !/^[0-9a-f]{64}$/.test(input.genesis) || /^0+$/.test(input.genesis))) throw multiError('FAMILY_NETWORK_INVALID', 'Verify the chain and its genesis identity.');
  return Object.freeze({...input, rpcUrl: rpcURL(input.rpcUrl)});
}
function validate(value) {
  exactObject(value, ['version', 'revision', 'networks']);
  if (value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.networks) || value.networks.length > 7) throw Error('Invalid family networks');
  const networks = value.networks.map(validateFamilyNetwork);
  if (new Set(networks.map(n => n.family + ':' + n.network)).size !== networks.length) throw Error('Duplicate family network');
  return {...value, networks};
}
export class FamilyNetworks {
  constructor({filePath, file} = {}) { this.file = file ?? new AtomicMultiFile({filePath, initial: {version: 1, revision: 0, networks: []}, validate}); }
  read() { return this.file.read(); }
  put(input, expectedRevision) { const network = validateFamilyNetwork(input); return this.file.mutate(value => {if (expectedRevision !== undefined && value.revision !== expectedRevision) throw multiError('MULTICHAIN_CONTEXT_CHANGED', 'Network configuration changed.'); const index = value.networks.findIndex(n => n.family === network.family && n.network === network.network); if (index < 0) value.networks.push(network); else value.networks[index] = network; value.revision++; return value;}); }
}
