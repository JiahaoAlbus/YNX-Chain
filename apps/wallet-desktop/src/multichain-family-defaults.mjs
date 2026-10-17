// Public provider defaults, not an attestation of availability or consensus.
// Each read still checks the selected genesis. Overrides remain profile-local.
// Sources: Blockstream/esplora API.md; developers.tron.network/docs/networks.
// TRON full block IDs sampled from the documented HTTPS FullNode block 0 APIs
// on 2026-10-11. These pins identify that provider-reported network, not finality.
export const FAMILY_DEFAULT_NETWORKS = Object.freeze([
  {family: 'bitcoin', network: 'mainnet', rpcUrl: 'https://blockstream.info/api', genesis: null},
  {family: 'bitcoin', network: 'testnet3', rpcUrl: 'https://blockstream.info/testnet/api', genesis: null},
  {family: 'bitcoin', network: 'signet', rpcUrl: 'https://blockstream.info/signet/api', genesis: null},
  {family: 'tron', network: 'mainnet', rpcUrl: 'https://api.trongrid.io', genesis: '00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc'},
  {family: 'tron', network: 'shasta', rpcUrl: 'https://api.shasta.trongrid.io', genesis: '0000000000000000de1aa88295e1fcf982742f773e0419c5a9c134c994a9059e'},
  {family: 'tron', network: 'nile', rpcUrl: 'https://nile.trongrid.io', genesis: '0000000000000000d698d4192c56cb6be724a558448e2684802de4d6cd8690dc'}
].map(Object.freeze));
export function effectiveFamilyNetworks(snapshot) {
  const networks = FAMILY_DEFAULT_NETWORKS.map(n => ({...n}));
  for (const saved of snapshot.networks) {
    const index = networks.findIndex(n => n.family === saved.family && n.network === saved.network);
    if (index < 0) networks.push({...saved}); else networks[index] = {...saved};
  }
  return {...snapshot, networks};
}
