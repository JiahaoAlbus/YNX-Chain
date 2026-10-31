package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"os"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

// Exact DecodePQTransaction body from fdc08527514587d5756264e43ab63588791e189a,
// account_policy.go blob 138c8d94be3a0cd72530467a3dbbaf9df7ae959d. This test-only
// oracle deliberately retains the original parser, allocations and error order.
func pqDecoderBefore(payload []byte) (PQTransaction, []byte, error) {
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

type pqDecoderFixture struct {
	Version       string        `json:"version"`
	SourceCommit  string        `json:"sourceCommit"`
	Wire          []byte        `json:"wire"`
	NativeHash    string        `json:"nativeHash"`
	ABCIHash      string        `json:"abciHash"`
	NativeChainID int64         `json:"nativeChainID"`
	Height        uint64        `json:"height"`
	Policy        ynxauth.State `json:"policy"`
}

func pqDecoderPublicFixture(t testing.TB) (pqDecoderFixture, []byte) {
	t.Helper()
	raw, err := os.ReadFile("testdata/pq_decoder_fast_whole_v1.json")
	if err != nil {
		t.Fatal(err)
	}
	if sum := sha256.Sum256(raw); hex.EncodeToString(sum[:]) != "56fcfc6443455947f952745290052cce4ef3d5dcc1eede5177a6adce8becef0f" {
		t.Fatal("fixed public baseline fixture bytes changed")
	}
	var f pqDecoderFixture
	if err = json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	payload, err := EncodePQTransaction(PQWholeType, f.Wire)
	if err != nil {
		t.Fatal(err)
	}
	if f.Version != "YNX-PQ-DECODER-PUBLIC-FIXTURE/v1" ||
		f.SourceCommit != "fdc08527514587d5756264e43ab63588791e189a" ||
		len(f.Wire) != 57814 || len(payload) != 115672 ||
		SignedTransactionHash(f.Wire) != f.NativeHash || SignedTransactionHash(payload) != f.ABCIHash {
		t.Fatal("public baseline size, provenance or original identities changed")
	}
	return f, payload
}

func pqDecoderCompare(t testing.TB, payload []byte) {
	t.Helper()
	before := bytes.Clone(payload)
	a, aw, ae := pqDecoderBefore(payload)
	b, bw, be := DecodePQTransaction(payload)
	if a != b || !reflect.DeepEqual(aw, bw) || reflect.TypeOf(ae) != reflect.TypeOf(be) ||
		fmt.Sprint(ae) != fmt.Sprint(be) || !reflect.DeepEqual(ae, be) {
		t.Fatalf("decoder differential at input bytes=%d: txEqual=%t wireEqual=%t errors=(%T %v)/(%T %v)",
			len(payload), a == b, reflect.DeepEqual(aw, bw), ae, ae, be, be)
	}
	if !bytes.Equal(before, payload) {
		t.Fatal("decoder mutated caller input")
	}
	if be == nil {
		encoded, err := EncodePQTransaction(b.Type, bw)
		if err != nil || !bytes.Equal(encoded, payload) || SignedTransactionHash(encoded) != SignedTransactionHash(payload) {
			t.Fatal("successful decode changed canonical transport or ABCI transaction identity")
		}
	}
}

func TestPQDecoderFastDifferential(t *testing.T) {
	_, original := pqDecoderPublicFixture(t)
	for _, kind := range []string{PQTransferType, PQMigrationType, PQRevocationType, PQWholeType, PQEthereumValueType, PQInitialRegistrationType} {
		for _, size := range []int{1, 128, 57814, pqDecoderFastMaxWire, pqDecoderFastMaxWire + 1} {
			t.Run(fmt.Sprintf("%s/%d", kind, size), func(t *testing.T) {
				wire := bytes.Repeat([]byte{0xab}, size)
				payload, err := EncodePQTransaction(kind, wire)
				if err != nil {
					t.Fatal(err)
				}
				pqDecoderCompare(t, payload)
				_, _, _, handled := tryDecodePQCanonicalWhole(payload)
				if handled != (kind == PQWholeType && size <= pqDecoderFastMaxWire) {
					t.Fatal("optimization ceiling or non-Whole fallback changed")
				}
			})
		}
	}
	// Retain both the exact error and the partially decoded struct, including
	// encoding/json.SyntaxError.Offset and UnmarshalTypeError fields.
	bad := [][]byte{
		nil, {}, []byte(`null`), []byte(`[]`), []byte(`"object"`),
		[]byte(`{"version":1,"type":"pq_whole","wireHex":""}`),
		[]byte(`{"version":1,"type":"pq_whole","wireHex":null}`),
		[]byte(`{"version":"1","type":"pq_whole","wireHex":"ab"}`),
		[]byte(`{"version":1.5,"type":"pq_whole","wireHex":"ab"}`),
		[]byte(`{"version":9223372036854775808,"type":"pq_whole","wireHex":"ab"}`),
		[]byte(`{"version":1,"type":"pq_whole","wireHex":12}`),
		[]byte(`{"version":1,"type":"pq_whole","wireHex":"ab","other":true}`),
		[]byte(`{"version":1,"type":"pq_whole","wireHex":"ab","wireHex":"GG"}`),
		[]byte(`{"version":1,"type":"pq_whole","wireHex":"GG","wireHex":"ab"}`),
		[]byte(`{"version":1,"type":"pq_whole","wireHex":"ab","Version":2}`),
		[]byte(`{"version":1,"type":"pq_whole","wireHex":"\u0061b"}`),
		[]byte(`{"version":1,"type":"pq_whole","wireHex":"\ud800"}`),
		[]byte(`{"version":1,"type":"pq_whole","wireHex":"\q"}`),
		[]byte(`{"version":1,"type":"pq_whole","wireHex":"ab"}null`),
		[]byte(`{"wireHex":"ab","type":"pq_whole","version":1}`),
		[]byte(`{"version":1,"type":"unsupported","wireHex":"ab"}`),
		bytes.Replace(original, []byte(`"version":1`), []byte(`"version":1,"version":1`), 1),
		append(bytes.Clone(original), ' '),
		bytes.Repeat([]byte{'x'}, MaxPQWholeTransactionBytes+1),
	}
	for i, payload := range bad {
		t.Run(fmt.Sprintf("malformed/%d", i), func(t *testing.T) { pqDecoderCompare(t, payload) })
	}
	// Every possible last byte includes plain nonhex, uppercase, quote, slash,
	// controls and malformed UTF-8. A later structural byte must override an
	// earlier nonhex byte exactly as in the original parser.
	for b := 0; b < 256; b++ {
		payload := bytes.Clone(original)
		payload[len(payload)-3] = byte(b)
		pqDecoderCompare(t, payload)
		payload[len(payload)-7] = 'G'
		pqDecoderCompare(t, payload)
	}
	rng := rand.New(rand.NewSource(20261031))
	for i := 0; i < 256; i++ {
		payload := bytes.Clone(original)
		for k := 0; k < 1+rng.Intn(4); k++ {
			payload[rng.Intn(len(payload))] = byte(rng.Intn(256))
		}
		pqDecoderCompare(t, payload)
	}
}

func TestPQDecoderFastRejectWorkAndAllocationBound(t *testing.T) {
	_, payload := pqDecoderPublicFixture(t)
	for _, position := range []int{len(payload) - 3, len(payload) / 2} {
		bad := bytes.Clone(payload)
		bad[position] = 'G'
		tx, wire, err, handled := tryDecodePQCanonicalWhole(bad)
		if !handled || wire != nil || tx.Type != PQWholeType || len(tx.WireHex) != 2*57814 || err == nil || err.Error() != "noncanonical ABCI PQ wire" {
			t.Fatal("plain ASCII invalid hex lost exact reference rejection or fell back")
		}
		pqDecoderCompare(t, bad)
		if n := testing.AllocsPerRun(5, func() { _, _, _ = DecodePQTransaction(bad) }); n > 3 {
			t.Fatalf("invalid hex speculatively allocated wire/parser buffers: %g allocations", n)
		}
	}
	odd := append(bytes.Clone(payload[:len(payload)-3]), payload[len(payload)-2:]...)
	pqDecoderCompare(t, odd)
	if _, _, _, handled := tryDecodePQCanonicalWhole(odd); !handled {
		t.Fatal("plain odd hex unnecessarily fell back")
	}
	oversize := make([]byte, MaxPQWholeTransactionBytes+1)
	// The reference's tx escapes through json.Decode even on its early return;
	// that fixed allocation plus error is not an input-sized decoder buffer.
	oversizeBefore := testing.AllocsPerRun(5, func() { _, _, _ = pqDecoderBefore(oversize) })
	oversizeAfter := testing.AllocsPerRun(5, func() { _, _, _ = DecodePQTransaction(oversize) })
	if oversizeAfter > oversizeBefore || oversizeAfter > 2 {
		t.Fatalf("oversized envelope added allocations: before=%g after=%g", oversizeBefore, oversizeAfter)
	}
	if n := testing.AllocsPerRun(5, func() { _, _, _ = DecodePQTransaction(payload) }); n > 4 {
		t.Fatalf("ordinary fast decode allocation regression: %g", n)
	}
	// Complex malformed data incurs at most one bounded classification pass,
	// not speculative output buffers or an additional JSON decoder.
	complex := bytes.Clone(payload)
	complex[len(complex)-4] = '\\'
	pqDecoderCompare(t, complex)
	before := testing.AllocsPerRun(5, func() { _, _, _ = pqDecoderBefore(complex) })
	after := testing.AllocsPerRun(5, func() { _, _, _ = DecodePQTransaction(complex) })
	if after > before {
		t.Fatalf("fallback added allocations: before=%g after=%g", before, after)
	}
}

func TestPQDecoderFastDetachedConcurrentOwnership(t *testing.T) {
	_, original := pqDecoderPublicFixture(t)
	for _, invalid := range []bool{false, true} {
		input := bytes.Clone(original)
		if invalid {
			input[len(input)-3] = 'G'
		}
		tx, wire, _ := DecodePQTransaction(input)
		wantTx, wantWire := tx, bytes.Clone(wire)
		for i := range input {
			input[i] = 0
		}
		if tx != wantTx || !bytes.Equal(wire, wantWire) || strings.ContainsRune(tx.WireHex, 0) {
			t.Fatal("returned wire/string aliases caller buffer")
		}
	}
	var wg sync.WaitGroup
	failures := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for n := 0; n < 8; n++ {
				want, wantWire, wantErr := pqDecoderBefore(original)
				got, wire, err := DecodePQTransaction(original)
				if want != got || !bytes.Equal(wantWire, wire) || wantErr != nil || err != nil {
					failures <- errors.New("concurrent decode differs from original decoder")
					return
				}
				wire[0] ^= 1 // each call owns its own result even on shared input
			}
		}()
	}
	wg.Wait()
	close(failures)
	for err := range failures {
		t.Error(err)
	}
	_, expected := pqDecoderPublicFixture(t)
	if !bytes.Equal(original, expected) {
		t.Fatal("concurrent decode changed shared transport")
	}
}

func TestPQDecoderFastRealANDAndAdmission(t *testing.T) {
	fixed, payload := pqDecoderPublicFixture(t)
	pqDecoderCompare(t, payload)
	_, wire, err := DecodePQTransaction(payload)
	if err != nil {
		t.Fatal(err)
	}
	// The fixed 57,814-byte baseline is a real signed Whole. Full signatures,
	// both trees and the independently preserved fixture policy are checked.
	admission, err := authenticateConsensusBatch(wire, &fixed.Policy, fixed.Height, fixed.NativeChainID)
	if err != nil {
		t.Fatal(err)
	}
	admission.verifier.Clear()
	for _, branch := range []string{"A", "B"} {
		whole, err := ynxbatch.DecodeWhole(fixed.Wire)
		if err != nil {
			t.Fatal(err)
		}
		if branch == "A" {
			whole.Certificate.SigmaA[len(whole.Certificate.SigmaA)-1] ^= 1
		} else {
			whole.Certificate.SigmaB[len(whole.Certificate.SigmaB)-1] ^= 1
		}
		badWire, err := ynxbatch.EncodeWhole(whole)
		if err != nil {
			t.Fatal(err)
		}
		badPayload, err := EncodePQTransaction(PQWholeType, badWire)
		if err != nil {
			t.Fatal(err)
		}
		pqDecoderCompare(t, badPayload)
		_, parsed, err := DecodePQTransaction(badPayload)
		if err != nil {
			t.Fatal("transport decoder must not impersonate signature verification")
		}
		if v, err := authenticateConsensusBatch(parsed, &fixed.Policy, fixed.Height, fixed.NativeChainID); err == nil {
			v.verifier.Clear()
			t.Fatalf("branch %s signature corruption admitted", branch)
		}
	}
	f := activeABCIWholeFixture(t)
	before := mustJSON(t, f.a.committed)
	valid := abciWhole(t, f, f.transferMessage(t, false, 2, 1))
	wrongNonce := abciWhole(t, f, f.transferMessage(t, false, 9, 1))
	for _, tc := range []struct {
		name string
		wire []byte
		ok   bool
	}{{"valid-current-policy", valid, true}, {"wrong-current-nonce", wrongNonce, false}} {
		t.Run(tc.name, func(t *testing.T) {
			encoded := mustPQEnvelope(t, PQWholeType, tc.wire)
			pqDecoderCompare(t, encoded)
			check, err := f.a.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: encoded})
			if err != nil || (check.Code == 0) != tc.ok {
				t.Fatalf("real CheckTx admission changed: %+v %v", check, err)
			}
		})
	}
	for _, mode := range []string{"wrong-network", "wrong-full-pair", "pending-policy", "terminal-revocation"} {
		t.Run(mode, func(t *testing.T) {
			policy := fixed.Policy.Clone()
			height := fixed.Height
			switch mode {
			case "wrong-network":
				policy.NetworkID[0] ^= 1
			case "wrong-full-pair":
				policy.Records[0].PKA = bytes.Clone(f.otherPublic.PKA)
				policy.Records[0].PKB = bytes.Clone(f.otherPublic.PKB)
			case "pending-policy":
				policy.Records[0].ActiveFrom = fixed.Height + 1
			case "terminal-revocation":
				record := policy.Records[0]
				policy.Version = ynxauth.PolicyRevocationVersion
				policy.Revocations = []ynxauth.RevocationRecord{{Owner: record.Owner,
					AuthorizingRevision: record.Revision, ThroughRevision: record.Revision,
					RegisteredAt: fixed.Height, RevokedFrom: fixed.Height + 1, LedgerNonce: record.LedgerNonce + 1}}
				height++
			}
			if err := policy.Validate(policy.NetworkID); err != nil {
				t.Fatalf("negative case must use structurally valid trusted policy: %v", err)
			}
			if v, err := authenticateConsensusBatch(wire, &policy, height, fixed.NativeChainID); err == nil {
				v.verifier.Clear()
				t.Fatal("decoder result was treated as policy authorization")
			}
		})
	}
	if !bytes.Equal(before, mustJSON(t, f.a.committed)) {
		t.Fatal("CheckTx/negative decoder tests mutated committed policy or ledger")
	}
}

func FuzzPQDecoderFastDifferential(f *testing.F) {
	_, sample := pqDecoderPublicFixture(f)
	f.Add(sample)
	f.Add([]byte(`{"version":1,"type":"pq_whole","wireHex":"G0"}`))
	f.Add([]byte(`{"wireHex":"ab","type":"pq_whole","version":1}`))
	f.Fuzz(func(t *testing.T, payload []byte) {
		// Keep the differential fuzzer's *test* resource bound separate from
		// protocol admission. Maximum-envelope limits have explicit controls.
		if len(payload) > 256<<10 {
			return
		}
		pqDecoderCompare(t, payload)
	})
}

var pqDecoderBenchTx PQTransaction
var pqDecoderBenchWire []byte
var pqDecoderBenchErr error

func BenchmarkPQDecoderFast(b *testing.B) {
	_, payload := pqDecoderPublicFixture(b)
	lateInvalid := bytes.Clone(payload)
	lateInvalid[len(lateInvalid)-3] = 'G'
	complex := bytes.Clone(payload)
	complex[len(complex)-4] = '\\'
	large, err := EncodePQTransaction(PQWholeType, bytes.Repeat([]byte{0xab}, pqDecoderFastMaxWire+1))
	if err != nil {
		b.Fatal(err)
	}
	oversize := make([]byte, MaxPQWholeTransactionBytes+1)
	for _, tc := range []struct {
		name    string
		payload []byte
	}{
		{"PublicWhole57814", payload}, {"LateInvalidHex", lateInvalid},
		{"ComplexJSONFallback", complex}, {"LargerWholeFallback", large}, {"OversizeReject", oversize},
	} {
		pqDecoderCompare(b, tc.payload)
		for _, decoder := range []struct {
			name string
			call func([]byte) (PQTransaction, []byte, error)
		}{{"Before", pqDecoderBefore}, {"After", DecodePQTransaction}} {
			b.Run(tc.name+"/"+decoder.name, func(b *testing.B) {
				b.ReportAllocs()
				if tc.name != "OversizeReject" {
					b.SetBytes(int64(len(tc.payload)))
				}
				// Oversize rejection reads only length; do not report the whole
				// 16 MiB payload as processed bytes or a misleading byte rate.
				for i := 0; i < b.N; i++ {
					pqDecoderBenchTx, pqDecoderBenchWire, pqDecoderBenchErr = decoder.call(tc.payload)
				}
			})
		}
	}
}
