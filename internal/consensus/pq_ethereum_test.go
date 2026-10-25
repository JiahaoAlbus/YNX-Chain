package consensus

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abci "github.com/cometbft/cometbft/abci/types"
)

// Genuine faucet history funds the existing integer-gas business profile. No
// fixture mutates an account balance, policy record or migration anchor.
func newPQEthereumFixture(t *testing.T) *abciRevocationFixture {
	t.Helper()
	f := newABCIRevocationFixture(t)
	for _, owner := range []string{f.owner, f.other} {
		if _, err := f.d.Faucet(owner, 1_000_000); err != nil {
			t.Fatal(err)
		}
	}
	f.d.ProduceBlock()
	var err error
	f.m, err = f.d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	f.path = filepath.Join(t.TempDir(), "ethereum-state.json")
	f.a, err = NewPersistentApplication(f.m, f.path)
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func pqEthereumIntent(f *abciRevocationFixture, kind uint32, nonce, value uint64) ynxauth.EthereumValueIntent {
	v := ynxauth.EthereumValueIntent{Profile: ynxauth.EthereumABCIIntegerGasProfile, ChainID: bytes.Clone(f.network), NativeChainID: uint64(f.m.Network.ChainID), Owner: f.owner, TxType: kind, To: f.other, Value: value, Nonce: nonce, GasLimit: 21000, GasPrice: 1}
	if kind == 1 {
		v.GasPrice = 2
	}
	if kind == 2 {
		v.GasPrice, v.MaxPriorityFeePerGas, v.MaxFeePerGas = 0, 1, 4
	}
	return v
}

func pqEthereumMembers(t *testing.T, f *abciRevocationFixture, intents ...ynxauth.EthereumValueIntent) (raw, wires [][]byte) {
	t.Helper()
	messages := make([][]byte, len(intents))
	for i, intent := range intents {
		var err error
		messages[i], err = intent.SigningBytes()
		if err != nil {
			t.Fatal(err)
		}
	}
	batch, err := ynxbatch.BatchSign(f.key, ynxbatch.Metadata{ChainID: f.network, Owner: f.owner, Purpose: ynxauth.TransactionPurpose}, messages, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		t.Fatal(err)
	}
	defer batch.Discard()
	for i := range messages {
		member, err := ynxbatch.Extract(batch, uint32(i))
		if err != nil {
			t.Fatal(err)
		}
		wire, err := ynxbatch.EncodeMember(member)
		if err != nil {
			t.Fatal(err)
		}
		wires = append(wires, wire)
		raw = append(raw, mustPQEnvelope(t, PQEthereumValueType, wire))
	}
	return raw, wires
}

func pqEthereumActivate(t *testing.T, f *abciRevocationFixture) int64 {
	t.Helper()
	h := f.a.committed.Height + 1
	pqABCIContractBlock(t, f.a, h, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, uint64(h+1))))
	return h + 1
}

func pqEthereumLast(t *testing.T, state CommittedState) PQCommittedAuthorization {
	t.Helper()
	for i := len(state.PQHistory) - 1; i >= 0; i-- {
		if isPQEthereumValueHistory(state.PQHistory[i].Transaction) {
			return state.PQHistory[i]
		}
	}
	t.Fatal("actual PQ Ethereum proof is missing")
	return PQCommittedAuthorization{}
}

func TestABCIPQEthereumCanonicalTransportOwnsOriginalMember(t *testing.T) {
	f := newPQEthereumFixture(t)
	raw, originals := pqEthereumMembers(t, f, pqEthereumIntent(f, 2, 1, 7))
	wire, intent, err := DecodePQEthereumValueTransaction(raw[0])
	if err != nil || !bytes.Equal(wire, originals[0]) || intent.TxType != 2 || intent.Nonce != 1 {
		t.Fatalf("canonical original transport did not decode: %v", err)
	}
	before := bytes.Clone(raw[0])
	wire[0] ^= 1
	intent.ChainID[0] ^= 1
	if !bytes.Equal(before, raw[0]) {
		t.Fatal("decoded objects alias original transport")
	}
	for _, invalid := range [][]byte{
		nil,
		make([]byte, MaxPQEthereumTransactionBytes+1),
		append(bytes.Clone(raw[0]), '\n'),
		bytes.Replace(raw[0], []byte(`"version":1`), []byte(`"version":1,"version":1`), 1),
		mustPQEnvelope(t, PQTransferType, originals[0]),
	} {
		if _, _, err := DecodePQEthereumValueTransaction(invalid); err == nil {
			t.Fatal("noncanonical or wrong-kind original transport was accepted")
		}
	}
}

func TestABCIPQEthereumAllTypesSharedMemberClassicInterleavingAndColdRestart(t *testing.T) {
	f := newPQEthereumFixture(t)
	h := f.a.committed.Height + 1
	classic, classicTx, err := NewEthereumAccessListTransfer(f.otherClassic, f.m.Network.ChainID, 0, 1, f.owner, 7)
	if err != nil {
		t.Fatal(err)
	}
	pqABCIContractBlock(t, f.a, h, classic, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, uint64(h+1))))
	before, receiver, validator := queryConsensusAccount(t, f.a, f.owner), queryConsensusAccount(t, f.a, f.other), queryConsensusAccount(t, f.a, f.a.feeRecipient)
	intents := []ynxauth.EthereumValueIntent{pqEthereumIntent(f, 0, 1, 7), pqEthereumIntent(f, 1, 3, 11), pqEthereumIntent(f, 2, 4, 13), pqEthereumIntent(f, 0, 5, 17)}
	raw, wires := pqEthereumMembers(t, f, intents...)
	committed := mustJSON(t, f.a.committed)
	check, err := f.a.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: raw[0]})
	if err != nil || check.Code != 0 || !bytes.Equal(committed, mustJSON(t, f.a.committed)) || f.a.pending != nil {
		t.Fatalf("authentic Member CheckTx changed committed/pending state: %+v %v", check, err)
	}
	pqABCIContractBlock(t, f.a, h+1, raw[0], pqABCIStake(t, f, false, 5, 3, 0), raw[1], raw[2], raw[3])
	after, other, feeAccount := queryConsensusAccount(t, f.a, f.owner), queryConsensusAccount(t, f.a, f.other), queryConsensusAccount(t, f.a, f.a.feeRecipient)
	if after.Nonce != 6 || after.Balance != before.Balance-48-105000-5 || after.Staked != before.Staked+5 || other.Balance != receiver.Balance+48 || feeAccount.Balance != validator.Balance+105000 || after.ResourceUsage.BandwidthUsed != before.ResourceUsage.BandwidthUsed+4 || after.ResourceUsage.ComputeUsed != before.ResourceUsage.ComputeUsed+1 {
		t.Fatal("integer-gas value/fee/nonce/stake/usage execution diverged")
	}
	views := []chain.ConsensusAccount{before, receiver, validator}
	sort.Slice(views, func(i, j int) bool { return views[i].Address < views[j].Address })
	for i, intent := range intents {
		member, err := ynxbatch.DecodeMember(wires[i])
		if err != nil {
			t.Fatal(err)
		}
		if member.Certificate.N != 4 || member.Proof.Index != uint32(i) {
			t.Fatal("fixture no longer covers a full non-N1 Member")
		}
		var entry *PQCommittedAuthorization
		for j := range f.a.committed.PQHistory {
			if f.a.committed.PQHistory[j].Transaction.Hash == SignedTransactionHash(wires[i]) {
				entry = &f.a.committed.PQHistory[j]
			}
		}
		if entry == nil || entry.ABCITransactionHash != SignedTransactionHash(raw[i]) || entry.Transaction.Nonce != intent.Nonce+1 || entry.Transaction.Memo != pqEthereumValueHistoryMemo+hex.EncodeToString(raw[i]) {
			t.Fatal("complete original Member/transport or dual hash was lost")
		}
		fee, _, err := pqEthereumFees(intent)
		if err != nil {
			t.Fatal(err)
		}
		flows, planned, err := pqEthereumLotPlan(views, f.owner, f.other, f.a.feeRecipient, int64(intent.Value), fee)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(entry.Transaction.LotFlows, flows) {
			t.Fatal("historical value and gas-fee lots differ from actual ordered movements")
		}
		for j := range views {
			views[j].Lots = planned[views[j].Address].Lots
		}
	}
	for _, actual := range []chain.ConsensusAccount{after, other, feeAccount} {
		for _, expected := range views {
			if expected.Address == actual.Address && !reflect.DeepEqual(expected.Lots, actual.Lots) {
				t.Fatal("final account lots differ from all actual value/fee movements")
			}
		}
	}
	pqABCIContractRejected(t, f.a, raw[0])
	late, _, err := NewEthereumLegacyTransfer(f.otherClassic, f.m.Network.ChainID, 1, 1, f.owner, 7)
	if err != nil {
		t.Fatal(err)
	}
	pqABCIContractBlock(t, f.a, h+2, late)
	if _, ok := bftEVMReceiptIndex(f.a.committed.EVMReceipts, classicTx.Hash); !ok {
		t.Fatal("lawful original classic receipt was removed")
	}
	cold, err := NewPersistentApplication(f.m, f.path)
	if err != nil || !bytes.Equal(mustJSON(t, f.a.committed), mustJSON(t, cold.committed)) {
		t.Fatalf("original mixed classic/PQ state did not survive cold recovery: %v", err)
	}
}

func TestABCIPQEthereumTraceLastInboundUsesOriginalLotAmounts(t *testing.T) {
	f := newPQEthereumFixture(t)
	h := pqEthereumActivate(t, f)
	raw, _ := pqEthereumMembers(t, f, pqEthereumIntent(f, 2, 1, 7))
	pqABCIContractBlock(t, f.a, h, raw[0])
	entry := pqEthereumLast(t, f.a.committed)
	if len(entry.Transaction.LotFlows) < 2 {
		t.Fatal("fixture lacks distinct value and fee stages")
	}
	for _, flow := range entry.Transaction.LotFlows {
		if f.a.committed.TraceLots[flow.LotID].LastInbound != entry.ABCITransactionHash {
			t.Fatal("Ethereum moved lot retained its stale LastInbound provenance")
		}
	}
}

func TestABCIPQEthereumFirstIntentCannotSkipEstablishedPQNonce(t *testing.T) {
	for _, boundary := range []string{"prior-pq-transfer", "active-source-policy"} {
		t.Run(boundary, func(t *testing.T) {
			f := newPQEthereumFixture(t)
			var h int64
			var nonce uint64
			if boundary == "prior-pq-transfer" {
				h = pqEthereumActivate(t, f)
				pqABCIContractBlock(t, f.a, h, mustPQEnvelope(t, PQTransferType, f.transfer(t, false, 2, 1)))
				h++
				nonce = 2
			} else {
				// Source authorization is actually committed in the original Devnet;
				// its account/policy/history arrive through the authenticated migration.
				if _, _, err := f.d.SubmitAccountMigration(f.registration(t, false, uint64(f.a.committed.Height+2))); err != nil {
					t.Fatal(err)
				}
				f.d.ProduceBlock()
				var err error
				f.m, err = f.d.ExportConsensusMigrationState()
				if err != nil {
					t.Fatal(err)
				}
				f.path = filepath.Join(t.TempDir(), "active-source.json")
				f.a, err = NewPersistentApplication(f.m, f.path)
				if err != nil {
					t.Fatal(err)
				}
				h = f.a.committed.Height + 1
				nonce = 1
			}
			intent := pqEthereumIntent(f, 2, nonce, 7)
			raw, _ := pqEthereumMembers(t, f, intent)
			pqABCIContractBlock(t, f.a, h, raw[0])
			if err := validateConsensusPQEthereumValues(f.a.committed, f.m); err != nil {
				t.Fatalf("lawful first Ethereum after %s rejected: %v", boundary, err)
			}
			var bad CommittedState
			if err := json.Unmarshal(mustJSON(t, f.a.committed), &bad); err != nil {
				t.Fatal(err)
			}
			entry := &bad.PQHistory[len(bad.PQHistory)-1]
			oldHash := entry.ABCITransactionHash
			intent.Nonce++
			forged, wires := pqEthereumMembers(t, f, intent) // real valid AND, wrong execution nonce
			entry.ABCITransactionHash = SignedTransactionHash(forged[0])
			entry.Transaction.Hash = SignedTransactionHash(wires[0])
			entry.Transaction.Nonce = intent.Nonce + 1
			entry.Transaction.Memo = pqEthereumValueHistoryMemo + hex.EncodeToString(forged[0])
			for i := range bad.EVMReceipts {
				if bad.EVMReceipts[i].TxHash == oldHash {
					bad.EVMReceipts[i].TxHash = entry.ABCITransactionHash
					bad.EVMReceipts[i].AuditHash = bftEVMReceiptAuditHash(bad.EVMReceipts[i])
				}
			}
			for i := range bad.FeeEvents {
				if bad.FeeEvents[i].TxHash == oldHash {
					bad.FeeEvents[i] = newFeeEvent(entry.ABCITransactionHash, PQEthereumValueType, f.owner, f.a.feeRecipient, entry.Transaction.Fee, PQEthereumGasFeeSource, h, entry.Transaction.Timestamp)
				}
			}
			for id, lot := range bad.TraceLots {
				if lot.LastInbound == oldHash {
					lot.LastInbound = entry.ABCITransactionHash
					bad.TraceLots[id] = lot
				}
			}
			oi, _ := accountIndex(bad.Accounts, f.owner)
			bad.Accounts[oi].Nonce = intent.Nonce + 1
			if err := validateConsensusPQEthereumValues(bad, f.m); err == nil {
				t.Fatal("first Ethereum intent skipped an already established PQ nonce boundary")
			}
			var err error
			bad.AppHash, err = bad.calculateHash()
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(t.TempDir(), "valid-signature-skipped-nonce.json")
			if err = os.WriteFile(path, mustJSON(t, bad), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err = NewPersistentApplication(f.m, path); err == nil {
				t.Fatal("cold restore accepted a newly signed but never executed nonce gap")
			}
		})
	}
}

func TestABCIPQEthereumPendingRegistrationPreservesActualClassicNonceWindow(t *testing.T) {
	f := newPQEthereumFixture(t)
	h := f.a.committed.Height + 1
	pqABCIContractBlock(t, f.a, h, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, uint64(h+2))))
	classic, _, err := NewEthereumLegacyTransfer(f.classic, f.m.Network.ChainID, 1, 1, f.other, 1)
	if err != nil {
		t.Fatal(err)
	}
	pqABCIContractBlock(t, f.a, h+1, classic)
	raw, _ := pqEthereumMembers(t, f, pqEthereumIntent(f, 2, 2, 7))
	pqABCIContractBlock(t, f.a, h+2, raw[0])
	cold, err := NewPersistentApplication(f.m, f.path)
	if err != nil || !bytes.Equal(mustJSON(t, cold.committed), mustJSON(t, f.a.committed)) {
		t.Fatalf("actual classic execution during pending registration was reinterpreted: %v", err)
	}
}

func TestABCIPQEthereumOriginalANDPolicyAndFailureIsolation(t *testing.T) {
	f := newPQEthereumFixture(t)
	h := f.a.committed.Height + 1
	valid, wires := pqEthereumMembers(t, f, pqEthereumIntent(f, 2, 1, 7))
	pqABCIContractRejected(t, f.a, valid[0])
	pqABCIContractBlock(t, f.a, h, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, uint64(h+2))))
	pqABCIContractRejected(t, f.a, valid[0])
	pqABCIContractBlock(t, f.a, h+1)
	for _, branch := range []string{"A", "B"} {
		member, err := ynxbatch.DecodeMember(wires[0])
		if err != nil {
			t.Fatal(err)
		}
		if branch == "A" {
			member.Certificate.SigmaA[0] ^= 1
		} else {
			member.Certificate.SigmaB[0] ^= 1
		}
		wire, err := ynxbatch.EncodeMember(member)
		if err != nil {
			t.Fatal(err)
		}
		pqABCIContractRejected(t, f.a, mustPQEnvelope(t, PQEthereumValueType, wire))
	}
	for _, mode := range []string{"network", "owner", "purpose", "key"} {
		intent := pqEthereumIntent(f, 2, 1, 7)
		metadata := ynxbatch.Metadata{ChainID: bytes.Clone(f.network), Owner: f.owner, Purpose: ynxauth.TransactionPurpose}
		key := f.key
		switch mode {
		case "network":
			intent.ChainID[0] ^= 1
			metadata.ChainID = bytes.Clone(intent.ChainID)
		case "owner":
			metadata.Owner = f.other
		case "purpose":
			metadata.Purpose = ynxauth.MigrationPurpose
		case "key":
			key = f.otherKey
		}
		message, err := intent.SigningBytes()
		if err != nil {
			t.Fatal(err)
		}
		_, wire := consensusPQProof(t, key, metadata.ChainID, metadata.Owner, metadata.Purpose, message)
		pqABCIContractRejected(t, f.a, mustPQEnvelope(t, PQEthereumValueType, wire))
	}
	for _, mode := range []string{"nonce", "exhausted", "maximum-exposure"} {
		intent := pqEthereumIntent(f, 2, 1, 7)
		switch mode {
		case "nonce":
			intent.Nonce++
		case "exhausted":
			intent.Nonce = math.MaxUint64
		case "maximum-exposure":
			intent.MaxFeePerGas = 100
		}
		raw, _ := pqEthereumMembers(t, f, intent)
		pqABCIContractRejected(t, f.a, raw[0])
	}
	for _, mode := range []string{"recipient-balance", "recipient-lot", "bandwidth", "missing-fee-lots"} {
		candidate := f.a.cloneExecutionState()
		oi, _ := accountIndex(candidate.accounts, f.owner)
		ri, _ := accountIndex(candidate.accounts, f.other)
		switch mode {
		case "recipient-balance":
			candidate.accounts[ri].Balance = math.MaxInt64
		case "recipient-lot":
			for id := range candidate.accounts[oi].Lots {
				candidate.accounts[ri].Lots[id] = math.MaxInt64
			}
		case "bandwidth":
			candidate.accounts[oi].ResourceUsage.BandwidthUsed = math.MaxInt64
		case "missing-fee-lots":
			for id := range candidate.accounts[oi].Lots {
				candidate.accounts[oi].Lots[id] = 0
			}
			for id := range candidate.accounts[oi].Lots {
				candidate.accounts[oi].Lots[id] = 7
				break
			}
		}
		before := mustJSON(t, candidate.accounts)
		trace := mustJSON(t, candidate.traceLots)
		history := mustJSON(t, candidate.pqHistory)
		if _, _, err := f.a.applyPQEthereumValueTransaction(candidate, valid[0], h+2, time.Unix(h+2, 0).UTC()); err == nil {
			t.Fatalf("accepted %s", mode)
		}
		if !bytes.Equal(before, mustJSON(t, candidate.accounts)) || !bytes.Equal(trace, mustJSON(t, candidate.traceLots)) || !bytes.Equal(history, mustJSON(t, candidate.pqHistory)) {
			t.Fatalf("failed %s modified borrowed candidate", mode)
		}
	}
	pqABCIContractBlock(t, f.a, h+2, valid[0])
	pqABCIContractBlock(t, f.a, h+3, mustPQEnvelope(t, PQRevocationType, f.revocation(t, 3, uint64(h+3), 1)))
	revoked, _ := pqEthereumMembers(t, f, pqEthereumIntent(f, 0, 3, 1))
	pqABCIContractRejected(t, f.a, revoked[0])
	classic, _, err := NewEthereumLegacyTransfer(f.classic, f.m.Network.ChainID, 3, 1, f.other, 1)
	if err != nil {
		t.Fatal(err)
	}
	pqABCIContractRejected(t, f.a, classic)
	cold, err := NewPersistentApplication(f.m, f.path)
	if err != nil || !bytes.Equal(mustJSON(t, f.a.committed), mustJSON(t, cold.committed)) {
		t.Fatalf("terminal revocation changed historical authorization: %v", err)
	}
}

func TestABCIPQEthereumResealedHistoryEffectsAndColdTamperRejection(t *testing.T) {
	f := newPQEthereumFixture(t)
	h := pqEthereumActivate(t, f)
	raw, _ := pqEthereumMembers(t, f, pqEthereumIntent(f, 2, 1, 7))
	pqABCIContractBlock(t, f.a, h, raw[0])
	modes := []string{"erase-proof", "erase-receipt", "erase-fee", "duplicate-proof", "duplicate-fee", "duplicate-receipt", "native-hash", "abci-hash", "amount", "nonce", "owner", "to", "height", "time", "sponsor", "memo", "value-flow", "fee-flow", "flow-recipient", "flow-lineage", "extra-flow", "receipt-owner", "receipt-height", "receipt-result", "receipt-action", "fee-amount", "fee-recipient", "fee-height", "fee-source", "fee-type", "fee-time", "fee-allocation", "account-nonce", "bandwidth", "signature-A", "signature-B", "signed-gas", "signed-max-fee", "signed-type", "classic-downgrade"}
	for _, mode := range modes {
		t.Run(mode, func(t *testing.T) {
			var bad CommittedState
			if err := json.Unmarshal(mustJSON(t, f.a.committed), &bad); err != nil {
				t.Fatal(err)
			}
			entry := &bad.PQHistory[len(bad.PQHistory)-1]
			hash := entry.ABCITransactionHash
			ri, found := bftEVMReceiptIndex(bad.EVMReceipts, hash)
			if !found {
				t.Fatal("fixture receipt missing")
			}
			fi := -1
			for i := range bad.FeeEvents {
				if bad.FeeEvents[i].TxHash == hash {
					fi = i
				}
			}
			if fi < 0 {
				t.Fatal("fixture fee missing")
			}
			oi, _ := accountIndex(bad.Accounts, f.owner)
			switch mode {
			case "erase-proof":
				bad.PQHistory = bad.PQHistory[:len(bad.PQHistory)-1]
			case "erase-receipt":
				bad.EVMReceipts = append(bad.EVMReceipts[:ri], bad.EVMReceipts[ri+1:]...)
			case "erase-fee":
				bad.FeeEvents = append(bad.FeeEvents[:fi], bad.FeeEvents[fi+1:]...)
			case "duplicate-proof":
				bad.PQHistory = append(bad.PQHistory, *entry)
			case "duplicate-fee":
				bad.FeeEvents = append(bad.FeeEvents, bad.FeeEvents[fi])
			case "duplicate-receipt":
				bad.EVMReceipts = append(bad.EVMReceipts, bad.EVMReceipts[ri])
			case "native-hash":
				entry.Transaction.Hash = hash
			case "abci-hash":
				entry.ABCITransactionHash = entry.Transaction.Hash
			case "amount":
				entry.Transaction.Amount++
			case "nonce":
				entry.Transaction.Nonce++
			case "owner":
				entry.Transaction.From = f.other
			case "to":
				entry.Transaction.To = f.owner
			case "height":
				entry.Transaction.BlockNum--
			case "time":
				entry.Transaction.Timestamp = entry.Transaction.Timestamp.Add(time.Second)
			case "sponsor":
				entry.Transaction.Sponsor = f.other
			case "memo":
				entry.Transaction.Memo = ""
			case "value-flow":
				entry.Transaction.LotFlows[0].Amount++
			case "fee-flow":
				entry.Transaction.LotFlows[len(entry.Transaction.LotFlows)-1].Amount--
			case "flow-recipient":
				entry.Transaction.LotFlows[0].To = f.owner
			case "flow-lineage":
				entry.Transaction.LotFlows[0].LotID = "not-an-original-lot"
			case "extra-flow":
				entry.Transaction.LotFlows = append(entry.Transaction.LotFlows, entry.Transaction.LotFlows[0])
			case "receipt-owner":
				bad.EVMReceipts[ri].From = f.other
			case "receipt-height":
				bad.EVMReceipts[ri].BlockHeight--
			case "receipt-result":
				bad.EVMReceipts[ri].EncodedResult = "0x01"
			case "receipt-action":
				bad.EVMReceipts[ri].Action = EthereumLegacyTransferType
			case "fee-amount":
				bad.FeeEvents[fi].GrossFeeYNXT++
				bad.FeeEvents[fi].ValidatorYNXT++
			case "fee-recipient":
				bad.FeeEvents[fi].Recipient = f.other
			case "fee-height":
				bad.FeeEvents[fi].BlockHeight--
			case "fee-source":
				bad.FeeEvents[fi].Source = EthereumDynamicFeeGasFeeSource
			case "fee-type":
				bad.FeeEvents[fi].TransactionType = EthereumDynamicFeeTransferType
			case "fee-time":
				bad.FeeEvents[fi].RecordedAt = bad.FeeEvents[fi].RecordedAt.Add(time.Second)
			case "fee-allocation":
				bad.FeeEvents[fi].ValidatorYNXT--
				bad.FeeEvents[fi].TreasuryYNXT++
			case "account-nonce":
				bad.Accounts[oi].Nonce++
			case "bandwidth":
				bad.Accounts[oi].ResourceUsage.BandwidthUsed = 0
			case "signature-A", "signature-B", "signed-gas", "signed-max-fee", "signed-type":
				wire, intent, err := decodePQEthereumValueHistory(*entry)
				if err != nil {
					t.Fatal(err)
				}
				member, err := ynxbatch.DecodeMember(wire)
				if err != nil {
					t.Fatal(err)
				}
				switch mode {
				case "signature-A":
					member.Certificate.SigmaA[0] ^= 1
				case "signature-B":
					member.Certificate.SigmaB[0] ^= 1
				case "signed-gas":
					fields, err := ynxbatch.DecodeFields(member.Message, 23, ynxauth.MaxEthereumValueIntentBytes)
					if err != nil {
						t.Fatal(err)
					}
					fields[14] = ynxbatch.U32(21001)
					member.Message, err = ynxbatch.EncodeFields(fields...)
					if err != nil {
						t.Fatal(err)
					}
				case "signed-max-fee":
					intent.MaxFeePerGas++
					member.Message, err = intent.SigningBytes()
					if err != nil {
						t.Fatal(err)
					}
				case "signed-type":
					intent.TxType, intent.GasPrice, intent.MaxPriorityFeePerGas, intent.MaxFeePerGas = 0, 1, 0, 0
					member.Message, err = intent.SigningBytes()
					if err != nil {
						t.Fatal(err)
					}
				}
				wire, err = ynxbatch.EncodeMember(member)
				if err != nil {
					t.Fatal(err)
				}
				changed := mustPQEnvelope(t, PQEthereumValueType, wire)
				entry.Transaction.Hash, entry.ABCITransactionHash = SignedTransactionHash(wire), SignedTransactionHash(changed)
				entry.Transaction.Memo = pqEthereumValueHistoryMemo + hex.EncodeToString(changed)
				bad.EVMReceipts[ri].TxHash = entry.ABCITransactionHash
				bad.FeeEvents[fi] = newFeeEvent(entry.ABCITransactionHash, PQEthereumValueType, f.owner, f.a.feeRecipient, 21000, PQEthereumGasFeeSource, h, entry.Transaction.Timestamp)
			case "classic-downgrade":
				bad.PQHistory = bad.PQHistory[:len(bad.PQHistory)-1]
				bad.EVMReceipts[ri].Action = EthereumDynamicFeeTransferType
				bad.FeeEvents[fi].TransactionType = EthereumDynamicFeeTransferType
				bad.FeeEvents[fi].Source = EthereumDynamicFeeGasFeeSource
			}
			// Attacker recomputes public audit hashes and the self-sealed AppHash;
			// rejection must come from original authorization/effect linkage.
			for i := range bad.EVMReceipts {
				bad.EVMReceipts[i].AuditHash = bftEVMReceiptAuditHash(bad.EVMReceipts[i])
			}
			for i := range bad.FeeEvents {
				bad.FeeEvents[i].AuditHash = feeEventAuditHash(bad.FeeEvents[i])
			}
			var err error
			bad.AppHash, err = bad.calculateHash()
			if err != nil {
				t.Fatal(err)
			}
			if err = bad.Validate(f.m); err == nil {
				t.Fatalf("resealed PQ Ethereum %s survived", mode)
			}
			path := filepath.Join(t.TempDir(), "tampered.json")
			if err = os.WriteFile(path, mustJSON(t, bad), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err = NewPersistentApplication(f.m, path); err == nil {
				t.Fatalf("cold restore accepted %s", mode)
			}
		})
	}
}

func TestABCIPQEthereumCommitFailurePreservesOriginalUnknownCandidate(t *testing.T) {
	for _, afterRename := range []bool{false, true} {
		t.Run(map[bool]string{false: "before-rename", true: "after-rename"}[afterRename], func(t *testing.T) {
			f := newPQEthereumFixture(t)
			h := pqEthereumActivate(t, f)
			raw, _ := pqEthereumMembers(t, f, pqEthereumIntent(f, 2, 1, 7))
			before := mustJSON(t, f.a.committed)
			diskBefore, err := os.ReadFile(f.path)
			if err != nil {
				t.Fatal(err)
			}
			ctx := context.Background()
			result, err := f.a.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: h, Time: time.Unix(h, 0).UTC(), Txs: raw})
			if err != nil || len(result.TxResults) != 1 || result.TxResults[0].Code != 0 {
				t.Fatalf("real PQ Ethereum Finalize: %+v %v", result, err)
			}
			pending := mustJSON(t, f.a.pending)
			injected := errors.New("PQ Ethereum checkpoint failure")
			f.a.persistenceHooks = &committedPersistenceHooks{}
			if afterRename {
				f.a.persistenceHooks.syncDirectory = func(string) error { return injected }
			} else {
				f.a.persistenceHooks.beforeRename = func() error { return injected }
			}
			_, err = f.a.Commit(ctx, &abci.RequestCommit{})
			if !errors.Is(err, injected) || errors.Is(err, ErrCommittedStateDurabilityUncertain) != afterRename || !bytes.Equal(before, mustJSON(t, f.a.committed)) || !bytes.Equal(pending, mustJSON(t, f.a.pending)) {
				t.Fatalf("original PQ Ethereum candidate or UNKNOWN was lost: %v", err)
			}
			if _, err = f.a.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: h, Txs: raw}); err == nil {
				t.Fatal("unresolved commit accepted another execution")
			}
			if afterRename {
				cold, err := NewPersistentApplication(f.m, f.path)
				if err != nil || !bytes.Equal(pending, mustJSON(t, cold.committed)) {
					t.Fatalf("cold restore lost original renamed candidate: %v", err)
				}
			} else {
				disk, err := os.ReadFile(f.path)
				if err != nil || !bytes.Equal(disk, diskBefore) {
					t.Fatal("pre-rename failure replaced original bytes")
				}
			}
			f.a.persistenceHooks = nil
			if _, err = f.a.Commit(ctx, &abci.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(pending, mustJSON(t, f.a.committed)) {
				t.Fatal("confirmation reapplied or changed original effects")
			}
			pqABCIContractRejected(t, f.a, raw[0])
		})
	}
}

func TestABCIPQEthereumAllPersistenceLayoutsPreserveOriginals(t *testing.T) {
	f := newPQEthereumFixture(t)
	h := int64(f.m.Height) + 1
	registration := mustPQEnvelope(t, PQMigrationType, f.registration(t, false, uint64(h+1)))
	raw, _ := pqEthereumMembers(t, f, pqEthereumIntent(f, 0, 1, 7), pqEthereumIntent(f, 2, 2, 9))
	var expected []byte
	for _, layout := range []struct {
		name string
		open func(chain.ConsensusMigrationState, string) (*Application, error)
	}{{"atomic", NewPersistentApplication}, {"snapshot-journal", NewJournaledApplication}, {"block-journal", NewBlockJournaledApplication}} {
		t.Run(layout.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "state")
			app, err := layout.open(f.m, path)
			if err != nil {
				t.Fatal(err)
			}
			commitSponsorBlock(t, app, h, time.Unix(h, 0).UTC(), registration)
			commitSponsorBlock(t, app, h+1, time.Unix(h+1, 0).UTC(), raw...)
			actual := mustJSON(t, app.committed)
			if expected == nil {
				expected = actual
			} else if !bytes.Equal(expected, actual) {
				t.Fatal("persistence layout changed exact execution/history root")
			}
			cold, err := layout.open(f.m, path)
			if err != nil || !bytes.Equal(actual, mustJSON(t, cold.committed)) {
				t.Fatalf("layout lost original proof/fee/receipt on recovery: %v", err)
			}
			check, err := cold.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: raw[0]})
			if err != nil || check.Code == 0 {
				t.Fatal("layout restart lost original replay fence")
			}
		})
	}
}

func TestABCIPQEthereumLotPlanAliasesAndFailureAreDetached(t *testing.T) {
	accounts := []chain.ConsensusAccount{{Address: "owner", Lots: map[string]int64{"a": 50, "b": 50}}, {Address: "to", Lots: map[string]int64{}}}
	before := mustJSON(t, accounts)
	flows, views, err := pqEthereumLotPlan(accounts, "owner", "to", "owner", 7, 21)
	if err != nil || len(flows) != 1 || flows[0].Amount != 7 || views["owner"].Lots["a"] != 43 || !bytes.Equal(before, mustJSON(t, accounts)) {
		t.Fatal("self-paid fee changed its original alias/movement semantics", err)
	}
	flows, views, err = pqEthereumLotPlan(accounts, "owner", "to", "to", 7, 21)
	if err != nil || len(flows) != 2 || flows[0].Amount != 7 || flows[1].Amount != 21 || views["to"].Lots["a"] != 28 || !bytes.Equal(before, mustJSON(t, accounts)) {
		t.Fatal("same value/fee destination lost distinct exact stages", err)
	}
	if _, _, err = pqEthereumLotPlan(accounts, "owner", "to", "to", 7, 100); err == nil || !bytes.Equal(before, mustJSON(t, accounts)) {
		t.Fatal("late fee failure polluted original lots")
	}
}
