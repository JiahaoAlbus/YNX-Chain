/** Public provider suggestions matching the existing Desktop catalog.
 * A click may fill an editable form; this is NOT a network check or authority.
 * No endpoint is selected on mount, saved, queried, signed or broadcast here.
 */
export type PublicChainPreset=Readonly<{family:'bitcoin'|'tron';network:string;rpcURL:string;genesisBlockId:string|null}>;
export const PUBLIC_CHAIN_PRESETS:readonly PublicChainPreset[]=Object.freeze([
 {family:'bitcoin',network:'mainnet',rpcURL:'https://blockstream.info/api',genesisBlockId:null},
 {family:'bitcoin',network:'testnet3',rpcURL:'https://blockstream.info/testnet/api',genesisBlockId:null},
 {family:'bitcoin',network:'signet',rpcURL:'https://blockstream.info/signet/api',genesisBlockId:null},
 {family:'tron',network:'mainnet',rpcURL:'https://api.trongrid.io',genesisBlockId:'00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc'},
 {family:'tron',network:'shasta',rpcURL:'https://api.shasta.trongrid.io',genesisBlockId:'0000000000000000de1aa88295e1fcf982742f773e0419c5a9c134c994a9059e'},
 {family:'tron',network:'nile',rpcURL:'https://nile.trongrid.io',genesisBlockId:'0000000000000000d698d4192c56cb6be724a558448e2684802de4d6cd8690dc'}
].map(row=>Object.freeze(row as PublicChainPreset)));
export function publicChainPreset(family:string,network:string):PublicChainPreset|null{
 return PUBLIC_CHAIN_PRESETS.find(row=>row.family===family&&row.network===network)??null;
}
export function fillPublicChainPreset(draft:{family:string;network:string}):Readonly<{rpcURL:string;genesisBlockId:string}>|null{
 const preset=publicChainPreset(draft.family,draft.network);
 return preset?Object.freeze({rpcURL:preset.rpcURL,genesisBlockId:preset.genesisBlockId??''}):null;
}
