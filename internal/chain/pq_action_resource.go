package chain

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

// These exact field orders/tags and domain match the existing consensus
// ResourceDelegationRequestHash/ResourceRentalRequestHash. They are not a new
// authorization scheme: the full binary action is independently PQ-signed.
func pqResourceRequestHash(kind string, value any) string {
	raw, _ := json.Marshal(struct {
		Domain string `json:"domain"`
		Action string `json:"action"`
		Value  any    `json:"value"`
	}{"YNX_RESOURCE_REQUEST_V1", kind, value})
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:])
}

func pqDelegationRequestHash(p ynxauth.ResourceDelegationPayload) string {
	return pqResourceRequestHash(ynxauth.ActionResourceDelegate, struct {
		Provider       string `json:"provider"`
		Beneficiary    string `json:"beneficiary"`
		AmountYNXT     int64  `json:"amountYnxt"`
		PolicyHash     string `json:"policyHash"`
		IdempotencyKey string `json:"idempotencyKey"`
	}{p.Provider, p.Beneficiary, int64(p.AmountYNXT), p.PolicyHash, p.IdempotencyKey})
}

func pqRentalRequestHash(p ynxauth.ResourceRentalPayload) string {
	expiry, err := time.Parse(time.RFC3339Nano, p.QuoteExpiresAt)
	if err != nil {
		return ""
	}
	return pqResourceRequestHash(ynxauth.ActionResourceRent, struct {
		Address        string    `json:"address"`
		Provider       string    `json:"provider"`
		Bandwidth      int64     `json:"bandwidth"`
		Compute        int64     `json:"compute"`
		AICredits      int64     `json:"aiCredits"`
		TrustCredits   int64     `json:"trustCredits"`
		QuoteID        string    `json:"quoteId"`
		QuoteExpiresAt time.Time `json:"quoteExpiresAt"`
		PolicyHash     string    `json:"policyHash"`
		MaxPriceYNXT   int64     `json:"maxPriceYnxt"`
		IdempotencyKey string    `json:"idempotencyKey"`
	}{p.Address, p.Provider, int64(p.Bandwidth), int64(p.Compute), int64(p.AICredits), int64(p.TrustCredits), p.QuoteID, expiry.UTC(), p.PolicyHash, int64(p.MaxPriceYNXT), p.IdempotencyKey})
}

func pqResourceObjectID(a ynxauth.Action, key string) string {
	raw, _ := ynxbatch.EncodeFields([]byte("YNX-PQ-RESOURCE-OBJECT/v1"), a.ChainID, []byte(a.Owner), []byte(a.Kind), []byte(key))
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:12])
}

func pqResourceIncomeID(txHash, source string) string {
	raw, _ := ynxbatch.EncodeFields([]byte("YNX-PQ-RESOURCE-INCOME/v1"), []byte(txHash), []byte(source))
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:12])
}

func pqRentalQuote(policy ResourceMarketPolicy, p ynxauth.ResourceRentalPayload, at time.Time) (ResourceQuote, error) {
	if err := policy.Validate(); err != nil {
		return ResourceQuote{}, err
	}
	if p.PolicyHash != policy.PolicyHash || p.RequestHash != pqRentalRequestHash(p) || policy.QuoteTTLSeconds > math.MaxInt64/int64(time.Second) {
		return ResourceQuote{}, errors.New("PQ rental policy or request hash mismatch")
	}
	expiry, err := time.Parse(time.RFC3339Nano, p.QuoteExpiresAt)
	if err != nil || !expiry.After(at) || expiry.After(at.Add(time.Duration(policy.QuoteTTLSeconds)*time.Second)) {
		return ResourceQuote{}, errors.New("PQ rental quote expired or exceeds policy TTL")
	}
	quote, err := ResourceQuoteForPolicy(policy, p.Address, int64(p.Bandwidth), int64(p.Compute), int64(p.AICredits), int64(p.TrustCredits), expiry)
	if err != nil {
		return ResourceQuote{}, err
	}
	if quote.ID != p.QuoteID || uint64(quote.PriceYNXT) > p.MaxPriceYNXT {
		return ResourceQuote{}, errors.New("PQ rental quote commitment or maximum price mismatch")
	}
	return quote, nil
}

// Snapshot only affected accounts and newly created object keys. Unrelated
// ledger history and growing resource maps are not cloned for each action.
type pqResourceUndo struct {
	accounts                     map[string]*Account
	pending                      []Transaction
	delegations, rentals, income []string
}

func (d *Devnet) pqResourceUndoLocked(addresses ...string) *pqResourceUndo {
	u := &pqResourceUndo{accounts: map[string]*Account{}, pending: d.pending}
	for _, address := range addresses {
		if a := d.accounts[address]; a != nil {
			copy := copyAccount(a)
			u.accounts[address] = &copy
		} else {
			u.accounts[address] = nil
		}
	}
	return u
}

func (d *Devnet) rollbackPQResourceLocked(u *pqResourceUndo) {
	for address, before := range u.accounts {
		if before == nil {
			delete(d.accounts, address)
		} else {
			*d.accounts[address] = *before
		}
	}
	for _, id := range u.delegations {
		delete(d.resourceDelegations, id)
	}
	for _, id := range u.rentals {
		delete(d.resourceRentals, id)
	}
	for _, id := range u.income {
		delete(d.resourceIncome, id)
	}
	clear(d.pending[len(u.pending):])
	d.pending = u.pending
}

// Existing sponsor pools reserve usage until explicit revocation, even while
// paused or expired. A rental must never make those reserved units spendable.
func (d *Devnet) pqReservedResourceUnitsLocked(owner string) (ResourceUnits, error) {
	var out ResourceUnits
	for _, pool := range d.resourcePools {
		if pool.Owner != owner || pool.Status == "revoked" {
			continue
		}
		left, err := subtractResourceUnits(pool.CumulativeAllowance, pool.Consumed)
		if err != nil {
			return out, err
		}
		for _, part := range []struct {
			target *int64
			amount int64
		}{{&out.Bandwidth, left.Bandwidth}, {&out.Compute, left.Compute}, {&out.AICredits, left.AICredits}, {&out.TrustCredits, left.TrustCredits}} {
			if part.amount < 0 || *part.target > math.MaxInt64-part.amount {
				return out, errors.New("reserved resource usage overflow")
			}
			*part.target += part.amount
		}
	}
	return out, nil
}

func (d *Devnet) submitPQResourceActionLocked(a ynxauth.Action, value any, hash, memo string) (Transaction, error) {
	now := time.Now().UTC()
	sender := d.accounts[a.Owner]
	var tx Transaction
	var undo *pqResourceUndo
	switch p := value.(type) {
	case ynxauth.StakePayload:
		amount := int64(p.Amount)
		if sender.Balance < amount || sender.Staked < 0 || sender.Staked > math.MaxInt64-amount || sender.ResourceUsage.ComputeUsed < 0 || sender.ResourceUsage.ComputeUsed == math.MaxInt64 {
			return Transaction{}, errors.New("PQ stake balance or capacity overflow")
		}
		undo = d.pqResourceUndoLocked(a.Owner)
		var err error
		tx, _, err = d.applyStakeLocked(a.Owner, amount)
		if err != nil {
			d.rollbackPQResourceLocked(undo)
			return Transaction{}, err
		}
	case ynxauth.ResourceDelegationPayload:
		policy := d.resourcePolicy.withCurrentHash()
		if err := policy.Validate(); err != nil {
			return Transaction{}, err
		}
		if p.PolicyHash != policy.PolicyHash || p.RequestHash != pqDelegationRequestHash(p) {
			return Transaction{}, errors.New("PQ delegation policy or request hash mismatch")
		}
		id := pqResourceObjectID(a, p.IdempotencyKey)
		if _, exists := d.resourceDelegations[id]; exists {
			return Transaction{}, errors.New("PQ delegation idempotency key already committed")
		}
		beneficiary := d.accountReadOnly(p.Beneficiary)
		if sender.Balance < int64(p.AmountYNXT) || beneficiary.Staked < 0 || beneficiary.Staked > math.MaxInt64-int64(p.AmountYNXT) {
			return Transaction{}, errors.New("PQ delegation balance or stake overflow")
		}
		undo = d.pqResourceUndoLocked(a.Owner, p.Beneficiary)
		delegation, admitted, _, err := d.applyResourceDelegationLocked(a.Owner, p.Beneficiary, int64(p.AmountYNXT))
		if err != nil {
			d.rollbackPQResourceLocked(undo)
			return Transaction{}, err
		}
		delete(d.resourceDelegations, delegation.ID)
		delegation.ID, delegation.PQTransactionHash, delegation.CreatedAt = id, hash, now
		d.resourceDelegations[id] = delegation
		undo.delegations = append(undo.delegations, id)
		tx = admitted
	case ynxauth.ResourceRentalPayload:
		policy := d.resourcePolicy.withCurrentHash()
		quote, err := pqRentalQuote(policy, p, now)
		if err != nil {
			return Transaction{}, err
		}
		id := pqResourceObjectID(a, p.IdempotencyKey)
		if _, exists := d.resourceRentals[id]; exists {
			return Transaction{}, errors.New("PQ rental idempotency key already committed")
		}
		if sender.Balance < quote.PriceYNXT || p.Provider != ProtocolResourceProvider && d.activeDelegatedYNXTLocked(p.Provider) <= 0 {
			return Transaction{}, errors.New("PQ rental lacks balance or active resource provider")
		}
		income := int64(0)
		if p.Provider != ProtocolResourceProvider {
			income = quote.PriceYNXT/10000*policy.ProviderShareBps + quote.PriceYNXT%10000*policy.ProviderShareBps/10000
		}
		deltas := map[string]int64{a.Owner: -quote.PriceYNXT}
		deltas[p.Provider] += income
		deltas[ProtocolResourceTreasury] += quote.PriceYNXT - income
		for address, delta := range deltas {
			balance := d.accountReadOnly(address).Balance
			if balance < 0 || delta > 0 && balance > math.MaxInt64-delta || delta < 0 && balance < -delta {
				return Transaction{}, errors.New("PQ rental settlement would overflow an account")
			}
		}
		reserved, err := d.pqReservedResourceUnitsLocked(a.Owner)
		if err != nil {
			return Transaction{}, err
		}
		usage := sender.ResourceUsage
		if usage.BandwidthUsed < reserved.Bandwidth || usage.ComputeUsed < reserved.Compute || usage.AICreditsUsed < reserved.AICredits || usage.TrustUsed < reserved.TrustCredits {
			return Transaction{}, errors.New("PQ rental would erase reserved sponsor usage")
		}
		for _, source := range []string{"resource-rental", "protocol-resource-fee"} {
			if _, exists := d.resourceIncome[pqResourceIncomeID(hash, source)]; exists {
				return Transaction{}, errors.New("PQ rental income identity conflict")
			}
		}
		undo = d.pqResourceUndoLocked(a.Owner, p.Provider, ProtocolResourceTreasury)
		rental, _, err := d.applyResourceRentalLocked(p.Provider, quote)
		if err != nil {
			d.rollbackPQResourceLocked(undo)
			return Transaction{}, err
		}
		oldID := rental.ID
		delete(d.resourceRentals, oldID)
		rental.ID, rental.PQTransactionHash, rental.CreatedAt = id, hash, now
		d.resourceRentals[id] = rental
		undo.rentals = append(undo.rentals, id)
		for _, item := range []struct {
			provider, source string
			amount           int64
		}{{p.Provider, "resource-rental", rental.ProviderIncomeYNXT}, {ProtocolResourceTreasury, "protocol-resource-fee", rental.ProtocolFeeYNXT}} {
			if item.amount == 0 {
				continue
			}
			delete(d.resourceIncome, hashParts("resource-income", item.provider, oldID, fmt.Sprint(item.amount))[:24])
			incomeID := pqResourceIncomeID(hash, item.source)
			d.resourceIncome[incomeID] = ResourceIncomeRecord{PQTransactionHash: hash, ID: incomeID, Provider: item.provider, RentalID: id, Source: item.source, Amount: item.amount, Currency: d.cfg.NativeCurrencySymbol, PolicyID: rental.PolicyID, PolicyVersion: rental.PolicyVersion, PolicyHash: rental.PolicyHash, CreatedAt: now}
			undo.income = append(undo.income, incomeID)
		}
		sender.ResourceUsage.BandwidthUsed = maxInt64(reserved.Bandwidth, usage.BandwidthUsed-int64(p.Bandwidth))
		sender.ResourceUsage.ComputeUsed = maxInt64(reserved.Compute, usage.ComputeUsed-int64(p.Compute))
		sender.ResourceUsage.AICreditsUsed = maxInt64(reserved.AICredits, usage.AICreditsUsed-int64(p.AICredits))
		sender.ResourceUsage.TrustUsed = maxInt64(reserved.TrustCredits, usage.TrustUsed-int64(p.TrustCredits))
		tx = Transaction{Type: "resource_rent", From: a.Owner, To: p.Provider, Amount: quote.PriceYNXT}
		d.pending = append(d.pending, tx)
	default:
		return Transaction{}, ynxauth.ErrAction
	}
	sender.Nonce = a.Nonce
	tx.Hash, tx.Memo, tx.Nonce, tx.Timestamp = hash, memo, a.Nonce, now
	d.pending[len(d.pending)-1] = tx
	return d.persistMutationLocked(tx, func() { d.rollbackPQResourceLocked(undo) })
}
