package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"io"
	"math/rand"
	"strings"
	"testing"
)

func TestABCIPQEnvelopeEncodingDifferential(t *testing.T) {
	cases := []struct {
		kind  string
		limit int
	}{{PQTransferType, 256 << 10}, {PQMigrationType, 256 << 10}, {PQRevocationType, 128 << 10}, {PQWholeType, 8 << 20}, {PQEthereumValueType, MaxPQEthereumMemberBytes}, {PQInitialRegistrationType, 128 << 10}}
	for _, c := range cases {
		t.Run(c.kind, func(t *testing.T) {
			for _, size := range []int{0, 1, 256, 59123, c.limit, c.limit + 1} {
				wire := make([]byte, size)
				for i := range wire {
					wire[i] = byte(i)
				}
				old, oe := pqEnvelopeLegacyEncode(c.kind, wire)
				got, ge := EncodePQTransaction(c.kind, wire)
				if (oe == nil) != (ge == nil) || oe != nil && oe.Error() != ge.Error() {
					t.Fatalf("error changed at %d: %v %v", size, oe, ge)
				}
				if !bytes.Equal(old, got) || sha256.Sum256(old) != sha256.Sum256(got) {
					t.Fatalf("canonical bytes/hash differ at %d", size)
				}
				if ge == nil {
					var tx PQTransaction
					if json.Unmarshal(got, &tx) != nil || tx.Version != 1 || tx.Type != c.kind {
						t.Fatal("invalid JSON")
					}
					before := bytes.Clone(got)
					wire[0] ^= 255
					if !bytes.Equal(before, got) {
						t.Fatal("result aliases wire")
					}
				}
			}
		})
	}
	for _, kind := range []string{"", "pq_transfer\"", "PQ_TRANSFER", "pq_transfer\n", "<script>", "account_migration ", "未知"} {
		for _, wire := range [][]byte{nil, {1}} {
			a, ae := pqEnvelopeLegacyEncode(kind, wire)
			b, be := EncodePQTransaction(kind, wire)
			if ae == nil || be == nil || ae.Error() != be.Error() || !bytes.Equal(a, b) {
				t.Fatal("unsupported kind admitted", kind)
			}
		}
	}
}
func TestABCIPQEnvelopeEncodingRandomDifferential(t *testing.T) {
	r := rand.New(rand.NewSource(101))
	for i := 0; i < 100; i++ {
		wire := make([]byte, 1+r.Intn(4096))
		r.Read(wire)
		a, ae := pqEnvelopeLegacyEncode(PQTransferType, wire)
		b, be := EncodePQTransaction(PQTransferType, wire)
		if ae != nil || be != nil || !bytes.Equal(a, b) {
			t.Fatal("random byte difference", i)
		}
	}
}

var pqEnvelopeEncodedSink []byte

func BenchmarkABCIPQHistoryEnvelope(b *testing.B) {
	wire := make([]byte, 59123)
	for i := range wire {
		wire[i] = byte(i)
	}
	for _, c := range []struct {
		name string
		f    func(string, []byte) ([]byte, error)
	}{{"original", pqEnvelopeLegacyEncode}, {"candidate", EncodePQTransaction}} {
		b.Run(c.name, func(b *testing.B) {
			b.ReportAllocs()
			b.SetBytes(int64(len(wire)))
			for i := 0; i < b.N; i++ {
				var err error
				pqEnvelopeEncodedSink, err = c.f(PQTransferType, wire)
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

// Exact pre-optimization canonical encoder retained as a differential oracle.
func pqEnvelopeLegacyEncode(kind string, wire []byte) ([]byte, error) {
	limit := ynxauth.MaxMigrationBytes
	if kind == PQWholeType {
		limit = chain.MaxPQBatchBytes
	}
	if kind == PQEthereumValueType {
		limit = MaxPQEthereumMemberBytes
	}
	if kind == PQInitialRegistrationType {
		limit = ynxauth.MaxPQInitialRegistrationBytes
	}
	if kind != PQTransferType && kind != PQMigrationType && kind != PQRevocationType && kind != PQWholeType && kind != PQEthereumValueType && kind != PQInitialRegistrationType || len(wire) == 0 || len(wire) > limit || kind == PQRevocationType && len(wire) > ynxauth.MaxRevocationBytes {
		return nil, errors.New("unsupported or oversized ABCI PQ authorization")
	}
	return json.Marshal(PQTransaction{Version: 1, Type: kind, WireHex: hex.EncodeToString(wire)})
}

// Exact decoder before the lower-case hex scan optimization.
func pqEnvelopeLegacyDecode(payload []byte) (PQTransaction, []byte, error) {
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

func TestABCIPQEnvelopeDecodingDifferential(t *testing.T) {
	inputs := [][]byte{nil, {}, []byte("{}"), []byte("null"), []byte("[]"), []byte("{bad"), []byte(`{"version":1,"type":"unknown","wireHex":"ab"}`), []byte(`{"version":1,"type":"pq_transfer","wireHex":""}`)}
	for _, kind := range []string{PQTransferType, PQMigrationType, PQRevocationType, PQWholeType, PQEthereumValueType, PQInitialRegistrationType} {
		payload, err := EncodePQTransaction(kind, []byte{0xab, 0xcd, 0xef, 0, 0x12})
		if err != nil {
			t.Fatal(err)
		}
		inputs = append(inputs, payload, append(bytes.Clone(payload), ' '), bytes.Replace(payload, []byte("abcdef"), []byte("ABCDEF"), 1), bytes.Replace(payload, []byte("abcdef"), []byte("abcdeG"), 1), bytes.Replace(payload, []byte("abcdef"), []byte("abcde"), 1), bytes.Replace(payload, []byte(`"version":1`), []byte(`"version":1,"version":1`), 1), bytes.Replace(payload, []byte(`"version":1`), []byte(`"version":2`), 1), bytes.Replace(payload, []byte(`"wireHex":`), []byte(`"wireHex":"ab","wireHex":`), 1), bytes.Replace(payload, []byte(`"wireHex":`), []byte(`"WireHex":`), 1), bytes.Replace(payload, []byte("ab"), []byte(`\u0061b`), 1))
	}
	for i, payload := range inputs {
		want, ww, we := pqEnvelopeLegacyDecode(payload)
		got, gw, ge := DecodePQTransaction(payload)
		if got != want || !bytes.Equal(ww, gw) || (we == nil) != (ge == nil) || we != nil && we.Error() != ge.Error() {
			t.Fatalf("decoder behavior differs at case%d: %v / %v", i, we, ge)
		}
	}
	// Every byte value is decoded through the original canonical envelope.
	wire := make([]byte, 256)
	for i := range wire {
		wire[i] = byte(i)
	}
	payload, _ := EncodePQTransaction(PQTransferType, wire)
	_, got, err := DecodePQTransaction(payload)
	if err != nil || !bytes.Equal(got, wire) {
		t.Fatal("byte roundtrip", err)
	}
	if _, _, err = DecodePQTransaction(bytes.Replace(payload, []byte("aa"), []byte("aA"), 1)); err == nil {
		t.Fatal("mixed-case hex accepted")
	}
	if _, _, err = DecodePQTransaction([]byte(strings.Replace(string(payload), "00", "０0", 1))); err == nil {
		t.Fatal("non-ASCII hex accepted")
	}
}

var pqEnvelopeDecodedSink []byte
var pqEnvelopeTxSink PQTransaction

func TestABCIPQEnvelopeDecodingAllocationCost(t *testing.T) {
	payload, _ := EncodePQTransaction(PQTransferType, make([]byte, 59123))
	cost := func(decode func([]byte) (PQTransaction, []byte, error)) float64 {
		return testing.AllocsPerRun(20, func() {
			var err error
			pqEnvelopeTxSink, pqEnvelopeDecodedSink, err = decode(payload)
			if err != nil {
				panic(err)
			}
		})
	}
	old, newCost := cost(pqEnvelopeLegacyDecode), cost(DecodePQTransaction)
	if newCost >= old {
		t.Fatalf("decoder allocation reduction absent: old=%v candidate=%v", old, newCost)
	}
}
func BenchmarkABCIPQEnvelopeDecode(b *testing.B) {
	payload, _ := EncodePQTransaction(PQTransferType, make([]byte, 59123))
	for _, c := range []struct {
		name string
		f    func([]byte) (PQTransaction, []byte, error)
	}{{"original", pqEnvelopeLegacyDecode}, {"candidate", DecodePQTransaction}} {
		b.Run(c.name, func(b *testing.B) {
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				var err error
				pqEnvelopeTxSink, pqEnvelopeDecodedSink, err = c.f(payload)
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
