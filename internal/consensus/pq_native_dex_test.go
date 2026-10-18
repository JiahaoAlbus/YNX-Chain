package consensus

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func pqABCIDex(t *testing.T, f *abciRevocationFixture, other bool, kind string, payload any, nonce, fee uint64) []byte {
	t.Helper()
	owner, key := f.owner, f.key
	if other {
		owner, key = f.other, f.otherKey
	}
	wire := pqABCIContractWire(t, f, key, owner, kind, payload, nonce, fee)
	raw, err := EncodePQNativeActionTransaction(wire)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
func pqDexCreate(id, symbol string) ynxauth.DexAssetCreatePayload {
	return ynxauth.DexAssetCreatePayload{AssetID: id, Symbol: symbol, Name: "Actual PQ Test Token", Decimals: 6, MaxSupply: 100000, InitialSupply: 50000}
}
func pqDexDeadline() uint64 { return uint64(time.Date(2031, 1, 1, 0, 0, 0, 0, time.UTC).Unix()) }
func pqDexLifecycle(t *testing.T, f *abciRevocationFixture) {
	t.Helper()
	pqABCIContractBlock(t, f.a, 2, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)), mustPQEnvelope(t, PQMigrationType, f.registration(t, true, 3)))
	txs := [][]byte{
		pqABCIDex(t, f, false, ynxauth.ActionDexAssetCreate, pqDexCreate("pq-token", "PQT"), 2, 1),
		pqABCIDex(t, f, false, ynxauth.ActionDexAssetMint, ynxauth.DexAssetAmountPayload{AssetID: "pq-token", Amount: 1000}, 3, 1),
		pqABCIDex(t, f, false, ynxauth.ActionDexAssetTransfer, ynxauth.DexAssetTransferPayload{AssetID: "pq-token", Recipient: f.other, Amount: 1000}, 4, 1),
		pqABCIDex(t, f, false, ynxauth.ActionDexPoolCreate, ynxauth.DexPoolCreatePayload{PoolID: "dex_pq_native", Asset0: DexNativeAssetID, Asset1: "pq-token", FeeBps: 30}, 5, 1),
		pqABCIDex(t, f, false, ynxauth.ActionDexLiquidityAdd, ynxauth.DexLiquidityPayload{PoolID: "dex_pq_native", Amount0: 20, Amount1: 2000, MinShares: 200, DeadlineUnix: pqDexDeadline()}, 6, 1),
		pqABCIDex(t, f, true, ynxauth.ActionDexSwapExactInput, ynxauth.DexSwapExactInputPayload{PoolID: "dex_pq_native", AssetIn: "pq-token", AmountIn: 500, MinAmountOut: 1, DeadlineUnix: pqDexDeadline()}, 2, 1),
		pqABCIDex(t, f, true, ynxauth.ActionDexSwapExactOutput, ynxauth.DexSwapExactOutputPayload{PoolID: "dex_pq_native", AssetOut: "pq-token", AmountOut: 100, MaxAmountIn: 10, DeadlineUnix: pqDexDeadline()}, 3, 1),
		pqABCIDex(t, f, false, ynxauth.ActionDexLiquidityRemove, ynxauth.DexLiquidityRemovePayload{PoolID: "dex_pq_native", Shares: 20, MinAmount0: 1, MinAmount1: 1, DeadlineUnix: pqDexDeadline()}, 7, 1),
	}
	pqABCIContractBlock(t, f.a, 3, txs...)
}

func TestABCIPQDexAllEightKindsRealFeesLotsHistoryRevocationAndRestart(t *testing.T) {
	f := newABCIRevocationFixture(t)
	feeBefore := queryConsensusAccount(t, f.a, f.a.feeRecipient)
	pqDexLifecycle(t, f)
	state := f.a.committed
	if len(state.DexEvents) != 8 || len(state.DexAssets) != 1 || state.DexAssets[0].TotalSupply != 51000 || len(state.DexPools) != 1 || state.DexPools[0].TotalShares != 180 {
		t.Fatal("complete typed DEX lifecycle did not execute")
	}
	if queryConsensusAccount(t, f.a, f.a.feeRecipient).Balance != feeBefore.Balance+10 {
		t.Fatal("DEX fee-one was omitted or charged twice")
	}
	owner, other := queryConsensusAccount(t, f.a, f.owner), queryConsensusAccount(t, f.a, f.other)
	if owner.Nonce != 7 || other.Nonce != 3 || owner.ResourceUsage.BandwidthUsed != 7 || other.ResourceUsage.BandwidthUsed != 3 {
		t.Fatal("DEX nonce or fee bandwidth differs from real executions")
	}
	var feeFlows int64
	for _, entry := range state.PQHistory {
		if !isPQDexHistory(entry.Transaction) {
			continue
		}
		if entry.Transaction.Fee != 1 || len(entry.Transaction.LotFlows) == 0 {
			t.Fatal("DEX failed to execute fee lots")
		}
		for _, flow := range entry.Transaction.LotFlows {
			feeFlows += flow.Amount
			if flow.To != f.a.feeRecipient || flow.From != entry.Transaction.From {
				t.Fatal("DEX fee lot recipient changed")
			}
		}
	}
	if feeFlows != 8 {
		t.Fatal("DEX fee lot total differs")
	}
	for _, event := range state.DexEvents {
		if event.PQTransactionHash == "" || event.ClassicAuthorization != "" {
			t.Fatal("PQ event lost original Member binding")
		}
	}
	pqResourceCold(t, f)
	pqABCIContractBlock(t, f.a, 4, mustPQEnvelope(t, PQRevocationType, f.revocation(t, 8, 4, 1)))
	bad := pqABCIDex(t, f, false, ynxauth.ActionDexAssetMint, ynxauth.DexAssetAmountPayload{AssetID: "pq-token", Amount: 1}, 9, 1)
	pqABCIContractRejected(t, f.a, bad)
	pqABCIContractRejected(t, f.a, signedAssetAction(t, f.classic, ActionDexAssetMint, DexAssetAmountPayload{AssetID: "pq-token", Amount: 1}, 9))
	before := dexBalanceAmount(f.a.committed.DexBalances, "pq-token", f.other)
	pqABCIContractBlock(t, f.a, 5, pqABCIDex(t, f, true, ynxauth.ActionDexAssetTransfer, ynxauth.DexAssetTransferPayload{AssetID: "pq-token", Recipient: f.other, Amount: 1}, 4, 1))
	if dexBalanceAmount(f.a.committed.DexBalances, "pq-token", f.other) != before {
		t.Fatal("DEX self transfer minted tokens")
	}
	pqResourceCold(t, f)
}

func TestABCIPQDexClassicInterleavingRetainsOriginalProofsAndColdReplay(t *testing.T) {
	f := newABCIRevocationFixture(t)
	create := DexAssetCreatePayload{AssetID: "classic-token", Symbol: "CLT", Name: "Original classic", Decimals: 6, MaxSupply: 10000, InitialSupply: 1000}
	classic := signedAssetAction(t, f.otherClassic, ActionDexAssetCreate, create, 1)
	pqABCIContractBlock(t, f.a, 2, classic, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
	// Classic fee semantics retain their original behavior; new PQ fees move
	// traceable lots. Both paths reach the same DEX business implementation.
	if f.a.committed.DexEvents[0].ClassicAuthorization != hex.EncodeToString(classic) {
		t.Fatal("classic original wire was not retained")
	}
	pqABCIContractBlock(t, f.a, 3,
		pqABCIDex(t, f, false, ynxauth.ActionDexAssetCreate, pqDexCreate("second-token", "SCT"), 2, 1),
		signedAssetAction(t, f.otherClassic, ActionDexAssetTransfer, DexAssetTransferPayload{AssetID: "classic-token", Recipient: f.owner, Amount: 200}, 2),
		pqABCIDex(t, f, false, ynxauth.ActionDexAssetTransfer, ynxauth.DexAssetTransferPayload{AssetID: "classic-token", Recipient: f.other, Amount: 50}, 3, 1))
	if dexBalanceAmount(f.a.committed.DexBalances, "classic-token", f.owner) != 150 {
		t.Fatal("classic/PQ shared token ledger diverged")
	}
	pqABCIContractBlock(t, f.a, 4,
		pqABCIDex(t, f, false, ynxauth.ActionDexPoolCreate, ynxauth.DexPoolCreatePayload{PoolID: "dex_classic_pq", Asset0: DexNativeAssetID, Asset1: "classic-token", FeeBps: 30}, 4, 1),
		pqABCIDex(t, f, false, ynxauth.ActionDexLiquidityAdd, ynxauth.DexLiquidityPayload{PoolID: "dex_classic_pq", Amount0: 10, Amount1: 100, MinShares: 31, DeadlineUnix: pqDexDeadline()}, 5, 1))
	pqResourceCold(t, f)
	pqABCIContractBlock(t, f.a, 5,
		signedAssetAction(t, f.otherClassic, ActionDexSwapExactInput, DexSwapExactInputPayload{PoolID: "dex_classic_pq", AssetIn: "classic-token", AmountIn: 50, MinAmountOut: 1, DeadlineUnix: int64(pqDexDeadline())}, 3),
		pqABCIDex(t, f, false, ynxauth.ActionDexSwapExactOutput, ynxauth.DexSwapExactOutputPayload{PoolID: "dex_classic_pq", AssetOut: "classic-token", AmountOut: 5, MaxAmountIn: 10, DeadlineUnix: pqDexDeadline()}, 6, 1))
	pqResourceCold(t, f)
	clone := cloneBFTDexEvents(f.a.committed.DexEvents)
	candidate := f.a.cloneExecutionState()
	original := mustJSON(t, f.a.committed)
	for i := range clone {
		if len(clone[i].NativeFlows) > 0 {
			clone[i].NativeFlows[0].Amount++
			if reflect.DeepEqual(clone, f.a.committed.DexEvents) {
				t.Fatal("DEX native flow clone aliases original")
			}
			candidate.dexEvents[i].NativeFlows[0].Amount++
			if !bytes.Equal(original, mustJSON(t, f.a.committed)) {
				t.Fatal("application execution clone aliases committed DEX native flows")
			}
			break
		}
	}
}

func TestABCIPQDexRejectsBadOriginalAuthorityAndAtomicBusinessFailures(t *testing.T) {
	f := newABCIRevocationFixture(t)
	valid := pqABCIDex(t, f, false, ynxauth.ActionDexAssetCreate, pqDexCreate("pq-token", "PQT"), 2, 1)
	pqABCIContractRejected(t, f.a, valid)
	pqABCIContractBlock(t, f.a, 2, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 4)))
	pqABCIContractRejected(t, f.a, valid)
	pqABCIContractBlock(t, f.a, 3)
	wire, _, err := DecodePQNativeActionTransaction(valid)
	if err != nil {
		t.Fatal(err)
	}
	for _, part := range []string{"A", "B"} {
		m, err := ynxbatch.DecodeMember(wire)
		if err != nil {
			t.Fatal(err)
		}
		if part == "A" {
			m.Certificate.SigmaA[0] ^= 1
		} else {
			m.Certificate.SigmaB[0] ^= 1
		}
		bad, err := ynxbatch.EncodeMember(m)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := EncodePQNativeActionTransaction(bad)
		if err != nil {
			t.Fatal(err)
		}
		pqABCIContractRejected(t, f.a, raw)
	}
	// Valid signatures from the wrong current pair or a different network are
	// rejected at the real ABCI gateway, even though all business fields fit.
	wrongPair := pqABCIContractWire(t, f, f.otherKey, f.owner, ynxauth.ActionDexAssetCreate, pqDexCreate("pq-token", "PQT"), 2, 1)
	wrongPairRaw, err := EncodePQNativeActionTransaction(wrongPair)
	if err != nil {
		t.Fatal(err)
	}
	pqABCIContractRejected(t, f.a, wrongPairRaw)
	otherNetwork := *f
	otherNetwork.network = bytes.Clone(f.network)
	otherNetwork.network[0] ^= 1
	pqABCIContractRejected(t, f.a, pqABCIDex(t, &otherNetwork, false, ynxauth.ActionDexAssetCreate, pqDexCreate("pq-token", "PQT"), 2, 1))
	otherChain := *f
	otherChain.m.Network.ChainID++
	pqABCIContractRejected(t, f.a, pqABCIDex(t, &otherChain, false, ynxauth.ActionDexAssetCreate, pqDexCreate("pq-token", "PQT"), 2, 1))
	for _, raw := range [][]byte{
		pqABCIDex(t, f, false, ynxauth.ActionDexAssetCreate, pqDexCreate("pq-token", "PQT"), 3, 1),
		pqABCIDex(t, f, false, ynxauth.ActionDexAssetCreate, pqDexCreate("pq-token", "PQT"), 2, 0),
		pqABCIDex(t, f, false, ynxauth.ActionDexAssetCreate, pqDexCreate("pq-token", "PQT"), 2, 2),
	} {
		pqABCIContractRejected(t, f.a, raw)
	}
	pqABCIContractBlock(t, f.a, 4, valid)
	pqABCIContractRejected(t, f.a, valid)
	pqABCIContractRejected(t, f.a, pqABCIDex(t, f, false, ynxauth.ActionDexAssetMint, ynxauth.DexAssetAmountPayload{AssetID: "pq-token", Amount: 100000}, 3, 1))
	candidate := f.a.cloneExecutionState()
	i, _ := accountIndex(candidate.accounts, f.owner)
	candidate.accounts[i].Lots = nil
	before := mustJSON(t, candidate.accounts)
	if _, _, err := f.a.applyPQDexAction(candidate, pqABCIDex(t, f, false, ynxauth.ActionDexAssetMint, ynxauth.DexAssetAmountPayload{AssetID: "pq-token", Amount: 1}, 3, 1), 5, time.Unix(5, 0).UTC()); err == nil || !bytes.Equal(before, mustJSON(t, candidate.accounts)) {
		t.Fatal("DEX missing fee lots accepted or original candidate changed")
	}
	// Failure after charge/partial business work leaves every original branch.
	pool := pqABCIDex(t, f, false, ynxauth.ActionDexPoolCreate, ynxauth.DexPoolCreatePayload{PoolID: "dex_atomic", Asset0: DexNativeAssetID, Asset1: "pq-token", FeeBps: 30}, 3, 1)
	pqABCIContractBlock(t, f.a, 5, pool)
	fail := pqABCIDex(t, f, false, ynxauth.ActionDexLiquidityAdd, ynxauth.DexLiquidityPayload{PoolID: "dex_atomic", Amount0: 10, Amount1: 1000000, MinShares: 1, DeadlineUnix: pqDexDeadline()}, 4, 1)
	candidate = f.a.cloneExecutionState()
	accounts, pools, assets, balances, events := mustJSON(t, candidate.accounts), mustJSON(t, candidate.dexPools), mustJSON(t, candidate.dexAssets), mustJSON(t, candidate.dexBalances), mustJSON(t, candidate.dexEvents)
	if _, _, err := f.a.applyPQDexAction(candidate, fail, 6, time.Unix(6, 0).UTC()); err == nil {
		t.Fatal("DEX insufficient second asset accepted")
	}
	if !bytes.Equal(accounts, mustJSON(t, candidate.accounts)) || !bytes.Equal(pools, mustJSON(t, candidate.dexPools)) || !bytes.Equal(assets, mustJSON(t, candidate.dexAssets)) || !bytes.Equal(balances, mustJSON(t, candidate.dexBalances)) || !bytes.Equal(events, mustJSON(t, candidate.dexEvents)) {
		t.Fatal("DEX partial failure mutated sibling candidate")
	}
	pqResourceCold(t, f)
}

func TestABCIPQDexResealedHistoryCompleteBusinessAndFeeTampering(t *testing.T) {
	f := newABCIRevocationFixture(t)
	pqDexLifecycle(t, f)
	for _, mode := range []string{"owner", "fee", "amount", "nonce", "system-metadata", "fee-flow", "fee-lineage", "native-flow", "native-recipient", "extra-flow", "pool", "shares", "issuer", "mint", "recipient", "erase-proof", "erase-marker", "event-order", "proof-order", "bandwidth", "final-nonce", "duplicate-fee"} {
		t.Run(mode, func(t *testing.T) {
			var bad CommittedState
			if err := json.Unmarshal(mustJSON(t, f.a.committed), &bad); err != nil {
				t.Fatal(err)
			}
			entry := &bad.PQHistory[6]
			switch mode {
			case "owner":
				entry.Transaction.From = f.other
			case "fee":
				entry.Transaction.Fee = 0
			case "amount":
				entry.Transaction.Amount = 1
			case "nonce":
				entry.Transaction.Nonce++
			case "system-metadata":
				entry.Transaction.Sponsor = f.other
			case "fee-flow":
				entry.Transaction.LotFlows = nil
			case "fee-lineage":
				entry.Transaction.LotFlows[0].LotID = "uncommitted-lineage"
			case "native-flow":
				bad.DexEvents[4].NativeFlows = nil
				bad.DexEvents[4].AuditHash = dexEventAuditHash(bad.DexEvents[4])
			case "native-recipient":
				bad.DexEvents[4].NativeFlows[0].From = f.other
				bad.DexEvents[4].AuditHash = dexEventAuditHash(bad.DexEvents[4])
			case "extra-flow":
				bad.DexEvents[0].NativeFlows = append([]chain.LotFlow(nil), bad.DexEvents[4].NativeFlows...)
				bad.DexEvents[0].AuditHash = dexEventAuditHash(bad.DexEvents[0])
			case "pool":
				bad.DexPools[0].Reserve0++
				for id := range bad.DexPools[0].NativeLots0 {
					bad.DexPools[0].NativeLots0[id]++
					break
				}
				bad.DexPools[0].AuditHash = dexPoolAuditHash(bad.DexPools[0])
				i, _ := accountIndex(bad.Accounts, f.owner)
				bad.Accounts[i].Balance--
			case "shares":
				bad.DexPools[0].Shares[0].Shares--
				bad.DexPools[0].TotalShares--
				bad.DexPools[0].AuditHash = dexPoolAuditHash(bad.DexPools[0])
			case "issuer":
				bad.DexAssets[0].Issuer = f.other
				bad.DexAssets[0].AuditHash = dexAssetAuditHash(bad.DexAssets[0])
			case "mint":
				bad.DexAssets[0].TotalSupply++
				bad.DexAssets[0].AuditHash = dexAssetAuditHash(bad.DexAssets[0])
				i, _ := dexBalanceIndex(bad.DexBalances, "pq-token", f.owner)
				bad.DexBalances[i].Amount++
			case "recipient":
				i, _ := dexBalanceIndex(bad.DexBalances, "pq-token", f.owner)
				j, _ := dexBalanceIndex(bad.DexBalances, "pq-token", f.other)
				bad.DexBalances[i].Amount--
				bad.DexBalances[j].Amount++
			case "erase-proof":
				bad.PQHistory = append(bad.PQHistory[:6], bad.PQHistory[7:]...)
			case "erase-marker":
				bad.PQHistory = append(bad.PQHistory[:6], bad.PQHistory[7:]...)
				bad.DexEvents[4].PQTransactionHash = ""
				bad.DexEvents[4].AuditHash = dexEventAuditHash(bad.DexEvents[4])
			case "event-order":
				bad.DexEvents[5], bad.DexEvents[6] = bad.DexEvents[6], bad.DexEvents[5]
			case "proof-order":
				bad.PQHistory[7], bad.PQHistory[8] = bad.PQHistory[8], bad.PQHistory[7]
			case "bandwidth":
				i, _ := accountIndex(bad.Accounts, f.owner)
				bad.Accounts[i].ResourceUsage.BandwidthUsed = 0
			case "final-nonce":
				i, _ := accountIndex(bad.Accounts, f.owner)
				bad.Accounts[i].Nonce++
			case "duplicate-fee":
				bad.FeeEvents = append(bad.FeeEvents, newCurrentFeeEvent(entry.ABCITransactionHash, PQActionType, f.owner, f.a.feeRecipient, 1, 3, entry.Transaction.Timestamp))
			}
			var err error
			bad.AppHash, err = bad.calculateHash()
			if err != nil {
				t.Fatal(err)
			}
			if err := bad.Validate(f.m); err == nil {
				t.Fatalf("resealed DEX %s bypassed original proof/business/fee replay", mode)
			}
		})
	}
	pqResourceCold(t, f)
}

func TestABCIPQDexOldOpaqueHistoryLoadsButCannotInventPQPrestate(t *testing.T) {
	f := newABCIRevocationFixture(t)
	oldRaw := signedAssetAction(t, f.otherClassic, ActionDexAssetCreate, DexAssetCreatePayload{AssetID: "old-token", Symbol: "OLD", Name: "Old actual asset", Decimals: 6, MaxSupply: 10000, InitialSupply: 1000}, 1)
	pqABCIContractBlock(t, f.a, 2, oldRaw, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
	// Preserve the exact effect and original hash, but encode the event in the
	// pre-upgrade representation that did not store classic transaction bytes.
	legacy := f.a.committed
	legacy.DexEvents = cloneBFTDexEvents(legacy.DexEvents)
	legacy.DexEvents[0].ClassicAuthorization = ""
	legacy.DexEvents[0].NativeFlows = nil
	legacy.DexEvents[0].AuditHash = dexEventAuditHash(legacy.DexEvents[0])
	legacy.AppHash, _ = legacy.calculateHash()
	if err := saveCommittedState(f.path, legacy, f.m); err != nil {
		t.Fatal(err)
	}
	var err error
	f.a, err = NewPersistentApplication(f.m, f.path)
	if err != nil {
		t.Fatal(err)
	}
	if f.a.committed.DexEvents[0].ClassicAuthorization != "" || f.a.committed.DexAssets[0].TotalSupply != 1000 {
		t.Fatal("old history was fabricated or erased")
	}
	pqABCIContractRejected(t, f.a, pqABCIDex(t, f, false, ynxauth.ActionDexAssetCreate, pqDexCreate("new-token", "NEW"), 2, 1))
	pqABCIContractBlock(t, f.a, 3, signedAssetAction(t, f.otherClassic, ActionDexAssetMint, DexAssetAmountPayload{AssetID: "old-token", Amount: 1}, 2))
	if f.a.committed.DexAssets[0].TotalSupply != 1001 || f.a.committed.DexEvents[0].ClassicAuthorization != "" {
		t.Fatal("old lawful classic path changed or invented missing original")
	}
	pqResourceCold(t, f)
}

func TestABCIPQDexTrustedSourceMigrationSupportsActualPQSwap(t *testing.T) {
	f := newABCIRevocationFixture(t)
	actions := []struct {
		kind    string
		payload any
	}{
		{ActionDexAssetCreate, DexAssetCreatePayload{AssetID: "source-token", Symbol: "SRC", Name: "Source DEX", Decimals: 6, MaxSupply: 10000, InitialSupply: 5000}},
		{ActionDexAssetTransfer, DexAssetTransferPayload{AssetID: "source-token", Recipient: f.owner, Amount: 1000}},
		{ActionDexPoolCreate, DexPoolCreatePayload{PoolID: "dex_source", Asset0: DexNativeAssetID, Asset1: "source-token", FeeBps: 30}},
		{ActionDexLiquidityAdd, DexLiquidityPayload{PoolID: "dex_source", Amount0: 20, Amount1: 2000, MinShares: 200, DeadlineUnix: int64(pqDexDeadline())}},
	}
	for i, input := range actions {
		tx, err := NewSignedApplicationAction(f.otherClassic, f.m.Network.ChainID, input.kind, input.payload, uint64(i+1))
		if err != nil {
			t.Fatal(err)
		}
		// Same real original classic verification as the existing source HTTP
		// gateway, followed by its existing source native DEX adapter.
		if err := tx.Verify(f.m.Network.ChainID); err != nil {
			t.Fatal(err)
		}
		raw, err := EncodeSignedApplicationAction(tx)
		if err != nil {
			t.Fatal(err)
		}
		if _, _, _, err := f.d.SubmitNativeDexAction(chain.NativeDexSignedActionInput{Hash: ApplicationActionHash(raw), Signer: tx.Signer, Action: tx.Action, Nonce: tx.Nonce, Fee: tx.Fee, Payload: tx.Payload}); err != nil {
			t.Fatal(err)
		}
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
	before := cloneBFTDexEvents(f.a.committed.DexEvents)
	pqABCIContractBlock(t, f.a, 3, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 4)))
	pqABCIContractBlock(t, f.a, 4, pqABCIDex(t, f, false, ynxauth.ActionDexSwapExactInput, ynxauth.DexSwapExactInputPayload{PoolID: "dex_source", AssetIn: "source-token", AmountIn: 500, MinAmountOut: 1, DeadlineUnix: pqDexDeadline()}, 2, 1))
	if !reflect.DeepEqual(before, f.a.committed.DexEvents[:len(before)]) {
		t.Fatal("PQ source import rewrote original native DEX history")
	}
	pqResourceCold(t, f)
}

func TestABCIPQDexCommitFailureKeepsOriginalUnknownAndAtomicRollback(t *testing.T) {
	for _, afterRename := range []bool{false, true} {
		t.Run(map[bool]string{false: "before-rename", true: "after-rename"}[afterRename], func(t *testing.T) {
			f := newABCIRevocationFixture(t)
			pqABCIContractBlock(t, f.a, 2, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
			raw := pqABCIDex(t, f, false, ynxauth.ActionDexAssetCreate, pqDexCreate("persist-token", "PST"), 2, 1)
			before := mustJSON(t, f.a.committed)
			diskBefore, err := os.ReadFile(f.path)
			if err != nil {
				t.Fatal(err)
			}
			ctx := context.Background()
			result, err := f.a.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: 3, Time: time.Unix(3, 0).UTC(), Txs: [][]byte{raw}})
			if err != nil || len(result.TxResults) != 1 || result.TxResults[0].Code != 0 {
				t.Fatalf("DEX actual finalize: %+v %v", result, err)
			}
			pending := mustJSON(t, f.a.pending)
			injected := errors.New("DEX checkpoint failure")
			f.a.persistenceHooks = &committedPersistenceHooks{}
			if afterRename {
				f.a.persistenceHooks.syncDirectory = func(string) error { return injected }
			} else {
				f.a.persistenceHooks.beforeRename = func() error { return injected }
			}
			_, err = f.a.Commit(ctx, &abcitypes.RequestCommit{})
			if !errors.Is(err, injected) || errors.Is(err, ErrCommittedStateDurabilityUncertain) != afterRename || !bytes.Equal(before, mustJSON(t, f.a.committed)) || !bytes.Equal(pending, mustJSON(t, f.a.pending)) {
				t.Fatalf("DEX original candidate/UNKNOWN changed: %v", err)
			}
			if _, err := f.a.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: 3, Txs: [][]byte{raw}}); err == nil {
				t.Fatal("DEX UNKNOWN permitted resubmission")
			}
			if afterRename {
				cold, err := NewPersistentApplication(f.m, f.path)
				if err != nil || !bytes.Equal(pending, mustJSON(t, cold.committed)) {
					t.Fatalf("durable original DEX candidate failed restore: %v", err)
				}
			} else {
				disk, err := os.ReadFile(f.path)
				if err != nil || !bytes.Equal(disk, diskBefore) {
					t.Fatal("DEX pre-rename changed disk")
				}
			}
			f.a.persistenceHooks = nil
			if _, err := f.a.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(pending, mustJSON(t, f.a.committed)) {
				t.Fatal("DEX retry reapplied or changed original")
			}
			pqABCIContractRejected(t, f.a, raw)
			pqResourceCold(t, f)
		})
	}
}

func TestABCIPQDexFeeCapacityIssuerSlippageAndDeadline(t *testing.T) {
	f := newABCIRevocationFixture(t)
	pqDexLifecycle(t, f)
	pqABCIContractRejected(t, f.a, pqABCIDex(t, f, true, ynxauth.ActionDexAssetMint, ynxauth.DexAssetAmountPayload{AssetID: "pq-token", Amount: 1}, 4, 1))
	pqABCIContractRejected(t, f.a, pqABCIDex(t, f, true, ynxauth.ActionDexSwapExactInput, ynxauth.DexSwapExactInputPayload{PoolID: "dex_pq_native", AssetIn: "pq-token", AmountIn: 1, MinAmountOut: 1000, DeadlineUnix: pqDexDeadline()}, 4, 1))
	for _, field := range []string{"fee-balance", "fee-recipient", "nonce", "bandwidth"} {
		candidate := f.a.cloneExecutionState()
		i, _ := accountIndex(candidate.accounts, f.owner)
		j, _ := accountIndex(candidate.accounts, f.a.feeRecipient)
		switch field {
		case "fee-balance":
			candidate.accounts[i].Balance = 0
		case "fee-recipient":
			candidate.accounts[j].Balance = math.MaxInt64
		case "nonce":
			candidate.accounts[i].Nonce = math.MaxUint64
		case "bandwidth":
			candidate.accounts[i].ResourceUsage.BandwidthUsed = math.MaxInt64
		}
		before := mustJSON(t, candidate.accounts)
		raw := pqABCIDex(t, f, false, ynxauth.ActionDexAssetMint, ynxauth.DexAssetAmountPayload{AssetID: "pq-token", Amount: 1}, 8, 1)
		if _, _, err := f.a.applyPQDexAction(candidate, raw, 4, time.Unix(4, 0).UTC()); err == nil || !bytes.Equal(before, mustJSON(t, candidate.accounts)) {
			t.Fatalf("DEX %s was accepted or mutated caller", field)
		}
	}
	expired := pqABCIDex(t, f, true, ynxauth.ActionDexSwapExactInput, ynxauth.DexSwapExactInputPayload{PoolID: "dex_pq_native", AssetIn: "pq-token", AmountIn: 100, MinAmountOut: 1, DeadlineUnix: 1}, 4, 1)
	response, err := f.a.ProcessProposal(context.Background(), &abcitypes.RequestProcessProposal{Height: 4, Time: time.Unix(5, 0).UTC(), Txs: [][]byte{expired}})
	if err != nil || response.Status != abcitypes.ResponseProcessProposal_REJECT {
		t.Fatalf("expired PQ DEX proposal: %+v %v", response, err)
	}
}

// This is the pre-extension JSON/audit vector, not a substitute authorization
// fixture. The integration tests above execute genuine original signatures.
func TestABCIDexOptionalProofFieldsPreserveOldJSONAndAudit(t *testing.T) {
	const original = `{"id":"legacy-dex-vector","type":"dex_asset_transfer","signer":"ynx-legacy-owner","asset0":"legacy-token","amount0":7,"blockHeight":12,"occurredAt":"2030-01-01T00:00:12Z","txHash":"abababababababababababababababababababababababababababababababab","auditHash":"5dde60cd97d8bfdcf465535eb1adb277b5463e72eec2e45412216e14f741a98c"}`
	var event BFTDexEvent
	if err := json.Unmarshal([]byte(original), &event); err != nil {
		t.Fatal(err)
	}
	if event.ClassicAuthorization != "" || event.PQTransactionHash != "" || event.NativeFlows != nil || dexEventAuditHash(event) != event.AuditHash || string(mustJSON(t, event)) != original {
		t.Fatal("optional DEX proof fields changed old JSON or audit identity")
	}
	event.NativeFlows = []chain.LotFlow{}
	if string(mustJSON(t, event)) != original || dexEventAuditHash(event) != event.AuditHash {
		t.Fatal("empty optional DEX native flows changed old encoding")
	}
}

func TestABCIPQDexClassicOriginalFeeAndNonceCannotBeResealed(t *testing.T) {
	f := newABCIRevocationFixture(t)
	classic := signedAssetAction(t, f.otherClassic, ActionDexAssetCreate, DexAssetCreatePayload{AssetID: "classic-token", Symbol: "CLT", Name: "Original classic", Decimals: 6, MaxSupply: 10000, InitialSupply: 1000}, 1)
	pqABCIContractBlock(t, f.a, 2, classic, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
	pqABCIContractBlock(t, f.a, 3, pqABCIDex(t, f, false, ynxauth.ActionDexAssetCreate, pqDexCreate("pq-token", "PQT"), 2, 1))
	for _, mode := range []string{"fee-erased", "fee-recipient", "classic-account-nonce", "original-erased", "original-signature"} {
		t.Run(mode, func(t *testing.T) {
			var bad CommittedState
			if err := json.Unmarshal(mustJSON(t, f.a.committed), &bad); err != nil {
				t.Fatal(err)
			}
			switch mode {
			case "fee-erased":
				for i, fee := range bad.FeeEvents {
					if fee.TxHash == ApplicationActionHash(classic) {
						bad.FeeEvents = append(bad.FeeEvents[:i], bad.FeeEvents[i+1:]...)
						break
					}
				}
			case "fee-recipient":
				for i, fee := range bad.FeeEvents {
					if fee.TxHash == ApplicationActionHash(classic) {
						bad.FeeEvents[i].Recipient = f.owner
						bad.FeeEvents[i].AuditHash = feeEventAuditHash(bad.FeeEvents[i])
					}
				}
			case "classic-account-nonce":
				i, _ := accountIndex(bad.Accounts, f.other)
				bad.Accounts[i].Nonce = 0
			case "original-erased":
				bad.DexEvents[0].ClassicAuthorization = ""
				bad.DexEvents[0].AuditHash = dexEventAuditHash(bad.DexEvents[0])
			case "original-signature":
				tx, err := DecodeSignedApplicationAction(classic)
				if err != nil {
					t.Fatal(err)
				}
				sig, err := hex.DecodeString(tx.Signature)
				if err != nil || len(sig) == 0 {
					t.Fatal("missing actual classic signature")
				}
				sig[len(sig)-1] ^= 1
				tx.Signature = hex.EncodeToString(sig)
				// Rebind the envelope hash and every associated public record;
				// only the genuine original signature can reject this forgery.
				raw := mustJSON(t, tx)
				hash := ApplicationActionHash(raw)
				bad.DexEvents[0].ClassicAuthorization = hex.EncodeToString(raw)
				bad.DexEvents[0].TxHash = hash
				bad.DexEvents[0].ID = ApplicationActionRecordID("dex-event", hash)
				bad.DexEvents[0].AuditHash = dexEventAuditHash(bad.DexEvents[0])
				for i := range bad.DexAssets {
					if bad.DexAssets[i].ID == "classic-token" {
						bad.DexAssets[i].TxHash = hash
						bad.DexAssets[i].AuditHash = dexAssetAuditHash(bad.DexAssets[i])
					}
				}
				for i, fee := range bad.FeeEvents {
					if fee.TxHash == ApplicationActionHash(classic) {
						bad.FeeEvents[i] = newCurrentFeeEvent(hash, tx.Action, tx.Signer, f.a.feeRecipient, tx.Fee, 2, bad.DexEvents[0].OccurredAt)
					}
				}
			}
			var err error
			bad.AppHash, err = bad.calculateHash()
			if err != nil {
				t.Fatal(err)
			}
			if err := bad.Validate(f.m); err == nil {
				t.Fatalf("resealed classic DEX %s accepted", mode)
			}
		})
	}
	pqResourceCold(t, f)
}
