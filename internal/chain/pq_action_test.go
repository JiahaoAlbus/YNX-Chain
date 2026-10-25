package chain

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func (f *pqLedgerFixture) actionMember(t *testing.T, kind string, payload any, nonce, fee uint64, n int) []byte {
	t.Helper()
	body, err := ynxauth.EncodeActionPayload(kind, payload)
	pqMust(t, err)
	message, err := (ynxauth.Action{ChainID: f.network, NativeChainID: uint64(f.d.cfg.ChainID), Owner: f.owner, Nonce: nonce, Fee: fee, Kind: kind, Payload: body}).SigningBytes()
	pqMust(t, err)
	messages := make([][]byte, n)
	for i := range messages {
		messages[i] = message
	}
	batch, err := ynxbatch.BatchSign(f.key, ynxbatch.Metadata{ChainID: f.network, Owner: f.owner, Purpose: ynxauth.TransactionPurpose}, messages, ynxbatch.SignOptions{Optimized: true})
	pqMust(t, err)
	defer batch.Discard()
	member, err := ynxbatch.Extract(batch, uint32(n-1))
	pqMust(t, err)
	wire, err := ynxbatch.EncodeMember(member)
	pqMust(t, err)
	return wire
}

func (f *pqLedgerFixture) actionDelegation(key string, amount uint64) ynxauth.ResourceDelegationPayload {
	p := ynxauth.ResourceDelegationPayload{Provider: f.owner, Beneficiary: f.to, AmountYNXT: amount, PolicyHash: f.d.ResourceMarketPolicy().PolicyHash, IdempotencyKey: key}
	p.RequestHash = pqDelegationRequestHash(p)
	return p
}

func (f *pqLedgerFixture) actionRental(t *testing.T, key, provider string) ynxauth.ResourceRentalPayload {
	t.Helper()
	quote, err := f.d.ResourceQuote(f.owner, 100, 10, 0, 0)
	pqMust(t, err)
	p := ynxauth.ResourceRentalPayload{Address: f.owner, Provider: provider, Bandwidth: 100, Compute: 10, QuoteID: quote.ID, QuoteExpiresAt: quote.ExpiresAt.Format(time.RFC3339Nano), PolicyHash: quote.PolicyHash, MaxPriceYNXT: uint64(quote.PriceYNXT), IdempotencyKey: key}
	p.RequestHash = pqRentalRequestHash(p)
	return p
}

func TestPQActionAllNativeBusinessPathsAndHistoricalRestart(t *testing.T) {
	f := newPQLedger(t)
	f.activate(t)
	nonce := uint64(2)
	submit := func(kind string, payload any, fee uint64, n int) Transaction {
		t.Helper()
		wire := f.actionMember(t, kind, payload, nonce, fee, n)
		tx, replayed, err := f.d.SubmitPQAction(wire)
		pqMust(t, err)
		if replayed || tx.Hash != pqBatchHash(wire) || tx.Nonce != nonce || tx.Fee != int64(fee) {
			t.Fatal("PQ action did not retain its exact hash, fee and nonce")
		}
		before := moduleBusinessState(t, f.d)
		old, replayed, err := f.d.SubmitPQAction(wire)
		pqMust(t, err)
		if !replayed || old.Hash != tx.Hash {
			t.Fatal("duplicate action executed twice")
		}
		assertModuleState(t, f.d, before)
		nonce++
		return tx
	}
	stake := submit(ynxauth.ActionStake, ynxauth.StakePayload{Amount: 30}, 0, 8)
	account, _ := f.d.Account(f.owner)
	if account.Staked != 30 || account.Balance != 969 || stake.Amount != 30 {
		t.Fatal("PQ stake did not execute original ledger mutation")
	}
	delegation := submit(ynxauth.ActionResourceDelegate, f.actionDelegation("pq-delegation", 40), 0, 1)
	beneficiary, _ := f.d.Account(f.to)
	if beneficiary.Staked != 40 || len(f.d.resourceDelegations) != 1 {
		t.Fatal("PQ delegation did not create real capacity")
	}
	for _, record := range f.d.resourceDelegations {
		if record.PQTransactionHash != delegation.Hash {
			t.Fatal("delegation lost its original proof reference")
		}
	}
	rental := submit(ynxauth.ActionResourceRent, f.actionRental(t, "pq-rental", f.owner), 0, 1)
	if len(f.d.resourceRentals) != 1 || len(f.d.resourceIncome) != 2 || rental.Amount != 2 {
		t.Fatal("PQ rental did not settle real provider/protocol income")
	}
	deadline := uint64(time.Now().Add(time.Hour).Unix())
	for _, c := range []struct {
		kind    string
		payload any
	}{
		{ynxauth.ActionDexAssetCreate, ynxauth.DexAssetCreatePayload{AssetID: "pq-action-token", Symbol: "PQAT", Name: "PQ action token", Decimals: 6, MaxSupply: 100000, InitialSupply: 10000}},
		{ynxauth.ActionDexAssetMint, ynxauth.DexAssetAmountPayload{AssetID: "pq-action-token", Amount: 100}},
		{ynxauth.ActionDexAssetTransfer, ynxauth.DexAssetTransferPayload{AssetID: "pq-action-token", Recipient: f.to, Amount: 10}},
		{ynxauth.ActionDexPoolCreate, ynxauth.DexPoolCreatePayload{PoolID: "dex_pq_action", Asset0: "YNXT", Asset1: "pq-action-token", FeeBps: 30}},
		{ynxauth.ActionDexLiquidityAdd, ynxauth.DexLiquidityPayload{PoolID: "dex_pq_action", Amount0: 100, Amount1: 1000, MinShares: 1, DeadlineUnix: deadline}},
		{ynxauth.ActionDexSwapExactInput, ynxauth.DexSwapExactInputPayload{PoolID: "dex_pq_action", AssetIn: "YNXT", AmountIn: 10, MinAmountOut: 1, DeadlineUnix: deadline}},
		{ynxauth.ActionDexSwapExactOutput, ynxauth.DexSwapExactOutputPayload{PoolID: "dex_pq_action", AssetOut: "pq-action-token", AmountOut: 1, MaxAmountIn: 10, DeadlineUnix: deadline}},
		{ynxauth.ActionDexLiquidityRemove, ynxauth.DexLiquidityRemovePayload{PoolID: "dex_pq_action", Shares: 10, DeadlineUnix: deadline}},
	} {
		submit(c.kind, c.payload, 1, 1)
	}
	if len(f.d.dexEvents) != 8 || f.d.nativeDexBalance("pq-action-token", f.to) != 10 {
		t.Fatal("PQ DEX did not execute existing eight-kind state machine")
	}
	snapshot := pqBatchSnapshotCopy(t, f.d)
	pqMust(t, validateAccountPolicySnapshot(snapshot))
	for _, corrupt := range []func(*devnetSnapshot){
		func(s *devnetSnapshot) { s.DexEvents = s.DexEvents[1:] },
		func(s *devnetSnapshot) {
			s.DexEvents[0].Amount0++
			s.DexEvents[0].AuditHash = nativeDexEventAuditHash(s.DexEvents[0])
		},
		func(s *devnetSnapshot) { s.DexEvents = append(s.DexEvents, s.DexEvents[0]) },
		func(s *devnetSnapshot) {
			s.DexEvents[0].TxHash = "0x" + strings.Repeat("0", 64)
			s.DexEvents[0].AuditHash = nativeDexEventAuditHash(s.DexEvents[0])
		},
	} {
		candidate := pqBatchSnapshotCopy(t, f.d)
		corrupt(&candidate)
		if err := validatePQActionSnapshot(candidate); err == nil {
			t.Fatal("DEX proof/event mismatch was accepted")
		}
	}
	// A later resource pricing policy cannot reinterpret an old signed quote.
	snapshot.Policy.BandwidthUnitPrice++
	snapshot.Policy = snapshot.Policy.withCurrentHash()
	pqMust(t, validateAccountPolicySnapshot(snapshot))
	f.d.ProduceBlock()
	restored, err := NewPersistentDevnet(f.d.cfg, f.d.dataDir)
	pqMust(t, err)
	assertModuleState(t, restored, moduleBusinessState(t, f.d))
	pqMust(t, validateAccountPolicySnapshot(pqBatchSnapshotCopy(t, restored)))
}

func TestPQActionFailsClosedWithoutBusinessMutation(t *testing.T) {
	f := newPQLedger(t)
	wire := f.actionMember(t, ynxauth.ActionStake, ynxauth.StakePayload{Amount: 1}, 2, 0, 1)
	before := moduleBusinessState(t, f.d)
	if _, _, err := f.d.SubmitPQAction(wire); err == nil {
		t.Fatal("unregistered PQ action was admitted")
	}
	assertModuleState(t, f.d, before)
	f.activate(t)
	before = moduleBusinessState(t, f.d)
	for _, algorithm := range []string{"A", "B"} {
		m, err := ynxbatch.DecodeMember(wire)
		pqMust(t, err)
		if algorithm == "A" {
			m.Certificate.SigmaA[0] ^= 1
		} else {
			m.Certificate.SigmaB[0] ^= 1
		}
		bad, err := ynxbatch.EncodeMember(m)
		pqMust(t, err)
		if _, _, err = f.d.SubmitPQAction(bad); err == nil {
			t.Fatalf("bad %s signature accepted", algorithm)
		}
		assertModuleState(t, f.d, before)
	}
	rent := f.actionRental(t, "bad-rental", ProtocolResourceProvider)
	badRequest := rent
	badRequest.RequestHash = strings.Repeat("0", 64)
	badQuote := rent
	badQuote.QuoteID = strings.Repeat("0", 24)
	badQuote.RequestHash = pqRentalRequestHash(badQuote)
	expired := rent
	expired.QuoteExpiresAt = time.Now().UTC().Add(-time.Minute).Format(time.RFC3339Nano)
	expired.RequestHash = pqRentalRequestHash(expired)
	stale := f.actionDelegation("stale-delegation", 1)
	stale.PolicyHash = strings.Repeat("0", 64)
	stale.RequestHash = pqDelegationRequestHash(stale)
	for _, c := range []struct {
		name, kind string
		payload    any
		nonce, fee uint64
	}{
		{"nonce", ynxauth.ActionStake, ynxauth.StakePayload{Amount: 1}, 3, 0},
		{"balance", ynxauth.ActionStake, ynxauth.StakePayload{Amount: 1000}, 2, 0},
		{"stake fee", ynxauth.ActionStake, ynxauth.StakePayload{Amount: 1}, 2, 1},
		{"resource request hash", ynxauth.ActionResourceRent, badRequest, 2, 0},
		{"quote commitment", ynxauth.ActionResourceRent, badQuote, 2, 0},
		{"expired quote", ynxauth.ActionResourceRent, expired, 2, 0},
		{"stale policy", ynxauth.ActionResourceDelegate, stale, 2, 0},
		{"DEX fee", ynxauth.ActionDexAssetCreate, ynxauth.DexAssetCreatePayload{AssetID: "bad-fee", Symbol: "BAD", Name: "bad fee", MaxSupply: 10, InitialSupply: 1}, 2, 0},
		{"DEX issuer authority", ynxauth.ActionDexAssetMint, ynxauth.DexAssetAmountPayload{AssetID: "unknown-asset", Amount: 1}, 2, 1},
	} {
		t.Run(c.name, func(t *testing.T) {
			bad := f.actionMember(t, c.kind, c.payload, c.nonce, c.fee, 1)
			if _, _, err := f.d.SubmitPQAction(bad); err == nil {
				t.Fatal("invalid business action admitted")
			}
			assertModuleState(t, f.d, before)
		})
	}
	if _, _, err := f.d.SubmitPQAction(make([]byte, MaxPQActionMemberBytes+1)); err == nil {
		t.Fatal("unbounded member accepted")
	}
	assertModuleState(t, f.d, before)
}

func TestPQActionResourceIdempotencyAndThreeWayHistory(t *testing.T) {
	f := newPQLedger(t)
	f.activate(t)
	delegation := f.actionDelegation("one-delegation", 20)
	dw := f.actionMember(t, ynxauth.ActionResourceDelegate, delegation, 2, 0, 1)
	_, _, err := f.d.SubmitPQAction(dw)
	pqMust(t, err)
	before := moduleBusinessState(t, f.d)
	delegation.AmountYNXT++
	delegation.RequestHash = pqDelegationRequestHash(delegation)
	if _, _, err := f.d.SubmitPQAction(f.actionMember(t, ynxauth.ActionResourceDelegate, delegation, 3, 0, 1)); err == nil {
		t.Fatal("changed body reused committed idempotency key")
	}
	assertModuleState(t, f.d, before)
	rent := f.actionRental(t, "one-rental", ProtocolResourceProvider)
	rw := f.actionMember(t, ynxauth.ActionResourceRent, rent, 3, 0, 1)
	rtx, _, err := f.d.SubmitPQAction(rw)
	pqMust(t, err)
	snapshot := pqBatchSnapshotCopy(t, f.d)
	pqMust(t, validateAccountPolicySnapshot(snapshot))
	raw, err := json.Marshal(snapshot)
	pqMust(t, err)
	for _, tc := range []struct {
		name   string
		change func(*devnetSnapshot)
	}{
		{"delegation deleted", func(s *devnetSnapshot) {
			for id := range s.Delegation {
				delete(s.Delegation, id)
			}
		}},
		{"delegation changed", func(s *devnetSnapshot) {
			for id, v := range s.Delegation {
				v.AmountYNXT++
				s.Delegation[id] = v
			}
		}},
		{"rental reverse ref deleted", func(s *devnetSnapshot) {
			for id, v := range s.Rentals {
				v.PQTransactionHash = ""
				s.Rentals[id] = v
			}
		}},
		{"rental provider changed", func(s *devnetSnapshot) {
			for id, v := range s.Rentals {
				v.Provider = f.to
				s.Rentals[id] = v
			}
		}},
		{"income deleted", func(s *devnetSnapshot) {
			for id := range s.Income {
				delete(s.Income, id)
			}
		}},
		{"income amount changed", func(s *devnetSnapshot) {
			for id, v := range s.Income {
				v.Amount++
				s.Income[id] = v
			}
		}},
		{"orphan rental", func(s *devnetSnapshot) {
			for i, tx := range s.Pending {
				if tx.Hash == rtx.Hash {
					s.Pending = append(s.Pending[:i], s.Pending[i+1:]...)
					break
				}
			}
		}},
		{"duplicate transaction", func(s *devnetSnapshot) { s.Pending = append(s.Pending, rtx) }},
		{"policy bytes changed", func(s *devnetSnapshot) {
			for i, tx := range s.Pending {
				if tx.Hash == rtx.Hash {
					h, e := decodePQActionMemo(tx.Memo)
					pqMust(t, e)
					p := *h.Policy
					p.BandwidthUnitPrice++
					p = p.withCurrentHash()
					tx.Memo, e = encodePQActionMemo(h.Action, h.Wire, p)
					pqMust(t, e)
					s.Pending[i] = tx
				}
			}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var s devnetSnapshot
			pqMust(t, json.Unmarshal(raw, &s))
			tc.change(&s)
			if err := validateAccountPolicySnapshot(s); err == nil {
				t.Fatal("rewritten PQ proof/object coverage accepted")
			}
		})
	}
	h, err := decodePQActionMemo(rtx.Memo)
	pqMust(t, err)
	policyJSON, err := json.Marshal(h.Policy)
	pqMust(t, err)
	for _, bad := range [][]byte{append(bytes.Clone(policyJSON[:len(policyJSON)-1]), []byte(`,"unknown":1}`)...), append(bytes.Clone(policyJSON), []byte(` {}`)...), append([]byte(`{"id":"duplicate",`), policyJSON[1:]...)} {
		frame, err := ynxbatch.EncodeFields(h.Wire, bad)
		pqMust(t, err)
		if _, err := decodePQActionMemo(pqActionMemo + hex.EncodeToString(frame)); err == nil {
			t.Fatal("noncanonical policy JSON accepted")
		}
	}
}

func TestPQActionMutationDurabilityUnknownAndRollback(t *testing.T) {
	for _, kind := range []string{ynxauth.ActionStake, ynxauth.ActionResourceDelegate, ynxauth.ActionResourceRent, ynxauth.ActionDexAssetCreate} {
		for _, afterRename := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/afterRename=%t", kind, afterRename), func(t *testing.T) {
				f := newPQLedger(t)
				f.activate(t)
				var payload any
				fee := uint64(0)
				switch kind {
				case ynxauth.ActionStake:
					payload = ynxauth.StakePayload{Amount: 5}
				case ynxauth.ActionResourceDelegate:
					payload = f.actionDelegation("durability-delegation", 5)
				case ynxauth.ActionResourceRent:
					payload = f.actionRental(t, "durability-rental", ProtocolResourceProvider)
				case ynxauth.ActionDexAssetCreate:
					payload = ynxauth.DexAssetCreatePayload{AssetID: "durability-token", Symbol: "DUR", Name: "Durability token", MaxSupply: 100, InitialSupply: 10}
					fee = 1
				}
				wire := f.actionMember(t, kind, payload, 2, fee, 1)
				before := moduleBusinessState(t, f.d)
				path := f.d.snapshotPath() + ".tmp"
				if afterRename {
					path = f.d.snapshotIntegrityMarkerPath() + ".tmp"
				}
				unblock := blockSnapshotWrite(t, path)
				tx, replayed, err := f.d.SubmitPQAction(wire)
				if err == nil || replayed {
					t.Fatal("failed checkpoint falsely acknowledged action")
				}
				if afterRename {
					if !errors.Is(err, ErrSnapshotDurabilityUncertain) || tx.Hash == "" {
						t.Fatal("UNKNOWN did not retain original action")
					}
					retained := moduleBusinessState(t, f.d)
					if again, replay, err := f.d.SubmitPQAction(wire); !errors.Is(err, ErrSnapshotDurabilityUncertain) || replay || again.Hash != tx.Hash {
						t.Fatal("UNKNOWN retry replaced original result")
					}
					assertModuleState(t, f.d, retained)
					assertModuleState(t, readTransferSnapshot(t, f.d), retained)
				} else {
					if errors.Is(err, ErrSnapshotDurabilityUncertain) || tx.Hash != "" {
						t.Fatal("pre-rename failure did not roll back")
					}
					assertModuleState(t, f.d, before)
				}
				unblock()
				accepted, replayed, err := f.d.SubmitPQAction(wire)
				pqMust(t, err)
				if accepted.Hash != pqBatchHash(wire) || replayed != afterRename {
					t.Fatal("reconciliation changed wire identity or replay outcome")
				}
				account, _ := f.d.Account(f.owner)
				if account.Nonce != 2 {
					t.Fatal("action nonce consumed other than once")
				}
				restored, err := NewPersistentDevnet(f.d.cfg, f.d.dataDir)
				pqMust(t, err)
				assertModuleState(t, restored, moduleBusinessState(t, f.d))
			})
		}
	}
}

func TestPQActionNativeOverflowAndFeeProvenance(t *testing.T) {
	f := newPQLedger(t)
	f.activate(t)
	f.d.accounts[f.owner].Staked = math.MaxInt64
	before := moduleBusinessState(t, f.d)
	if _, _, err := f.d.SubmitPQAction(f.actionMember(t, ynxauth.ActionStake, ynxauth.StakePayload{Amount: 1}, 2, 0, 1)); err == nil {
		t.Fatal("stake overflow admitted")
	}
	assertModuleState(t, f.d, before)
	f.d.accounts[f.owner].Staked = 0
	f.d.accounts[f.owner].Lots = map[string]int64{}
	before = moduleBusinessState(t, f.d)
	asset := ynxauth.DexAssetCreatePayload{AssetID: "no-fee-lots", Symbol: "NFL", Name: "No fee lots", MaxSupply: 10, InitialSupply: 1}
	if _, _, err := f.d.SubmitPQAction(f.actionMember(t, ynxauth.ActionDexAssetCreate, asset, 2, 1, 1)); err == nil {
		t.Fatal("PQ action bypassed traceable fee lots")
	}
	assertModuleState(t, f.d, before)
}

func TestPQActionRentalPreservesActualSponsorReservations(t *testing.T) {
	f := newPQLedger(t)
	pool := ResourcePoolCreateInput{PoolType: "dapp", Name: "PQ reservation", Public: true, AllowedScopes: []string{"dapp_action"}, AllowedResourceTypes: []string{"bandwidth"}, PerActionLimit: ResourceUnits{Bandwidth: 10}, CumulativeAllowance: ResourceUnits{Bandwidth: 50}, ExpiresAt: time.Now().UTC().Add(time.Hour), IdempotencyKey: "pq-reservation-pool"}
	pool.Authorization = mustResourceAuthorization(t, f.classic, f.d.cfg.ChainID, ResourcePoolCreateAction, pool, 1)
	_, _, err := f.d.CreateResourcePool(pool)
	pqMust(t, err)
	_, _, err = f.d.SubmitAccountMigration(f.migration(t, 2, 2))
	pqMust(t, err)
	f.d.ProduceBlock()
	rental := f.actionRental(t, "reserved-rental", ProtocolResourceProvider)
	_, _, err = f.d.SubmitPQAction(f.actionMember(t, ynxauth.ActionResourceRent, rental, 3, 0, 1))
	pqMust(t, err)
	account, _ := f.d.Account(f.owner)
	if account.ResourceUsage.BandwidthUsed != 50 {
		t.Fatal("rental released capacity reserved by a real sponsor pool")
	}
	pqMust(t, validateAccountPolicySnapshot(pqBatchSnapshotCopy(t, f.d)))
}

func TestPQActionResourceDomainsIndependentVectors(t *testing.T) {
	// Independently generated using Node SHA256(JSON.stringify(exact typed
	// domain/action/value)) for the existing consensus resource request domain.
	const owner = "0x1234567890abcdef1234567890abcdef12345678"
	const recipient = "0xabcdef1234567890abcdef1234567890abcdef12"
	policy := strings.Repeat("ab", 32)
	d := ynxauth.ResourceDelegationPayload{Provider: owner, Beneficiary: recipient, AmountYNXT: 7, PolicyHash: policy, IdempotencyKey: "vector-delegate"}
	if pqDelegationRequestHash(d) != "4e206174e7af62f5d7673f6a030d90217f2b19b553ba8e9d5d206e23f06a4062" {
		t.Fatal("delegation request domain differs from existing typed resource contract")
	}
	r := ynxauth.ResourceRentalPayload{Address: owner, Provider: ProtocolResourceProvider, Bandwidth: 100, Compute: 10, AICredits: 1, TrustCredits: 2, QuoteID: "0123456789abcdef01234567", QuoteExpiresAt: "2030-01-02T03:04:05.123456789Z", PolicyHash: policy, MaxPriceYNXT: 99, IdempotencyKey: "vector-rental"}
	if pqRentalRequestHash(r) != "5d7dd1bed3644d8fcaa2364c5dd5c535d73d5daf0cb01acd282ce6bb03f33859" {
		t.Fatal("rental request domain differs from existing typed resource contract")
	}
	network := make([]byte, 32)
	for i := range network {
		network[i] = byte(i)
	}
	a := ynxauth.Action{ChainID: network, Owner: owner, Kind: ynxauth.ActionResourceDelegate}
	want := "bb21622e3908907c759a4888"
	if pqResourceObjectID(a, "vector-delegate") != want {
		t.Fatal("resource identity E vector mismatch")
	}
	for _, change := range []func(*ynxauth.Action){func(a *ynxauth.Action) { a.ChainID = bytes.Repeat([]byte{1}, 32) }, func(a *ynxauth.Action) { a.Owner = recipient }, func(a *ynxauth.Action) { a.Kind = ynxauth.ActionResourceRent }} {
		b := a
		change(&b)
		if pqResourceObjectID(b, "vector-delegate") == want {
			t.Fatal("resource identity omitted network, owner or operation")
		}
	}
	if pqResourceObjectID(a, "other-key") == want {
		t.Fatal("resource identity omitted idempotency key")
	}
}

func TestPQActionDexCheckedArithmetic(t *testing.T) {
	f := newPQLedger(t)
	f.activate(t)
	deadline := uint64(time.Now().Add(time.Hour).Unix())
	for _, tc := range []struct {
		name, kind      string
		reserve, shares int64
		payload         any
	}{
		{"liquidity reserve", ynxauth.ActionDexLiquidityAdd, math.MaxInt64 - 1, math.MaxInt64 - 1, ynxauth.DexLiquidityPayload{PoolID: "dex_boundary", Amount0: 2, Amount1: 2, MinShares: 1, DeadlineUnix: deadline}},
		{"liquidity shares", ynxauth.ActionDexLiquidityAdd, 100, math.MaxInt64 - 1, ynxauth.DexLiquidityPayload{PoolID: "dex_boundary", Amount0: 1, Amount1: 1, MinShares: 1, DeadlineUnix: deadline}},
		{"swap input reserve", ynxauth.ActionDexSwapExactInput, math.MaxInt64 - 100, 100, ynxauth.DexSwapExactInputPayload{PoolID: "dex_boundary", AssetIn: "asset-one", AmountIn: 1000, MinAmountOut: 1, DeadlineUnix: deadline}},
		{"swap output reserve", ynxauth.ActionDexSwapExactOutput, math.MaxInt64 - 100, 100, ynxauth.DexSwapExactOutputPayload{PoolID: "dex_boundary", AssetOut: "asset-two", AmountOut: 1000, MaxAmountIn: math.MaxInt64, DeadlineUnix: deadline}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f.d.dexPools["dex_boundary"] = NativeDexPool{ID: "dex_boundary", Asset0: "asset-one", Asset1: "asset-two", Reserve0: tc.reserve, Reserve1: tc.reserve, TotalShares: tc.shares, Shares: map[string]int64{f.owner: tc.shares}, FeeBps: 30}
			before := moduleBusinessState(t, f.d)
			_, _, err := f.d.SubmitPQAction(f.actionMember(t, tc.kind, tc.payload, 2, 1, 1))
			if err == nil || !strings.Contains(err.Error(), "overflow") {
				t.Fatalf("signed PQ numeric boundary did not reject overflow: %v", err)
			}
			assertModuleState(t, f.d, before)
		})
	}

	t.Run("native debit plus fee and lot sum", func(t *testing.T) {
		d := &Devnet{accounts: map[string]*Account{"owner": {Balance: math.MaxInt64, Lots: map[string]int64{"a": math.MaxInt64 - 1, "b": 2}}}}
		pool := NativeDexPool{Asset0: NativeDexAssetID}
		if err := d.requireNativeDexDebit(pool, true, "owner", math.MaxInt64); err == nil {
			t.Fatal("MaxInt64 native debit wrapped its additional fee")
		}
		if err := d.requireNativeDexDebit(pool, true, "owner", math.MaxInt64-1); err != nil {
			t.Fatalf("sufficient traceable lots overflowed aggregation: %v", err)
		}
	})
	for _, credit := range []bool{false, true} {
		t.Run(fmt.Sprintf("provenance lot credit=%t", credit), func(t *testing.T) {
			account := &Account{Balance: 10, Lots: map[string]int64{"lot": 2}}
			pool := NativeDexPool{Asset0: NativeDexAssetID, NativeLots0: map[string]int64{"lot": math.MaxInt64}}
			if credit {
				account.Lots["lot"], pool.NativeLots0["lot"] = math.MaxInt64, 2
			}
			d := &Devnet{accounts: map[string]*Account{"owner": account}}
			before, err := json.Marshal([]any{account, pool})
			pqMust(t, err)
			if credit {
				err = d.creditNativeDexFromPool(&pool, true, "owner", 2)
			} else {
				err = d.debitNativeDexToPool(&pool, true, "owner", 2)
			}
			if err == nil || !strings.Contains(err.Error(), "overflow") {
				t.Fatalf("provenance addition wrapped instead of rejecting: %v", err)
			}
			after, err := json.Marshal([]any{account, pool})
			pqMust(t, err)
			if !bytes.Equal(before, after) {
				t.Fatal("rejected one-lot overflow mutated provenance")
			}
		})
	}
}

func TestPQActionHistoricalSystemProjectionIsBound(t *testing.T) {
	f := newPQLedger(t)
	f.activate(t)
	// An actual preceding transaction gives both indices a nonzero position.
	// Their source is the containing block, not the log's own claims.
	_, err := f.d.Faucet(f.to, 1)
	pqMust(t, err)
	tx, _, err := f.d.SubmitPQAction(f.actionMember(t, ynxauth.ActionStake, ynxauth.StakePayload{Amount: 5}, 2, 0, 1))
	pqMust(t, err)
	pending := pqBatchSnapshotCopy(t, f.d)
	pqMust(t, validateAccountPolicySnapshot(pending))
	pendingRaw, err := json.Marshal(pending)
	pqMust(t, err)
	for _, change := range []func(*Transaction){
		func(tx *Transaction) { tx.Logs = []EVMLog{{TransactionHash: tx.Hash}} },
		func(tx *Transaction) { tx.BlockNum = 2 },
		func(tx *Transaction) { tx.BlockHash = strings.Repeat("a", 64) },
	} {
		var candidate devnetSnapshot
		pqMust(t, json.Unmarshal(pendingRaw, &candidate))
		change(&candidate.Pending[1])
		if err := validateAccountPolicySnapshot(candidate); err == nil {
			t.Fatal("pending action accepted caller-supplied logs or block inclusion")
		}
	}
	f.d.ProduceBlock()
	mined := pqBatchSnapshotCopy(t, f.d)
	pqMust(t, validateAccountPolicySnapshot(mined))
	blockIndex := len(mined.Blocks) - 1
	if len(mined.Blocks[blockIndex].Transactions) != 2 {
		t.Fatal("fixture lost the preceding transaction")
	}
	actual := mined.Blocks[blockIndex].Transactions[1]
	if actual.Hash != tx.Hash || len(actual.Logs) != 1 || actual.Logs[0].TransactionIndex != 1 || actual.Logs[0].LogIndex != 1 {
		t.Fatal("ProduceBlock did not emit the expected real system projection")
	}
	minedRaw, err := json.Marshal(mined)
	pqMust(t, err)
	for _, tc := range []struct {
		name string
		edit func(*Transaction)
	}{
		{"missing log", func(tx *Transaction) { tx.Logs = nil }},
		{"duplicate log", func(tx *Transaction) { tx.Logs = append(tx.Logs, tx.Logs[0]) }},
		{"log address", func(tx *Transaction) { tx.Logs[0].Address = f.to }},
		{"log data", func(tx *Transaction) { tx.Logs[0].Data = "0x00" }},
		{"log topic", func(tx *Transaction) { tx.Logs[0].Topics[0] = "0x" + strings.Repeat("0", 64) }},
		{"extra topic", func(tx *Transaction) { tx.Logs[0].Topics = append(tx.Logs[0].Topics, "0x00") }},
		{"log block hash", func(tx *Transaction) { tx.Logs[0].BlockHash = "0x" + strings.Repeat("0", 64) }},
		{"log block height", func(tx *Transaction) { tx.Logs[0].BlockNumber++ }},
		{"transaction block hash", func(tx *Transaction) {
			tx.BlockHash = strings.Repeat("b", 64)
			tx.Logs[0].BlockHash = evmHash(tx.BlockHash)
		}},
		{"transaction block height", func(tx *Transaction) {
			tx.BlockNum++
			tx.Logs[0].BlockNumber = tx.BlockNum
		}},
		{"log transaction hash", func(tx *Transaction) { tx.Logs[0].TransactionHash = "0x" + strings.Repeat("0", 64) }},
		{"log transaction index", func(tx *Transaction) { tx.Logs[0].TransactionIndex = 0 }},
		{"log global index", func(tx *Transaction) { tx.Logs[0].LogIndex = 0 }},
		{"log removed", func(tx *Transaction) { tx.Logs[0].Removed = true }},
		{"sponsor", func(tx *Transaction) { tx.Sponsor = f.to }},
		{"sponsor pool", func(tx *Transaction) { tx.SponsorPoolID = "unsigned-pool" }},
		{"resource source", func(tx *Transaction) { tx.ResourceSource = "unsigned-source" }},
		{"resource type", func(tx *Transaction) { tx.ResourceType = "bandwidth" }},
		{"resource consumed", func(tx *Transaction) { tx.ResourceConsumed = 1 }},
		{"action reference", func(tx *Transaction) { tx.ActionReference = "unsigned-reference" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var candidate devnetSnapshot
			pqMust(t, json.Unmarshal(minedRaw, &candidate))
			tc.edit(&candidate.Blocks[blockIndex].Transactions[1])
			if err := validateAccountPolicySnapshot(candidate); err == nil {
				t.Fatal("rewritten system projection or unsigned metadata accepted")
			}
		})
	}
	// A block-global index depends on all preceding logs, including non-PQ
	// transactions; checking just the current transaction's index is insufficient.
	mined.Blocks[blockIndex].Transactions[0].Logs = append(mined.Blocks[blockIndex].Transactions[0].Logs, mined.Blocks[blockIndex].Transactions[0].Logs[0])
	if err := validateAccountPolicySnapshot(mined); err == nil {
		t.Fatal("PQ log global index ignored changed preceding log coverage")
	}
}
