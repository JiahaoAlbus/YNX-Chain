package consensus

import (
	"context"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func TestMigratedResourceMarketPreservesSettlementAndProviderEligibility(t *testing.T) {
	f := newSponsorSourceFixture(t)
	owner, user := mustNativeAddress(t, f.ownerKey), mustNativeAddress(t, f.userKey)
	delegation, _, _, err := f.d.DelegateResources(owner, user, 20)
	if err != nil {
		t.Fatal(err)
	}
	f.d.ProduceBlock()
	rental, _, err := f.d.RentResources(user, owner, 15, 0, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	f.d.ProduceBlock()
	m, err := f.d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "resource-state.json")
	a, err := NewPersistentApplication(m, path)
	if err != nil {
		t.Fatal(err)
	}
	if !accountsEqual(a.committed.Accounts, m.Accounts) || len(a.committed.ResourceQuotes) != 0 || len(a.committed.ResourceEvents) != 0 || len(a.committed.ResourceRentals) != 0 {
		t.Fatal("import replayed source money/usage or fabricated a quote, rental authority or event")
	}
	var legacyRental sourceResourceRentalView
	queryJSON(t, a, "/resource/rentals/"+rental.ID, &legacyRental)
	if legacyRental.SourceAnchor != m.StateHash || !reflect.DeepEqual(legacyRental.ResourceRental, rental) {
		t.Fatal("original source rental changed")
	}
	var legacyDelegation sourceResourceDelegationView
	queryJSON(t, a, "/resource/delegations/"+delegation.ID, &legacyDelegation)
	if legacyDelegation.SourceAnchor != m.StateHash || !reflect.DeepEqual(legacyDelegation.ResourceDelegation, delegation) {
		t.Fatal("original delegation changed")
	}
	missing, err := a.Query(context.Background(), &abcitypes.RequestQuery{Path: "/resource/quotes/" + rental.QuoteID})
	if err != nil || missing.Code == 0 {
		t.Fatal("missing historical quote was fabricated")
	}
	if !hasLegacyActiveResourceDelegation(a.committed.LegacyResourceMarket, owner) {
		t.Fatal("source active provider eligibility disappeared")
	}

	beforeOwner := queryConsensusAccount(t, a, owner)
	beforeUser := queryConsensusAccount(t, a, user)
	blockTime := rental.CreatedAt.Add(time.Second)
	quote, err := chain.ResourceQuoteForPolicy(m.ResourcePolicy, owner, 100, 0, 0, 0, blockTime.Add(time.Duration(m.ResourcePolicy.QuoteTTLSeconds/2)*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	input := ResourceRentalPayload{Address: owner, Provider: owner, Bandwidth: 100, QuoteID: quote.ID, QuoteExpiresAt: quote.ExpiresAt, PolicyHash: quote.PolicyHash, MaxPriceYNXT: quote.PriceYNXT, IdempotencyKey: "new-rental-after-source"}
	input.RequestHash = ResourceRentalRequestHash(input.Address, input.Provider, input.Bandwidth, input.Compute, input.AICredits, input.TrustCredits, input.QuoteID, input.QuoteExpiresAt, input.PolicyHash, input.MaxPriceYNXT, input.IdempotencyKey)
	raw := mustResourceAction(t, f.ownerKey, ActionResourceRent, input, beforeOwner.Nonce+1)
	check, err := a.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: raw})
	if err != nil || check.Code != 0 {
		t.Fatalf("source provider rejected in new signed rental: %+v %v", check, err)
	}
	commitSponsorBlock(t, a, int64(m.Height)+1, blockTime, raw)
	after := queryConsensusAccount(t, a, owner)
	expectedIncome := resourceBasisPoints(quote.PriceYNXT, m.ResourcePolicy.ProviderShareBps)
	if after.Nonce != beforeOwner.Nonce+1 || after.Balance != beforeOwner.Balance-quote.PriceYNXT+expectedIncome-SignedActionFeeYNXT || after.ResourceUsage.BandwidthUsed != 10 || !reflect.DeepEqual(beforeUser, queryConsensusAccount(t, a, user)) {
		t.Fatalf("new signed rental lost accounting or sponsor reservation: before=%+v after=%+v", beforeOwner, after)
	}
	if len(a.committed.ResourceRentals) != 1 || len(a.committed.ResourceQuotes) != 1 || len(a.committed.ResourceEvents) != 1 || len(a.committed.FeeEvents) != 1 {
		t.Fatal("new rental lacks its actual native quote, event or fee")
	}
	if !reflect.DeepEqual(a.committed.LegacyResourceMarket, migrationResourceMarket(m)) {
		t.Fatal("source Resource Market segment was rewritten")
	}
	var analytics chain.ResourceAnalytics
	queryJSON(t, a, "/resource/analytics", &analytics)
	if analytics.ActiveDelegationCount != 1 || analytics.ResourceRentalCount != 2 || analytics.RentalVolumeYNXT != rental.PriceYNXT+quote.PriceYNXT || analytics.ProviderIncomeYNXT != rental.ProviderIncomeYNXT+expectedIncome {
		t.Fatalf("source/new analytics do not reconcile: %+v", analytics)
	}
	restarted, err := NewPersistentApplication(m, path)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(a.committed, restarted.committed) {
		t.Fatal("restart lost original settlements or live Resource state")
	}
	bad := restarted.committed
	bad.LegacyResourceMarket = nil
	if bad.Validate(m) == nil {
		t.Fatal("source market omission accepted")
	}
	bad = restarted.committed
	bad.LegacyResourceMarket = cloneLegacyResourceMarket(bad.LegacyResourceMarket)
	for id, value := range bad.LegacyResourceMarket.Income {
		value.Amount++
		bad.LegacyResourceMarket.Income[id] = value
		break
	}
	if bad.Validate(m) == nil {
		t.Fatal("source income mutation accepted")
	}
}

func TestResourceRentalPreservesSponsorReservationWithoutPartialMutation(t *testing.T) {
	usage := chain.ResourceUsage{BandwidthUsed: 14, ComputeUsed: 8, AICreditsUsed: 6, TrustUsed: 5}
	pool := BFTResourcePool{ResourcePool: chain.ResourcePool{Owner: "owner", Status: "active", CumulativeAllowance: chain.ResourceUnits{Bandwidth: 12, Compute: 5, AICredits: 3, TrustCredits: 2}, Consumed: chain.ResourceUnits{Bandwidth: 2, Compute: 1, AICredits: 1, TrustCredits: 1}}}
	if err := reduceUnreservedResourceUsage(&usage, ResourceRentalPayload{Bandwidth: 100, Compute: 100, AICredits: 100, TrustCredits: 100}, []BFTResourcePool{pool}, "owner"); err != nil {
		t.Fatal(err)
	}
	if usage.BandwidthUsed != 10 || usage.ComputeUsed != 4 || usage.AICreditsUsed != 2 || usage.TrustUsed != 1 {
		t.Fatal("rental erased reserved sponsor units")
	}
	bad := usage
	bad.BandwidthUsed = 9
	before := bad
	if err := reduceUnreservedResourceUsage(&bad, ResourceRentalPayload{Bandwidth: 1}, []BFTResourcePool{pool}, "owner"); err == nil || bad != before {
		t.Fatal("inconsistent reservation was silently repaired or partly mutated")
	}
}
