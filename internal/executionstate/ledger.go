package executionstate

import "math/big"

// NativeLedgerEvidence is an aggregate diagnostic of stored categories, never a
// balance reconstruction. All output keys are fixed; no address, lot ID, memo,
// raw action or dynamic transaction type is emitted. History is counted once as
// each block passes the bounded parser. Final-state comparisons require EOF.
type NativeLedgerEvidence struct {
	Scope                 string                              `json:"scope"`
	FinalStateComplete    bool                                `json:"finalStateComplete"`
	ExecutionReplayProven bool                                `json:"executionReplayProven"`
	Transactions          map[string]*LedgerTransactionTotals `json:"transactions"`
	AccountGroups         map[string]*LedgerAccountTotals     `json:"accountGroups"`
	Amounts               map[string]string                   `json:"amounts"`
	Counts                map[string]uint64                   `json:"counts"`
}
type LedgerTransactionTotals struct {
	Count              uint64 `json:"count"`
	Amount             string `json:"storedAmount"`
	Fee                string `json:"storedFee"`
	LotFlowAmount      string `json:"lotFlowAmount"`
	LotFlows           uint64 `json:"lotFlows"`
	SelfRecipientCount uint64 `json:"selfRecipientCount"`
}
type LedgerAccountTotals struct {
	Count           uint64 `json:"count"`
	Liquid          string `json:"liquid"`
	Staked          string `json:"staked"`
	Lots            string `json:"lots"`
	LotMinusLiquid  string `json:"lotMinusLiquid"`
	LotExcess       string `json:"sumPositiveLotMinusLiquid"`
	LotDeficit      string `json:"sumNegativeLotMinusLiquid"`
	ExcessAccounts  uint64 `json:"lotExcessAccounts"`
	DeficitAccounts uint64 `json:"lotDeficitAccounts"`
}

func addDecimal(dst *string, value *big.Int) {
	z, ok := new(big.Int).SetString(*dst, 10)
	if !ok {
		z = new(big.Int)
	}
	*dst = z.Add(z, value).String()
}
func (r *Report) ledger() *NativeLedgerEvidence {
	if r.NativeLedger == nil {
		r.NativeLedger = &NativeLedgerEvidence{Scope: "exact-be9-stored-category-arithmetic-only", Transactions: map[string]*LedgerTransactionTotals{}, AccountGroups: map[string]*LedgerAccountTotals{}, Amounts: map[string]string{}, Counts: map[string]uint64{}}
	}
	return r.NativeLedger
}
func ledgerTransactionType(kind string) string {
	switch kind {
	case "faucet", "transfer", "stake", "resource_delegate", "resource_rent", "contract_deploy", "contract_call", "dex_asset_create", "dex_asset_mint", "dex_asset_transfer", "dex_pool_create", "dex_liquidity_add", "dex_liquidity_remove", "dex_swap_exact_input", "dex_swap_exact_output", "resource_pool_create", "resource_pool_fund", "resource_pool_policy", "resource_pool_status", "resource_sponsored_action":
		return kind
	}
	return "other"
}
func (r *Report) ledgerTransaction(tx map[string]any) {
	l := r.ledger()
	kind := ledgerTransactionType(str(tx["type"]))
	t := l.Transactions[kind]
	if t == nil {
		t = &LedgerTransactionTotals{Amount: "0", Fee: "0", LotFlowAmount: "0"}
		l.Transactions[kind] = t
	}
	t.Count++
	addDecimal(&t.Amount, num(tx["amount"]))
	addDecimal(&t.Fee, num(tx["fee"]))
	if str(tx["from"]) != "" && str(tx["from"]) == str(tx["to"]) {
		t.SelfRecipientCount++
	}
	for _, v := range arr(tx["lotFlows"]) {
		t.LotFlows++
		addDecimal(&t.LotFlowAmount, num(obj(v)["amount"]))
	}
}
func (a *streamAudit) ledgerState() error {
	l, m := a.r.ledger(), a.retained
	validators := map[string]bool{}
	for _, v := range arr(m["validators"]) {
		key := str(obj(v)["address"])
		if err := a.capture(int64(len(key)) + 128); err != nil {
			return err
		}
		validators[key] = true
	}
	backing := map[string]*big.Int{}
	addBacking := func(key string, n *big.Int) error {
		if backing[key] == nil {
			if err := a.capture(int64(len(key)) + 256); err != nil {
				return err
			}
			backing[key] = new(big.Int)
		}
		backing[key].Add(backing[key], n)
		return nil
	}
	for key, v := range obj(m["accounts"]) {
		group := "otherAccounts"
		switch key {
		case "ynx_faucet":
			group = "faucet"
		case "ynx_protocol_resource_pool":
			group = "protocolResourcePool"
		case "ynx_protocol_resource_treasury":
			group = "protocolResourceTreasury"
		default:
			if validators[key] {
				group = "currentValidatorAccounts"
			}
		}
		g := l.AccountGroups[group]
		if g == nil {
			g = &LedgerAccountTotals{Liquid: "0", Staked: "0", Lots: "0", LotMinusLiquid: "0", LotExcess: "0", LotDeficit: "0"}
			l.AccountGroups[group] = g
		}
		g.Count++
		account := obj(v)
		lots := new(big.Int)
		for id, n := range obj(account["lots"]) {
			lots.Add(lots, num(n))
			if err := addBacking(id, num(n)); err != nil {
				return err
			}
			if num(n).Sign() == 0 {
				l.Counts["zeroAccountLotEntries"]++
			}
		}
		addDecimal(&g.Liquid, num(account["balance"]))
		addDecimal(&g.Staked, num(account["staked"]))
		addDecimal(&g.Lots, lots)
		delta := new(big.Int).Sub(lots, num(account["balance"]))
		addDecimal(&g.LotMinusLiquid, delta)
		if delta.Sign() > 0 {
			g.ExcessAccounts++
			addDecimal(&g.LotExcess, delta)
		}
		if delta.Sign() < 0 {
			g.DeficitAccounts++
			addDecimal(&g.LotDeficit, delta)
		}
	}
	poolLots, reserve := new(big.Int), new(big.Int)
	for _, v := range obj(m["dexPools"]) {
		p := obj(v)
		for _, side := range []string{"0", "1"} {
			if str(p["asset"+side]) != "YNXT" {
				continue
			}
			l.Counts["nativePoolSides"]++
			reserve.Add(reserve, num(p["reserve"+side]))
			for id, n := range obj(p["nativeLots"+side]) {
				poolLots.Add(poolLots, num(n))
				if err := addBacking(id, num(n)); err != nil {
					return err
				}
			}
		}
	}
	metadata, totalBacking, deficits, excess := new(big.Int), new(big.Int), new(big.Int), new(big.Int)
	for id, v := range obj(m["lots"]) {
		n := num(obj(v)["amount"])
		metadata.Add(metadata, n)
		l.Counts["metadataLots"]++
		if str(obj(v)["origin"]) == "devnet faucet mint" {
			l.Counts["faucetOriginMetadataLots"]++
		}
		b := backing[id]
		if b == nil {
			b = new(big.Int)
		}
		delta := new(big.Int).Sub(b, n)
		if delta.Sign() != 0 {
			l.Counts["metadataLotsWithBackingDelta"]++
		}
		if delta.Sign() < 0 {
			deficits.Add(deficits, delta)
		}
		if delta.Sign() > 0 {
			excess.Add(excess, delta)
		}
	}
	for id, n := range backing {
		totalBacking.Add(totalBacking, n)
		if _, exists := obj(m["lots"])[id]; !exists {
			l.Counts["backingIDsWithoutMetadata"]++
		}
	}
	l.Amounts["metadataLotIssued"] = metadata.String()
	l.Amounts["accountAndPoolLotBacking"] = totalBacking.String()
	l.Amounts["backingMinusMetadata"] = new(big.Int).Sub(totalBacking, metadata).String()
	l.Amounts["sumNegativePerLotBackingDelta"] = deficits.String()
	l.Amounts["sumPositivePerLotBackingDelta"] = excess.String()
	l.Amounts["nativePoolLots"] = poolLots.String()
	l.Amounts["nativePoolReserves"] = reserve.String()
	l.Amounts["nativePoolLotsMinusReserves"] = new(big.Int).Sub(poolLots, reserve).String()
	// These are stored business-record totals, not a replay of who owns stake or
	// rentals. Retained modules use the same token/capture budget as accounts.
	for _, spec := range [][3]string{{"resourceDelegations", "amountYnxt", "resourceDelegationRecorded"}, {"resourceRentals", "priceYnxt", "resourceRentalRecorded"}, {"resourceRentals", "providerIncomeYnxt", "resourceRentalProviderIncomeRecorded"}, {"resourceRentals", "protocolFeeYnxt", "resourceRentalProtocolFeeRecorded"}, {"resourceIncome", "amount", "resourceIncomeRecorded"}} {
		total := new(big.Int)
		for _, v := range obj(m[spec[0]]) {
			total.Add(total, num(obj(v)[spec[1]]))
		}
		l.Amounts[spec[2]] = total.String()
		l.Counts[spec[0]] = uint64(len(obj(m[spec[0]])))
	}
	if l.Counts["metadataLotsWithBackingDelta"] > 0 || l.Counts["backingIDsWithoutMetadata"] > 0 {
		a.r.issue("NATIVE_LOT_BACKING_RECONCILIATION_FAILED", "lots")
	}
	l.FinalStateComplete = true
	return nil
}
