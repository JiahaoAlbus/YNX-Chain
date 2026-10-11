import {exactObject, multiError} from './multichain-config.mjs';
import {FamilyCustody} from './multichain-family-custody.mjs';
import {validateFamilyNetwork} from './multichain-family-networks.mjs';
import {createFamilyReadTransport} from './multichain-family-transport.mjs';
import * as bitcoin from './multichain-bitcoin.mjs';
import {verifyTronSigned, TronTransactionQuery} from './multichain-tron.mjs';
const conflict = () => {throw multiError('FAMILY_RECOVERY_BINDING', 'Keep the original transaction and its network.');};
export function verifyFamilyProduced(record, result) {
  exactObject(record.request, ['network', 'operation']); exactObject(result, ['txid', 'produced']);
  const network = validateFamilyNetwork(record.request.network);
  if (network.family !== record.family || network.network !== record.networkId || typeof result.txid !== 'string' || !/^[0-9a-f]{64}$/.test(result.txid)) conflict();
  if (record.family === 'bitcoin') {
    if (record.request.operation?.previewRequest?.network !== network.network || record.request.operation?.previewRequest?.requestId !== record.id || result.produced?.txid !== result.txid || typeof bitcoin.verifyBitcoinProduced !== 'function') conflict();
    bitcoin.verifyBitcoinProduced({request: record.request.operation, result: result.produced});
    const expectedOutpoints = bitcoin.createBitcoinPreview(record.request.operation.previewRequest).inputs.map(input => `${input.txid}:${input.vout}`).sort();
    if (JSON.stringify([...record.outpoints].sort()) !== JSON.stringify(expectedOutpoints)) conflict();
  } else {
    exactObject(record.request.operation, ['intent', 'context']);
    const {intent, context} = record.request.operation, original = result.produced;
    exactObject(original, ['state', 'network', 'owner', 'binding', 'txID', 'raw_data_hex', 'signature', 'transaction', 'broadcastAuthorized']);
    if (intent.network?.id !== network.network || intent.network?.genesisBlockId !== network.genesis || original.network?.id !== network.network || original.network?.genesisBlockId !== network.genesis || original.txID !== result.txid || original.transaction?.txID !== result.txid || original.owner !== intent.owner || original.binding !== intent.binding || original.raw_data_hex !== original.transaction?.raw_data_hex || original.signature !== original.transaction?.signature?.[0] || original.state !== 'signed-unsubmitted' || original.broadcastAuthorized !== false) conflict();
    verifyTronSigned(original.transaction, intent, context, context.timestamp);
  }
  return true;
}
export async function queryFamilyOriginal(record, {createTransport = createFamilyReadTransport} = {}) {
  const network = validateFamilyNetwork(record.request.network);
  const transport = createTransport({family: network.family, networkId: network.network, baseURL: network.rpcUrl});
  if (network.family === 'bitcoin') return new bitcoin.BitcoinReadAdapter({network: network.network, networkId: record.networkId, request: transport}).querySigned({networkId: record.networkId, network: network.network, txid: record.result.txid, rawTransaction: record.result.produced.rawTransaction});
  const observation = await new TronTransactionQuery({network: {id: network.network, genesisBlockId: network.genesis}, transport}).check({original: record.result.produced, ...record.request.operation});
  return {...observation, receipt: observation.receipt ? {...observation.receipt, blockHeight: String(observation.receipt.blockHeight)} : null};
}
const project = r => ({id: r.id, family: r.family, network: r.networkId, state: r.state, txid: r.result?.txid ?? null, receipt: r.receipt, evidence: r.queryEvidence ?? null, createdAt: r.createdAt, updatedAt: r.updatedAt, resultRetained: r.result !== null, queryable: r.result !== null && r.state !== 'cancelled'});
export class FamilyRecovery {
  constructor({filePath, journal, getContext, query = queryFamilyOriginal}) {this.journal = journal ?? new FamilyCustody({filePath, verifyResult: verifyFamilyProduced}); this.getContext = getContext; this.query = query;}
  async list(input) {
    exactObject(input, ['family', 'network']);
    if (!['bitcoin', 'tron'].includes(input.family) || !(input.family === 'bitcoin' ? ['mainnet', 'testnet3', 'testnet4', 'signet'] : ['mainnet', 'shasta', 'nile']).includes(input.network)) conflict();
    const context = await this.getContext(), records = await this.journal.list(), current = await this.getContext();
    if (current.account !== context.account || current.revision !== context.revision) conflict();
    return records.filter(r => r.account === context.account && r.family === input.family && r.networkId === input.network).map(project);
  }
  async check(input) {
    exactObject(input, ['id']);
    const context = await this.getContext(); if (context.locked) throw multiError('WALLET_LOCKED', 'Unlock to check the original transaction.');
    const record = (await this.journal.list()).find(r => r.id === input.id);
    if (!record || record.account !== context.account) conflict();
    const updated = await this.journal.check(record.id, async original => {
      const active = await this.getContext(); if (active.locked || active.account !== context.account || active.revision !== context.revision) throw multiError('MULTICHAIN_CONTEXT_CHANGED', 'Account changed before query.');
      return this.query(original);
    });
    // Original observation is retained even if focus is lost while awaiting it.
    // Never disclose a previous account's result to a now-current renderer.
    const current = await this.getContext(); if (current.locked || current.account !== context.account || current.revision !== context.revision) throw multiError('MULTICHAIN_CONTEXT_CHANGED', 'Original query saved; reopen its account to view it.');
    return project(updated);
  }
  async assertNetworkEditable(network) {
    const records = await this.journal.list();
    if (records.some(r => r.family === network.family && r.networkId === network.network && !['cancelled', 'included', 'failed'].includes(r.state))) throw multiError('FAMILY_RESOLUTION_REQUIRED', 'Keep this network until the original transaction is resolved.');
  }
}
