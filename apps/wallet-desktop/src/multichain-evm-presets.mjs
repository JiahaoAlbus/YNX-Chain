/** Public configuration templates, not saved networks or authority to send.
 * Endpoints/chain IDs: official Base and Arbitrum network documentation.
 * Block-zero hashes: provider observations through publicRPCTransport on
 * 2026-10-11; matching a pin is not independent consensus verification.
 * Always pass a chosen template through the existing live verify/save gate.
 */
export const EVM_NETWORK_PRESETS=Object.freeze([
  {name:'Base Mainnet',rpcUrl:'https://mainnet.base.org',chainId:'8453',symbol:'ETH',decimals:18,genesis:'0xf712aa9241cc24369b143cf6dce85f0902a9731e70d66818a3a5845b296c73dd'},
  {name:'Arbitrum One',rpcUrl:'https://arb1.arbitrum.io/rpc',chainId:'42161',symbol:'ETH',decimals:18,genesis:'0x7ee576b35482195fc49205cec9af72ce14f003b9ae69f6ba0faef4514be8b442'},
  {name:'Arbitrum Sepolia (Testnet)',rpcUrl:'https://sepolia-rollup.arbitrum.io/rpc',chainId:'421614',symbol:'ETH',decimals:18,genesis:'0x77194da4010e549a7028a9c3c51c3e277823be6ac7d138d0bb8a70197b5c004c'}
].map(Object.freeze));
export const EVM_PRESET_SOURCES=Object.freeze([
  'https://docs.base.org/get-started/connect-to-base',
  'https://docs.arbitrum.io/arbitrum-essentials/reference/node-providers'
]);
