package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"math"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func pqResourceDelegation(f *abciRevocationFixture, other bool, beneficiary string, amount uint64, key string) ynxauth.ResourceDelegationPayload {
	owner := f.owner
	if other {
		owner = f.other
	}
	p := ynxauth.ResourceDelegationPayload{Provider: owner, Beneficiary: beneficiary, AmountYNXT: amount, PolicyHash: f.m.ResourcePolicy.PolicyHash, IdempotencyKey: key}
	p.RequestHash = ResourceDelegationRequestHash(p.Provider, p.Beneficiary, int64(p.AmountYNXT), p.PolicyHash, p.IdempotencyKey)
	return p
}
func pqResourceRental(t *testing.T, f *abciRevocationFixture, other bool, provider string, bw, compute uint64, key string, height int64) ynxauth.ResourceRentalPayload {
	t.Helper()
	owner := f.owner
	if other {
		owner = f.other
	}
	expires := time.Date(2030, 1, 1, 0, 0, int(height), 0, time.UTC).Add(time.Minute)
	quote, err := chain.ResourceQuoteForPolicy(f.m.ResourcePolicy, owner, int64(bw), int64(compute), 0, 0, expires)
	if err != nil {
		t.Fatal(err)
	}
	p := ynxauth.ResourceRentalPayload{Address: owner, Provider: provider, Bandwidth: bw, Compute: compute, QuoteID: quote.ID, QuoteExpiresAt: expires.Format(time.RFC3339Nano), PolicyHash: f.m.ResourcePolicy.PolicyHash, MaxPriceYNXT: uint64(quote.PriceYNXT), IdempotencyKey: key}
	pqResourceRentalHash(&p)
	return p
}
func pqResourceRentalHash(p *ynxauth.ResourceRentalPayload) {
	expires, _ := time.Parse(time.RFC3339Nano, p.QuoteExpiresAt)
	p.RequestHash = ResourceRentalRequestHash(p.Address, p.Provider, int64(p.Bandwidth), int64(p.Compute), int64(p.AICredits), int64(p.TrustCredits), p.QuoteID, expires, p.PolicyHash, int64(p.MaxPriceYNXT), p.IdempotencyKey)
}
func pqABCIResource(t *testing.T, f *abciRevocationFixture, other bool, payload any, nonce, fee uint64) []byte {
	t.Helper()
	owner, key := f.owner, f.key
	if other {
		owner, key = f.other, f.otherKey
	}
	kind := ynxauth.ActionResourceDelegate
	if _, ok := payload.(ynxauth.ResourceRentalPayload); ok {
		kind = ynxauth.ActionResourceRent
	}
	wire := pqABCIContractWire(t, f, key, owner, kind, payload, nonce, fee)
	raw, err := EncodePQNativeActionTransaction(wire)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
func pqResourceCold(t *testing.T, f *abciRevocationFixture) {
	t.Helper()
	cold, err := NewPersistentApplication(f.m, f.path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(mustJSON(t, cold.committed), mustJSON(t, f.a.committed)) {
		t.Fatal("resource full state changed on cold restore")
	}
}

func TestABCIPQResourceClassicAndPQShareBusinessWithDistinctFees(t *testing.T) {
	f := newABCIRevocationFixture(t)
	legacy := ResourceDelegationPayload{Provider: f.other, Beneficiary: f.other, AmountYNXT: 20, PolicyHash: f.m.ResourcePolicy.PolicyHash, IdempotencyKey: "classic-provider"}
	legacy.RequestHash = ResourceDelegationRequestHash(legacy.Provider, legacy.Beneficiary, legacy.AmountYNXT, legacy.PolicyHash, legacy.IdempotencyKey)
	beforeClassic, feeBefore := queryConsensusAccount(t, f.a, f.other), queryConsensusAccount(t, f.a, f.a.feeRecipient)
	pqABCIContractBlock(t, f.a, 2, mustResourceAction(t, f.otherClassic, ActionResourceDelegate, legacy, 1), mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
	afterClassic := queryConsensusAccount(t, f.a, f.other)
	if afterClassic.Balance != beforeClassic.Balance-21 || afterClassic.Staked != beforeClassic.Staked+20 || afterClassic.Nonce != 1 || afterClassic.ResourceUsage.BandwidthUsed != beforeClassic.ResourceUsage.BandwidthUsed+1 || !reflect.DeepEqual(afterClassic.Lots, beforeClassic.Lots) {
		t.Fatal("classic resource semantics changed")
	}
	// Registration fee is also one, independent of this classic resource fee.
	if queryConsensusAccount(t, f.a, f.a.feeRecipient).Balance != feeBefore.Balance+2 {
		t.Fatal("classic resource fee was omitted or doubled")
	}
	pqResourceCold(t, f)
	before := queryConsensusAccount(t, f.a, f.owner)
	feeBefore = queryConsensusAccount(t, f.a, f.a.feeRecipient)
	delegation := pqABCIResource(t, f, false, pqResourceDelegation(f, false, f.other, 5, "pq-to-beneficiary"), 2, 0)
	rental := pqResourceRental(t, f, false, f.other, 10, 2, "pq-rent-provider", 3)
	rawRental := pqABCIResource(t, f, false, rental, 3, 0)
	pqABCIContractBlock(t, f.a, 3, delegation, rawRental, pqABCIStake(t, f, false, 2, 4, 0))
	after := queryConsensusAccount(t, f.a, f.owner)
	if after.Balance != before.Balance-7-int64(rental.MaxPriceYNXT) || after.Nonce != 4 || after.Staked != before.Staked+2 || after.ResourceUsage.ComputeUsed != 1 || after.ResourceUsage.BandwidthUsed != maxZero(before.ResourceUsage.BandwidthUsed-10) || !reflect.DeepEqual(after.Lots, before.Lots) || !reflect.DeepEqual(queryConsensusAccount(t, f.a, f.a.feeRecipient), feeBefore) {
		t.Fatal("PQ Resource fee-zero/bandwidth-zero, actual stake/rental or preserved lots differ")
	}
	if queryConsensusAccount(t, f.a, f.other).Staked != 25 {
		t.Fatal("signed delegation beneficiary was not credited")
	}
	for _, income := range f.a.committed.ResourceIncome {
		if income.PQTransactionHash == "" {
			t.Fatal("PQ rental income lost original wire binding")
		}
	}
	pqABCIContractRejected(t, f.a, rawRental)
	pqResourceCold(t, f)
	// Later owner revocation must not invalidate the legitimate earlier records.
	pqABCIContractBlock(t, f.a, 4, mustPQEnvelope(t, PQRevocationType, f.revocation(t, 5, 4, 1)))
	pqABCIContractRejected(t, f.a, pqABCIResource(t, f, false, pqResourceDelegation(f, false, f.owner, 1, "revoked-resource"), 6, 0))
	legacy.Provider, legacy.Beneficiary, legacy.IdempotencyKey = f.owner, f.owner, "revoked-classic"
	legacy.RequestHash = ResourceDelegationRequestHash(legacy.Provider, legacy.Beneficiary, legacy.AmountYNXT, legacy.PolicyHash, legacy.IdempotencyKey)
	pqABCIContractRejected(t, f.a, mustResourceAction(t, f.classic, ActionResourceDelegate, legacy, 6))
	// An unrelated still-classic owner keeps its original business entrypoint.
	legacy.Provider, legacy.Beneficiary, legacy.AmountYNXT, legacy.IdempotencyKey = f.other, f.other, 1, "other-still-legal"
	legacy.RequestHash = ResourceDelegationRequestHash(legacy.Provider, legacy.Beneficiary, legacy.AmountYNXT, legacy.PolicyHash, legacy.IdempotencyKey)
	pqABCIContractBlock(t, f.a, 5, mustResourceAction(t, f.otherClassic, ActionResourceDelegate, legacy, 2))
	otherRegistration := abciRegistrationWire(t, f.otherClassic, nil, f.otherKey, ynxauth.RegistrationIntent{ChainID: f.network, Owner: f.other, PKA: f.otherPublic.PKA, PKB: f.otherPublic.PKB, NewRevision: 1, LedgerNonce: 3, ActivateAt: 7})
	pqABCIContractBlock(t, f.a, 6, mustPQEnvelope(t, PQMigrationType, otherRegistration))
	pqABCIContractBlock(t, f.a, 7, pqABCIResource(t, f, true, pqResourceDelegation(f, true, f.other, 1, "other-active-v2"), 4, 0))
	pqResourceCold(t, f)
}

func TestABCIPQResourceOrderedRentalCannotEraseLaterStakeOrContract(t *testing.T) {
	f := newABCIRevocationFixture(t)
	pqABCIContractBlock(t, f.a, 2, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
	artifact, _ := pqABCIContractDeploy(t, f, ynxauth.ContractCounterName) // nonce2, compute5, bandwidth1
	rental := pqResourceRental(t, f, false, chain.ProtocolResourceProvider, 100, 10, "release-prior-only", 4)
	pqABCIContractBlock(t, f.a, 4, pqABCIStake(t, f, false, 1, 3, 0), pqABCIResource(t, f, false, rental, 4, 0), pqABCIStake(t, f, false, 1, 5, 0), pqABCIContractCall(t, f, artifact, pqABCIContractData(artifact.Name, f.other, 1), 6))
	after := queryConsensusAccount(t, f.a, f.owner)
	if after.ResourceUsage.ComputeUsed != 2 || after.ResourceUsage.BandwidthUsed != 1 {
		t.Fatal("rental must reduce prior usage, retaining subsequent stake and real contract usage")
	}
	pqResourceCold(t, f)
	for _, field := range []string{"compute", "bandwidth"} {
		var bad CommittedState
		if err := json.Unmarshal(mustJSON(t, f.a.committed), &bad); err != nil {
			t.Fatal(err)
		}
		i, _ := accountIndex(bad.Accounts, f.owner)
		if field == "compute" {
			bad.Accounts[i].ResourceUsage.ComputeUsed--
		} else {
			bad.Accounts[i].ResourceUsage.BandwidthUsed--
		}
		bad.AppHash, _ = bad.calculateHash()
		if err := bad.Validate(f.m); err == nil {
			t.Fatalf("earlier rental erased later %s", field)
		}
	}
}

func TestABCIPQResourceOriginalANDActivationAndAtomicRejections(t *testing.T) {
	f := newABCIRevocationFixture(t)
	p := pqResourceDelegation(f, false, f.owner, 5, "original-delegate")
	valid := pqABCIResource(t, f, false, p, 2, 0)
	pqABCIContractRejected(t, f.a, valid)
	pqABCIContractBlock(t, f.a, 2, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 4)))
	pqABCIContractRejected(t, f.a, valid)
	pqABCIContractBlock(t, f.a, 3)
	wire, _, err := DecodePQNativeActionTransaction(valid)
	if err != nil {
		t.Fatal(err)
	}
	for _, part := range []string{"A", "B"} {
		member, err := ynxbatch.DecodeMember(wire)
		if err != nil {
			t.Fatal(err)
		}
		if part == "A" {
			member.Certificate.SigmaA[0] ^= 1
		} else {
			member.Certificate.SigmaB[0] ^= 1
		}
		bad, err := ynxbatch.EncodeMember(member)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := EncodePQNativeActionTransaction(bad)
		if err != nil {
			t.Fatal(err)
		}
		pqABCIContractRejected(t, f.a, raw)
	}
	pqABCIContractRejected(t, f.a, pqABCIResource(t, f, false, p, 3, 0))
	pqABCIContractRejected(t, f.a, pqABCIResource(t, f, false, p, 2, 1))
	pqABCIContractRejected(t, f.a, pqABCIResource(t, f, false, pqResourceDelegation(f, false, f.owner, 100, "insufficient-resource"), 2, 0))
	stale := p
	stale.PolicyHash = strings.Repeat("a", 64)
	stale.RequestHash = ResourceDelegationRequestHash(stale.Provider, stale.Beneficiary, int64(stale.AmountYNXT), stale.PolicyHash, stale.IdempotencyKey)
	pqABCIContractRejected(t, f.a, pqABCIResource(t, f, false, stale, 2, 0))
	badRequest := p
	badRequest.RequestHash = strings.Repeat("0", 64)
	pqABCIContractRejected(t, f.a, pqABCIResource(t, f, false, badRequest, 2, 0))
	wrongWire := pqABCIContractWire(t, f, f.otherKey, f.owner, ynxauth.ActionResourceDelegate, p, 2, 0)
	wrong, _ := EncodePQNativeActionTransaction(wrongWire)
	pqABCIContractRejected(t, f.a, wrong)
	missing := pqResourceRental(t, f, false, f.other, 1, 1, "missing-provider", 4)
	pqABCIContractRejected(t, f.a, pqABCIResource(t, f, false, missing, 2, 0))
	tooCheap := pqResourceRental(t, f, false, chain.ProtocolResourceProvider, 1000, 0, "under-max-price", 4)
	tooCheap.MaxPriceYNXT--
	pqResourceRentalHash(&tooCheap)
	pqABCIContractRejected(t, f.a, pqABCIResource(t, f, false, tooCheap, 2, 0))
	alteredNetwork := *f
	alteredNetwork.m = f.m
	alteredNetwork.m.Network.ChainID++
	pqABCIContractRejected(t, f.a, pqABCIResource(t, &alteredNetwork, false, p, 2, 0))
	for _, field := range []string{"stake", "nonce"} {
		candidate := f.a.cloneExecutionState()
		i, _ := accountIndex(candidate.accounts, f.owner)
		if field == "stake" {
			candidate.accounts[i].Staked = math.MaxInt64
		} else {
			candidate.accounts[i].Nonce = math.MaxUint64
		}
		beforeAccounts, beforeHistory := mustJSON(t, candidate.accounts), mustJSON(t, candidate.pqHistory)
		if _, _, err := f.a.applyPQResourceAction(candidate, valid, 4, time.Unix(4, 0).UTC()); err == nil {
			t.Fatalf("accepted %s overflow", field)
		}
		if !bytes.Equal(beforeAccounts, mustJSON(t, candidate.accounts)) || !bytes.Equal(beforeHistory, mustJSON(t, candidate.pqHistory)) {
			t.Fatal("rejected Resource action modified caller candidate")
		}
	}
	pqABCIContractBlock(t, f.a, 4, valid)
	// A second signed request cannot reuse the committed idempotency key.
	pqABCIContractRejected(t, f.a, pqABCIResource(t, f, false, p, 3, 0))
	expired := pqResourceRental(t, f, false, chain.ProtocolResourceProvider, 1, 1, "expired-real-quote", 5)
	expired.QuoteExpiresAt = time.Date(2030, 1, 1, 0, 0, 5, 0, time.UTC).Format(time.RFC3339Nano)
	exp, _ := time.Parse(time.RFC3339Nano, expired.QuoteExpiresAt)
	q, err := chain.ResourceQuoteForPolicy(f.m.ResourcePolicy, f.owner, 1, 1, 0, 0, exp)
	if err != nil {
		t.Fatal(err)
	}
	expired.QuoteID = q.ID
	pqResourceRentalHash(&expired)
	raw := pqABCIResource(t, f, false, expired, 3, 0)
	before := mustJSON(t, f.a.committed)
	proposal, err := f.a.ProcessProposal(context.Background(), &abcitypes.RequestProcessProposal{Height: 5, Time: exp, Txs: [][]byte{raw}})
	if err != nil || proposal.Status != abcitypes.ResponseProcessProposal_REJECT || !bytes.Equal(before, mustJSON(t, f.a.committed)) {
		t.Fatalf("expired resource proposal: %+v %v", proposal, err)
	}
	pqResourceCold(t, f)
}

func TestABCIPQResourceResealedProofRecordAndOrderTampering(t *testing.T) {
	f := newABCIRevocationFixture(t)
	pqABCIContractBlock(t, f.a, 2, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
	d := pqABCIResource(t, f, false, pqResourceDelegation(f, false, f.owner, 10, "provider-original"), 2, 0)
	r := pqABCIResource(t, f, false, pqResourceRental(t, f, false, f.owner, 1000, 0, "self-rent-original", 3), 3, 0)
	pqABCIContractBlock(t, f.a, 3, d, r, pqABCIStake(t, f, false, 1, 4, 0))
	for _, mode := range []string{"owner", "amount", "fee", "nonce", "sponsor", "resource", "flow", "log", "marker", "request", "beneficiary", "income", "quote", "expiry", "erase-proof", "erase-proof-and-markers", "event-order", "proof-order", "false-fee", "usage", "final-nonce"} {
		t.Run(mode, func(t *testing.T) {
			var bad CommittedState
			if err := json.Unmarshal(mustJSON(t, f.a.committed), &bad); err != nil {
				t.Fatal(err)
			}
			entry := &bad.PQHistory[2] // migration, delegation, rental, stake
			switch mode {
			case "owner":
				entry.Transaction.From = f.other
			case "amount":
				entry.Transaction.Amount++
			case "fee":
				entry.Transaction.Fee = 1
			case "nonce":
				entry.Transaction.Nonce++
			case "sponsor":
				entry.Transaction.Sponsor = f.other
			case "resource":
				entry.Transaction.ResourceConsumed = 1
			case "flow":
				entry.Transaction.LotFlows = []chain.LotFlow{{LotID: "forged", From: f.owner, To: f.other, Amount: 1}}
			case "log":
				entry.Transaction.Logs = []chain.EVMLog{{Address: f.owner}}
			case "marker":
				bad.ResourceRentals[0].PQTransactionHash = strings.Repeat("a", 64)
				bad.ResourceRentals[0].AuditHash = resourceRentalAuditHash(bad.ResourceRentals[0])
			case "request":
				bad.ResourceRentals[0].RequestHash = strings.Repeat("b", 64)
				bad.ResourceRentals[0].AuditHash = resourceRentalAuditHash(bad.ResourceRentals[0])
			case "beneficiary":
				bad.ResourceDelegations[0].Beneficiary = f.other
				bad.ResourceDelegations[0].AuditHash = resourceDelegationAuditHash(bad.ResourceDelegations[0])
				i, _ := accountIndex(bad.Accounts, f.owner)
				j, _ := accountIndex(bad.Accounts, f.other)
				bad.Accounts[i].Staked -= 10
				bad.Accounts[j].Staked += 10
			case "income":
				bad.ResourceIncome[0].PQTransactionHash = ""
				bad.ResourceIncome[0].AuditHash = resourceIncomeAuditHash(bad.ResourceIncome[0])
			case "quote":
				bad.ResourceQuotes[0].ExpiresAt = bad.ResourceQuotes[0].ExpiresAt.Add(time.Second)
				bad.ResourceQuotes[0].AuditHash = resourceQuoteAuditHash(bad.ResourceQuotes[0])
			case "expiry":
				entry.Transaction.Timestamp = bad.ResourceQuotes[0].ExpiresAt
			case "erase-proof":
				bad.PQHistory = append(bad.PQHistory[:2], bad.PQHistory[3:]...)
			case "erase-proof-and-markers":
				bad.PQHistory = append(bad.PQHistory[:2], bad.PQHistory[3:]...)
				bad.ResourceRentals[0].PQTransactionHash = ""
				bad.ResourceRentals[0].AuditHash = resourceRentalAuditHash(bad.ResourceRentals[0])
				for i := range bad.ResourceIncome {
					bad.ResourceIncome[i].PQTransactionHash = ""
					bad.ResourceIncome[i].AuditHash = resourceIncomeAuditHash(bad.ResourceIncome[i])
				}
			case "event-order":
				bad.ResourceEvents[0], bad.ResourceEvents[1] = bad.ResourceEvents[1], bad.ResourceEvents[0]
			case "proof-order":
				bad.PQHistory[1], bad.PQHistory[2] = bad.PQHistory[2], bad.PQHistory[1]
			case "false-fee":
				bad.FeeEvents = append(bad.FeeEvents, newCurrentFeeEvent(entry.ABCITransactionHash, PQActionType, f.owner, f.a.feeRecipient, 1, 3, entry.Transaction.Timestamp))
			case "usage":
				i, _ := accountIndex(bad.Accounts, f.owner)
				bad.Accounts[i].ResourceUsage.ComputeUsed = 0
			case "final-nonce":
				i, _ := accountIndex(bad.Accounts, f.owner)
				bad.Accounts[i].Nonce++
			}
			var err error
			bad.AppHash, err = bad.calculateHash()
			if err != nil {
				t.Fatal(err)
			}
			if err := bad.Validate(f.m); err == nil {
				t.Fatalf("resealed Resource %s survived full restore validation", mode)
			}
		})
	}
	pqResourceCold(t, f)
}

func TestABCIPQResourceRentalSettlementAliasOverflowAndRollback(t *testing.T) {
	f := newABCIRevocationFixture(t)
	pqABCIContractBlock(t, f.a, 2, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)), mustPQEnvelope(t, PQMigrationType, f.registration(t, true, 3)))
	pqABCIContractBlock(t, f.a, 3, pqABCIResource(t, f, false, pqResourceDelegation(f, false, f.owner, 10, "self-provider"), 2, 0), pqABCIResource(t, f, true, pqResourceDelegation(f, true, f.other, 10, "other-provider"), 2, 0))
	// A real self-provider rental uses net settlement; it does not mint the
	// provider share or charge the same account twice.
	p := pqResourceRental(t, f, false, f.owner, 1000, 0, "self-alias-rent", 4)
	before, treasury := queryConsensusAccount(t, f.a, f.owner), queryConsensusAccount(t, f.a, chain.ProtocolResourceTreasury)
	pqABCIContractBlock(t, f.a, 4, pqABCIResource(t, f, false, p, 3, 0))
	after := queryConsensusAccount(t, f.a, f.owner)
	fee := int64(p.MaxPriceYNXT) - resourceBasisPoints(int64(p.MaxPriceYNXT), f.m.ResourcePolicy.ProviderShareBps)
	if after.Balance != before.Balance-fee || queryConsensusAccount(t, f.a, chain.ProtocolResourceTreasury).Balance != treasury.Balance+fee || !reflect.DeepEqual(after.Lots, before.Lots) {
		t.Fatal("self-provider net settlement or lots changed")
	}
	for _, target := range []string{f.other, chain.ProtocolResourceTreasury} {
		rental := pqResourceRental(t, f, false, f.other, 1000, 0, "overflow-recipient", 5)
		raw := pqABCIResource(t, f, false, rental, 4, 0)
		candidate := f.a.cloneExecutionState()
		candidate.accounts, _ = ensureAccount(candidate.accounts, target)
		i, _ := accountIndex(candidate.accounts, target)
		candidate.accounts[i].Balance = math.MaxInt64
		accounts, events, history := mustJSON(t, candidate.accounts), mustJSON(t, candidate.resourceEvents), mustJSON(t, candidate.pqHistory)
		if _, _, err := f.a.applyPQResourceAction(candidate, raw, 5, time.Date(2030, 1, 1, 0, 0, 5, 0, time.UTC)); err == nil {
			t.Fatal("rental accepted settlement overflow")
		}
		if !bytes.Equal(accounts, mustJSON(t, candidate.accounts)) || !bytes.Equal(events, mustJSON(t, candidate.resourceEvents)) || !bytes.Equal(history, mustJSON(t, candidate.pqHistory)) {
			t.Fatal("overflow mutated original candidate")
		}
	}
	// Reusing the same quote with a fresh nonce/key used to overwrite its
	// single record and leave a state which could not be restored.
	reused := p
	reused.IdempotencyKey = "same-quote-new-key"
	pqResourceRentalHash(&reused)
	pqABCIContractRejected(t, f.a, pqABCIResource(t, f, false, reused, 4, 0))
	pqResourceCold(t, f)
}

func TestABCIPQResourceCommitFailureRetainsOriginalUnknownCandidate(t *testing.T) {
	for _, afterRename := range []bool{false, true} {
		t.Run(map[bool]string{false: "before-rename", true: "after-rename"}[afterRename], func(t *testing.T) {
			f := newABCIRevocationFixture(t)
			pqABCIContractBlock(t, f.a, 2, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
			raw := pqABCIResource(t, f, false, pqResourceDelegation(f, false, f.other, 5, "persist-original"), 2, 0)
			before := mustJSON(t, f.a.committed)
			diskBefore, err := os.ReadFile(f.path)
			if err != nil {
				t.Fatal(err)
			}
			ctx := context.Background()
			result, err := f.a.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: 3, Time: time.Unix(3, 0).UTC(), Txs: [][]byte{raw}})
			if err != nil || len(result.TxResults) != 1 || result.TxResults[0].Code != 0 {
				t.Fatalf("real Resource finalize: %+v %v", result, err)
			}
			pending := mustJSON(t, f.a.pending)
			injected := errors.New("resource checkpoint failure")
			f.a.persistenceHooks = &committedPersistenceHooks{}
			if afterRename {
				f.a.persistenceHooks.syncDirectory = func(string) error { return injected }
			} else {
				f.a.persistenceHooks.beforeRename = func() error { return injected }
			}
			_, err = f.a.Commit(ctx, &abcitypes.RequestCommit{})
			if !errors.Is(err, injected) || errors.Is(err, ErrCommittedStateDurabilityUncertain) != afterRename || !bytes.Equal(before, mustJSON(t, f.a.committed)) || !bytes.Equal(pending, mustJSON(t, f.a.pending)) {
				t.Fatalf("resource lost original candidate or UNKNOWN: %v", err)
			}
			if _, err := f.a.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: 3, Txs: [][]byte{raw}}); err == nil {
				t.Fatal("unresolved original commit permitted reexecution")
			}
			if afterRename {
				cold, err := NewPersistentApplication(f.m, f.path)
				if err != nil || !bytes.Equal(pending, mustJSON(t, cold.committed)) {
					t.Fatalf("durable original Resource candidate lost: %v", err)
				}
			} else {
				disk, err := os.ReadFile(f.path)
				if err != nil || !bytes.Equal(disk, diskBefore) {
					t.Fatal("pre-rename failure changed disk")
				}
			}
			f.a.persistenceHooks = nil
			if _, err := f.a.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(pending, mustJSON(t, f.a.committed)) {
				t.Fatal("retry changed or reapplied original Resource intent")
			}
			pqABCIContractRejected(t, f.a, raw)
			pqResourceCold(t, f)
		})
	}
}

func TestABCIPQResourcePreservesLiveReservationAndSourceDelegation(t *testing.T) {
	t.Run("live-reservation", func(t *testing.T) {
		f := newABCIRevocationFixture(t)
		create := ResourcePoolCreatePayload{PoolType: "dapp", Name: "Resource reservation", Public: true, AllowedScopes: []string{"dapp_action"}, AllowedResourceTypes: []string{"bandwidth", "compute"}, PerActionLimit: chain.ResourceUnits{Bandwidth: 1, Compute: 1}, CumulativeAllowance: chain.ResourceUnits{Bandwidth: 12, Compute: 5}, ExpiresAt: time.Date(2031, 1, 1, 0, 0, 0, 0, time.UTC), IdempotencyKey: "reserve-before-pq"}
		pqABCIContractBlock(t, f.a, 2, mustResourceAction(t, f.classic, ActionResourcePoolCreate, create, 1))
		registration := abciRegistrationWire(t, f.classic, nil, f.key, ynxauth.RegistrationIntent{ChainID: f.network, Owner: f.owner, PKA: f.public.PKA, PKB: f.public.PKB, NewRevision: 1, LedgerNonce: 2, ActivateAt: 4})
		pqABCIContractBlock(t, f.a, 3, mustPQEnvelope(t, PQMigrationType, registration))
		rental := pqResourceRental(t, f, false, chain.ProtocolResourceProvider, 100, 10, "rent-with-reservation", 4)
		pqABCIContractBlock(t, f.a, 4, pqABCIResource(t, f, false, rental, 3, 0), pqABCIStake(t, f, false, 1, 4, 0))
		after := queryConsensusAccount(t, f.a, f.owner)
		if after.ResourceUsage.BandwidthUsed != 12 || after.ResourceUsage.ComputeUsed != 6 {
			t.Fatal("rental erased reservation or subsequent stake")
		}
		pqResourceCold(t, f)
		var bad CommittedState
		if err := json.Unmarshal(mustJSON(t, f.a.committed), &bad); err != nil {
			t.Fatal(err)
		}
		i, _ := accountIndex(bad.Accounts, f.owner)
		bad.Accounts[i].ResourceUsage.ComputeUsed = 5
		bad.AppHash, _ = bad.calculateHash()
		if err := bad.Validate(f.m); err == nil {
			t.Fatal("reservation minimum hid deletion of subsequent stake cost")
		}
	})
	t.Run("source-provider", func(t *testing.T) {
		f := newABCIRevocationFixture(t)
		if _, _, _, err := f.d.DelegateResources(f.other, f.other, 10); err != nil {
			t.Fatal(err)
		}
		f.d.ProduceBlock()
		var err error
		f.m, err = f.d.ExportConsensusMigrationState()
		if err != nil {
			t.Fatal(err)
		}
		f.path = f.path + ".source"
		f.a, err = NewPersistentApplication(f.m, f.path)
		if err != nil {
			t.Fatal(err)
		}
		pqABCIContractBlock(t, f.a, 3, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 4)))
		before := mustJSON(t, f.a.committed.LegacyResourceMarket)
		p := pqResourceRental(t, f, false, f.other, 100, 10, "anchored-source-provider", 4)
		pqABCIContractBlock(t, f.a, 4, pqABCIResource(t, f, false, p, 2, 0))
		if !bytes.Equal(before, mustJSON(t, f.a.committed.LegacyResourceMarket)) {
			t.Fatal("PQ rental rewrote imported legacy source records")
		}
		pqResourceCold(t, f)
	})
}

func TestABCISharedClassicResourceFeeOverflowIsAtomic(t *testing.T) {
	f := newABCIRevocationFixture(t)
	p := ResourceDelegationPayload{Provider: f.other, Beneficiary: f.other, AmountYNXT: 1, PolicyHash: f.m.ResourcePolicy.PolicyHash, IdempotencyKey: "classic-fee-overflow"}
	p.RequestHash = ResourceDelegationRequestHash(p.Provider, p.Beneficiary, p.AmountYNXT, p.PolicyHash, p.IdempotencyKey)
	raw := mustResourceAction(t, f.otherClassic, ActionResourceDelegate, p, 1)
	candidate := f.a.cloneExecutionState()
	i, _ := accountIndex(candidate.accounts, f.a.feeRecipient)
	candidate.accounts[i].Balance = math.MaxInt64
	before := mustJSON(t, candidate.accounts)
	if _, _, err := f.a.applyTransaction(candidate, raw, 2, time.Unix(2, 0).UTC()); err == nil {
		t.Fatal("real classic proof accepted recipient fee overflow")
	}
	if !bytes.Equal(before, mustJSON(t, candidate.accounts)) || len(candidate.resourceEvents) != 0 || len(candidate.resourceDelegations) != 0 {
		t.Fatal("classic rejected fee mutated original state")
	}
}
