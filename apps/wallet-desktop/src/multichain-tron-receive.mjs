import QRCode from 'qrcode';
import bs58check from 'bs58check';

export function receiveOwn(object, key) {
  const descriptor = object && typeof object === 'object' && Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw Error('TRON_RECEIVE_INVALID');
  return descriptor.value;
}
export function publicTronAddress(value) {
  if (typeof value !== 'string' || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)) throw Error('TRON_RECEIVE_INVALID');
  const bytes = bs58check.decode(value);
  if (bytes.length !== 21 || bytes[0] !== 0x41) throw Error('TRON_RECEIVE_INVALID');
  return value;
}
export function receiveNetwork(snapshot, network) {
  const revision = receiveOwn(snapshot, 'revision'), networks = receiveOwn(snapshot, 'networks');
  if (!Number.isSafeInteger(revision) || revision < 0 || !Array.isArray(networks)) throw Error('TRON_RECEIVE_INVALID');
  const item = networks.find(n => receiveOwn(n, 'family') === 'tron' && receiveOwn(n, 'network') === network);
  if (!item || !['mainnet','shasta','nile'].includes(network)) throw Error('TRON_RECEIVE_INVALID');
  const genesis = receiveOwn(item, 'genesis'), rpcUrl = receiveOwn(item, 'rpcUrl');
  if (typeof genesis !== 'string' || !/^[a-f0-9]{64}$/.test(genesis) || /^0+$/.test(genesis) || typeof rpcUrl !== 'string' || !rpcUrl.startsWith('https://')) throw Error('TRON_RECEIVE_INVALID');
  return {configRevision: revision, genesis, rpcUrl};
}
export async function createTronReceiveCode(input, {readAccount, readNetworks, getContext}) {
  const fields = ['family','network','vaultAccount','address','revision'];
  if (!input || Reflect.ownKeys(input).length !== fields.length) throw Error('TRON_RECEIVE_INVALID');
  const request = Object.fromEntries(fields.map(key => [key, receiveOwn(input,key)]));
  publicTronAddress(request.address);
  const before = await getContext();
  const live = context => context.account && !context.locked && !context.authenticating && context.account === request.vaultAccount && context.revision === request.revision;
  if (request.family !== 'tron' || !live(before)) throw Error('FAMILY_ACCOUNT_CHANGED');
  const config = receiveNetwork(await readNetworks(), request.network);
  const account = await readAccount({family:'tron',network:request.network,index:0,account:0});
  for (const key of ['family','network','vaultAccount','address']) if (receiveOwn(account,key) !== request[key]) throw Error('FAMILY_ACCOUNT_CHANGED');
  if (receiveOwn(account,'index') !== 0 || receiveOwn(account,'account') !== 0 || receiveOwn(account,'path') !== "m/44'/195'/0'/0/0") throw Error('TRON_RECEIVE_INVALID');
  const qr = QRCode.create(request.address, {errorCorrectionLevel:'M'});
  const afterConfig = receiveNetwork(await readNetworks(), request.network);
  if (!live(await getContext()) || JSON.stringify(config) !== JSON.stringify(afterConfig)) throw Error('FAMILY_ACCOUNT_CHANGED');
  return Object.freeze({...request,...config,path:account.path,size:qr.modules.size,modules:Array.from(qr.modules.data),payload:request.address});
}
