package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"math/rand"
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
