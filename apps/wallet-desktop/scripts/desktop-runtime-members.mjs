// This leftover was present in an A preparation directory, but has no source
// blob in frozen33 and no literal caller in that frozen runtime. It must not
// acquire provenance just because electron-builder sees it on disk.
export const UNFROZEN_POLICY_INPUT='apps/wallet-desktop/src/original-policy-supplier/operator-pq-identity.mjs';
export const UNFROZEN_POLICY_PACK_FILTER='!src/original-policy-supplier/operator-pq-identity.mjs';
export function assertExcludedRuntimeNotTracked(names){
 if(names.includes(UNFROZEN_POLICY_INPUT))throw Error('Committed runtime conflicts with finite build exclusion: '+UNFROZEN_POLICY_INPUT);
}
export function unlistedCanonicalRuntimeMembers(inventory,allowed){
 return inventory.filter(row=>row.type!=='directory'&&(row.path.startsWith('code/apps/wallet-desktop/src/')||row.path.startsWith('code/packages/wallet-auth/src/')||/^code\/packages\/wallet-auth\/(?:native|scripts)\/.+\.(?:mjs|js|cjs|json)$/.test(row.path))&&!allowed.has(row.path));
}
export function assertCanonicalRuntimeMembers(inventory,allowed){
 const unlisted=unlistedCanonicalRuntimeMembers(inventory,allowed);
 if(unlisted.length)throw Object.assign(Error('Unlisted packaged runtime member'+(unlisted.length===1?'':`s (${unlisted.length})`)+': '+unlisted.slice(0,50).map(row=>row.path).join(', ')),{unlistedRuntimeMembers:Object.freeze(unlisted.map(row=>Object.freeze({path:row.path,bytes:row.bytes,sha256:row.sha256})))});
}
