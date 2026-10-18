package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func ethereumQueryFixture(t *testing.T) *abciRevocationFixture {
	t.Helper()
	f := newABCIRevocationFixture(t)
	if _, err := f.d.Faucet(f.owner, 500000); err != nil {
		t.Fatal(err)
	}
	f.d.ProduceBlock()
	var err error
	f.m, err = f.d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	// Recreate from an actual source with complete lot provenance, never edited balances.
	f.a, err = NewPersistentApplication(f.m, f.path+"-funded")
	if err != nil {
		t.Fatal(err)
	}
	f.path += "-funded"
	commitSponsorBlock(t, f.a, 3, time.Unix(3, 0).UTC(), mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 4)))
	return f
}

func ethereumQueryWire(t *testing.T, f *abciRevocationFixture, kind uint32, nonce uint64) []byte {
	t.Helper()
	intent := ynxauth.EthereumValueIntent{Profile: ynxauth.EthereumABCIIntegerGasProfile, ChainID: f.network, NativeChainID: 6423, Owner: f.owner, To: f.other, Value: 7, Nonce: nonce, TxType: kind, GasLimit: 21000, GasPrice: 2}
	if kind == 2 {
		intent.GasPrice = 0
		intent.MaxPriorityFeePerGas = 2
		intent.MaxFeePerGas = 4
	}
	messages := make([][]byte, 4)
	for i := range messages {
		v := intent
		if i != 3 {
			v.Nonce += uint64(i + 100)
		}
		var err error
		messages[i], err = v.SigningBytes()
		if err != nil {
			t.Fatal(err)
		}
	}
	batch, err := ynxbatch.BatchSign(f.key, ynxbatch.Metadata{ChainID: f.network, Owner: f.owner, Purpose: ynxauth.TransactionPurpose}, messages, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		t.Fatal(err)
	}
	defer batch.Discard()
	member, err := ynxbatch.Extract(batch, 3)
	if err != nil {
		t.Fatal(err)
	}
	wire, err := ynxbatch.EncodeMember(member)
	if err != nil {
		t.Fatal(err)
	}
	return wire
}

func readEthereumQuery(t *testing.T, a *Application, hash string) (PQEthereumValueOriginalView, []byte) {
	t.Helper()
	out, err := a.Query(context.Background(), &abcitypes.RequestQuery{Path: PQEthereumValueOriginalPath + hash})
	if err != nil {
		t.Fatal(err)
	}
	var v PQEthereumValueOriginalView
	if out.Code != 0 || json.Unmarshal(out.Value, &v) != nil {
		t.Fatalf("actual original query: %+v", out)
	}
	if _, _, err := ValidatePQEthereumValueOriginalView(v, out.Height); err != nil {
		t.Fatal(err)
	}
	return v, out.Value
}

func TestPQEthereumOriginalQueryHistoricalPolicyAndColdRestart(t *testing.T) {
	f := ethereumQueryFixture(t)
	var wires [][]byte
	for kind := uint32(0); kind < 3; kind++ {
		wire := ethereumQueryWire(t, f, kind, uint64(kind+1))
		wires = append(wires, wire)
		raw := mustPQEnvelope(t, PQEthereumValueType, wire)
		h := int64(kind + 4)
		commitSponsorBlock(t, f.a, h, time.Unix(h, 0).UTC(), raw)
		v, _ := readEthereumQuery(t, f.a, SignedTransactionHash(wire))
		tx, intent, err := ValidatePQEthereumValueOriginalView(v, h)
		if err != nil || intent.TxType != kind || tx.Fee != 42000 || tx.Nonce != uint64(kind+2) || v.ABCITransactionHash != SignedTransactionHash(raw) || !bytes.Equal(v.Transport, raw) || !bytes.Equal(v.Wire, wire) {
			t.Fatalf("wrong exact original/effects: %+v %v", tx, err)
		}
	}
	commitSponsorBlock(t, f.a, 7, time.Unix(7, 0).UTC(), mustPQEnvelope(t, PQRevocationType, f.revocation(t, 5, 7, 1)))
	before, encoded := readEthereumQuery(t, f.a, SignedTransactionHash(wires[0]))
	if before.Authorization.PQSigningEnabled || before.ExecutionHeight != 4 || before.Authorization.ExecutionHeight != 8 {
		t.Fatal("future tombstone erased original height or enabled new signing")
	}
	restored, err := NewPersistentApplication(f.m, f.path)
	if err != nil {
		t.Fatal(err)
	}
	after, restoredBytes := readEthereumQuery(t, restored, SignedTransactionHash(wires[0]))
	if !reflect.DeepEqual(before, after) || !bytes.Equal(encoded, restoredBytes) {
		t.Fatal("cold restore changed complete original query")
	}
	for _, req := range []*abcitypes.RequestQuery{
		{Path: PQEthereumValueOriginalPath + before.NativeTransactionHash, Height: 6},
		{Path: PQEthereumValueOriginalPath + before.NativeTransactionHash, Height: 8},
		{Path: PQEthereumValueOriginalPath + before.NativeTransactionHash, Prove: true},
		{Path: PQEthereumValueOriginalPath + before.NativeTransactionHash, Data: []byte("extra")},
	} {
		r, err := restored.Query(context.Background(), req)
		if err != nil || r.Code == 0 || len(r.Value) != 0 {
			t.Fatalf("accepted misleading original request: %+v %v", r, err)
		}
	}
}

func TestPQEthereumOriginalQueryRejectsChangedProofAndEffects(t *testing.T) {
	f := ethereumQueryFixture(t)
	wire := ethereumQueryWire(t, f, 2, 1)
	commitSponsorBlock(t, f.a, 4, time.Unix(4, 0).UTC(), mustPQEnvelope(t, PQEthereumValueType, wire))
	original, encoded := readEthereumQuery(t, f.a, SignedTransactionHash(wire))
	for name, mutate := range map[string]func(*PQEthereumValueOriginalView){
		"wire":         func(v *PQEthereumValueOriginalView) { v.Wire[len(v.Wire)-1] ^= 1 },
		"outer":        func(v *PQEthereumValueOriginalView) { v.Transport = append(v.Transport, ' ') },
		"height":       func(v *PQEthereumValueOriginalView) { v.ExecutionHeight++ },
		"query-height": func(v *PQEthereumValueOriginalView) { v.Authorization.CommittedHeight++ },
		"recipient":    func(v *PQEthereumValueOriginalView) { v.FeeRecipient = f.other },
		"gas-payment": func(v *PQEthereumValueOriginalView) {
			var fee BFTFeeEvent
			if err := json.Unmarshal(v.Fee, &fee); err != nil {
				t.Fatal(err)
			}
			fee.GrossFeeYNXT--
			v.Fee, _ = json.Marshal(fee)
		},
		"receipt-action": func(v *PQEthereumValueOriginalView) {
			var receipt BFTEVMReceipt
			if err := json.Unmarshal(v.Receipt, &receipt); err != nil {
				t.Fatal(err)
			}
			receipt.Action = EthereumLegacyTransferType
			v.Receipt, _ = json.Marshal(receipt)
		},
		"missing-lot": func(v *PQEthereumValueOriginalView) { v.TraceLots = []byte(`{}`) },
	} {
		t.Run(name, func(t *testing.T) {
			var v PQEthereumValueOriginalView
			if err := json.Unmarshal(encoded, &v); err != nil {
				t.Fatal(err)
			}
			mutate(&v)
			if _, _, err := ValidatePQEthereumValueOriginalView(v, original.Authorization.CommittedHeight); err == nil {
				t.Fatal("changed original evidence accepted")
			}
		})
	}
	// Query producer must reject corrupt committed effects rather than exporting a
	// self-consistent-looking partial receipt. This only corrupts an isolated test state.
	f.a.mu.Lock()
	f.a.committed.FeeEvents[len(f.a.committed.FeeEvents)-1].GrossFeeYNXT--
	f.a.mu.Unlock()
	out, err := f.a.Query(context.Background(), &abcitypes.RequestQuery{Path: PQEthereumValueOriginalPath + original.NativeTransactionHash})
	if err != nil || out.Code == 0 || len(out.Value) != 0 {
		t.Fatalf("producer exported corrupt fee: %+v %v", out, err)
	}
}
