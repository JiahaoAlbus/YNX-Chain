package consensus

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"strings"
	"testing"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"
)

// The pre-change decoder is retained as a differential oracle, including its
// error order and complete canonical re-encoding.
func originalPQEnvelopeDecode(payload []byte) (PQTransaction, []byte, error) {
	var tx PQTransaction
	if len(payload) == 0 || len(payload) > MaxPQWholeTransactionBytes {
		return tx, nil, errors.New("ABCI PQ envelope size is invalid")
	}
	d := json.NewDecoder(bytes.NewReader(payload))
	d.DisallowUnknownFields()
	if err := d.Decode(&tx); err != nil {
		return tx, nil, err
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		return tx, nil, errors.New("trailing ABCI PQ envelope")
	}
	wire, err := hex.DecodeString(tx.WireHex)
	if err != nil || tx.Version != 1 || hex.EncodeToString(wire) != tx.WireHex {
		return tx, nil, errors.New("noncanonical ABCI PQ wire")
	}
	canonical, err := EncodePQTransaction(tx.Type, wire)
	if err != nil || !bytes.Equal(canonical, payload) {
		return tx, nil, errors.New("noncanonical ABCI PQ envelope")
	}
	return tx, wire, nil
}

func samePQDecode(t *testing.T, raw []byte) {
	t.Helper()
	want, wantWire, wantErr := originalPQEnvelopeDecode(raw)
	got, gotWire, gotErr := DecodePQTransaction(raw)
	if !reflect.DeepEqual(want, got) || !reflect.DeepEqual(wantWire, gotWire) || (wantErr == nil) != (gotErr == nil) || wantErr != nil && (wantErr.Error() != gotErr.Error() || reflect.TypeOf(wantErr) != reflect.TypeOf(gotErr)) {
		t.Fatalf("decoder mismatch: old=%v new=%v", wantErr, gotErr)
	}
}

func TestPQEnvelopeDecodeSignedAndMalformedEquivalence(t *testing.T) {
	f := activeABCIWholeFixture(t)
	raw := mustPQEnvelope(t, PQTransferType, f.transfer(t, false, 2, 1))
	before := mustJSON(t, f.a.committed)
	response, err := f.a.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: raw})
	if err != nil || response.Code != 0 {
		t.Fatalf("original signed CheckTx rejected: %+v %v", response, err)
	}
	if !bytes.Equal(before, mustJSON(t, f.a.committed)) {
		t.Fatal("CheckTx modified committed state")
	}
	var envelope PQTransaction
	if err := json.Unmarshal(raw, &envelope); err != nil {
		t.Fatal(err)
	}
	upper := envelope
	upper.WireHex = strings.ToUpper(upper.WireHex)
	upperJSON, err := json.Marshal(upper)
	if err != nil || bytes.Equal(raw, upperJSON) {
		t.Fatal("uppercase negative control missing")
	}
	odd := envelope
	odd.WireHex = odd.WireHex[:len(odd.WireHex)-1]
	oddJSON, _ := json.Marshal(odd)
	bad := envelope
	bad.WireHex = "00g0"
	badJSON, _ := json.Marshal(bad)
	wrongVersion := envelope
	wrongVersion.Version = 2
	wrongVersionJSON, _ := json.Marshal(wrongVersion)
	variants := [][]byte{nil, raw, upperJSON, oddJSON, badJSON, wrongVersionJSON, append(bytes.Clone(raw), []byte(" null")...), append([]byte(" "), raw...), bytes.Replace(raw, []byte(`"version":1`), []byte(`"version":1,"unknown":1`), 1), bytes.Replace(raw, []byte(`"version":1`), []byte(`"version":1,"version":1`), 1)}
	for _, v := range variants {
		samePQDecode(t, v)
	}
	rejected, err := f.a.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: upperJSON})
	if err != nil || rejected.Code == 0 || !bytes.Equal(before, mustJSON(t, f.a.committed)) {
		t.Fatal("uppercase wire was accepted or mutated committed state", rejected, err)
	}
	tampered := bytes.Clone(raw)
	lastHex := len(tampered) - 3
	if tampered[lastHex] == '0' {
		tampered[lastHex] = '1'
	} else {
		tampered[lastHex] = '0'
	}
	if _, _, err := DecodePQTransaction(tampered); err != nil {
		t.Fatal("tampered control must remain a canonical envelope", err)
	}
	samePQDecode(t, tampered)
	rejected, err = f.a.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: tampered})
	if err != nil || rejected.Code == 0 || !bytes.Equal(before, mustJSON(t, f.a.committed)) {
		t.Fatal("tampered signed member was accepted or mutated committed state", rejected, err)
	}
	// Exercise every byte at each nibble position, including uppercase, bad
	// UTF-8 and escaped JSON input, against the exact old error behavior.
	for i := 0; i < 256; i++ {
		for _, text := range []string{string([]byte{byte(i), '0'}), string([]byte{'0', byte(i)})} {
			v, err := json.Marshal(PQTransaction{Version: 1, Type: PQTransferType, WireHex: text})
			if err != nil {
				t.Fatal(err)
			}
			samePQDecode(t, v)
		}
	}
	for i := 0; i < 128; i++ {
		wire := make([]byte, i+1)
		for j := range wire {
			wire[j] = byte(i*37 + j*83)
		}
		payload, err := EncodePQTransaction(PQTransferType, wire)
		if err != nil {
			t.Fatal(err)
		}
		samePQDecode(t, payload)
	}
	for _, kind := range []string{PQTransferType, PQMigrationType, PQRevocationType, PQWholeType, PQEthereumValueType, PQInitialRegistrationType} {
		for _, size := range []int{1, 2, 31, 4096} {
			wire := make([]byte, size)
			for i := range wire {
				wire[i] = byte(i*29 + size)
			}
			payload, err := EncodePQTransaction(kind, wire)
			if err != nil {
				t.Fatal(err)
			}
			samePQDecode(t, payload)
		}
	}
	ownerBefore := queryConsensusAccount(t, f.a, f.owner)
	feeBefore := queryConsensusAccount(t, f.a, f.a.feeRecipient)
	final, err := f.a.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: 3, Time: time.Unix(3, 0).UTC(), Txs: [][]byte{upperJSON, raw, raw}})
	if err != nil || len(final.TxResults) != 3 || final.TxResults[0].Code == 0 || final.TxResults[1].Code != 0 || final.TxResults[2].Code == 0 {
		t.Fatalf("finalize changed invalid/signed/replay outcomes: %+v %v", final, err)
	}
	if !bytes.Equal(before, mustJSON(t, f.a.committed)) {
		t.Fatal("Finalize modified committed state before Commit")
	}
	if _, err := f.a.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	ownerAfter := queryConsensusAccount(t, f.a, f.owner)
	feeAfter := queryConsensusAccount(t, f.a, f.a.feeRecipient)
	if ownerAfter.Nonce != ownerBefore.Nonce+1 || ownerAfter.Balance != ownerBefore.Balance-2 || feeAfter.Balance != feeBefore.Balance+1 {
		t.Fatal("signed transaction changed nonce, balance or fee semantics")
	}
	cold, err := NewPersistentApplication(f.m, f.path)
	if err != nil || !bytes.Equal(mustJSON(t, cold.committed), mustJSON(t, f.a.committed)) {
		t.Fatal("cold recovery changed committed state", err)
	}
	replayed, err := cold.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: raw})
	if err != nil || replayed.Code == 0 {
		t.Fatal("cold recovery allowed the original transaction replay", replayed, err)
	}
}

var pqDecodeBenchTx PQTransaction
var pqDecodeBenchWire []byte
var pqDecodeBenchErr error

func TestPQEnvelopeDecodeSignedCost(t *testing.T) {
	f := activeABCIWholeFixture(t)
	raw := mustPQEnvelope(t, PQTransferType, f.transfer(t, false, 2, 1))
	response, err := f.a.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: raw})
	if err != nil || response.Code != 0 {
		t.Fatalf("signed member rejected: %+v %v", response, err)
	}
	for _, c := range []struct {
		name   string
		decode func([]byte) (PQTransaction, []byte, error)
	}{{"original", originalPQEnvelopeDecode}, {"candidate", DecodePQTransaction}} {
		result := testing.Benchmark(func(b *testing.B) {
			b.ReportAllocs()
			b.SetBytes(int64(len(raw)))
			for i := 0; i < b.N; i++ {
				pqDecodeBenchTx, pqDecodeBenchWire, pqDecodeBenchErr = c.decode(raw)
			}
		})
		if pqDecodeBenchErr != nil {
			t.Fatal(pqDecodeBenchErr)
		}
		t.Logf("%s bytes=%d ns/op=%d allocs/op=%d bytes/op=%d", c.name, len(raw), result.NsPerOp(), result.AllocsPerOp(), result.AllocedBytesPerOp())
	}
}
