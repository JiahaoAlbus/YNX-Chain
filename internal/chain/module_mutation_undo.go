package chain

import "maps"

// DEX actions only change the signer and fee recipient in the native account
// ledger. Snapshot those accounts and the DEX module, never the block history.
// Pools contain mutable maps, so they need deep copies before applying an action.
func (d *Devnet) nativeDexUndoLocked(signer, feeRecipient string) func() {
	accounts := map[string]*Account{}
	for _, address := range []string{signer, feeRecipient} {
		if account := d.accounts[address]; account != nil {
			copy := copyAccount(account)
			accounts[address] = &copy
		} else {
			accounts[address] = nil
		}
	}
	assets, lots := maps.Clone(d.dexAssets), maps.Clone(d.lots)
	balances := make(map[string]map[string]int64, len(d.dexBalances))
	for asset, values := range d.dexBalances {
		balances[asset] = maps.Clone(values)
	}
	pools := make(map[string]NativeDexPool, len(d.dexPools))
	for id, pool := range d.dexPools {
		pools[id] = cloneNativeDexPool(pool)
	}
	pending, events := d.pending, d.dexEvents
	return func() {
		for address, before := range accounts {
			if before == nil {
				delete(d.accounts, address)
			} else {
				*d.accounts[address] = *before
			}
		}
		d.dexAssets, d.dexBalances, d.dexPools, d.lots = assets, balances, pools, lots
		clear(d.pending[len(pending):])
		clear(d.dexEvents[len(events):])
		d.pending, d.dexEvents = pending, events
	}
}

// Resource mutations update a single signer's nonce/usage and replace immutable
// module values. Existing pool slices and idempotency response snapshots are not
// modified in place. Preserve their maps and appended tails without serializing
// unrelated modules or the ever-growing block history.
func (d *Devnet) resourceSponsorUndoLocked(signer string) func() {
	account := d.accounts[signer]
	before := *account
	pools, sponsors := maps.Clone(d.resourcePools), maps.Clone(d.resourceSponsorships)
	ids, refs := maps.Clone(d.resourceSponsorIdem), maps.Clone(d.resourceActionRefs)
	pending, audit := d.pending, d.resourceSponsorAudit
	return func() {
		*account = before
		d.resourcePools, d.resourceSponsorships = pools, sponsors
		d.resourceSponsorIdem, d.resourceActionRefs = ids, refs
		clear(d.pending[len(pending):])
		clear(d.resourceSponsorAudit[len(audit):])
		d.pending, d.resourceSponsorAudit = pending, audit
	}
}
