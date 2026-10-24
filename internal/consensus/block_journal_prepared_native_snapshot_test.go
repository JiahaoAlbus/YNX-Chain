package consensus

import (
	"bytes"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func originalEncodeAndOwnNativeSnapshot(state CommittedState) ([]byte, *preparedCanonicalNativeSnapshot, error) {
	public, err := encodeCommittedStateJSON(state)
	if err != nil {
		return nil, nil, err
	}
	payload := append([]byte(nil), public...)
	canonical, owned, err := decodeOwnedNativeCertificate(payload, state)
	if err != nil {
		return nil, nil, err
	}
	if owned {
		copyNativeAccountLots(&canonical)
	} else {
		var ok bool
		canonical, ok = cloneNativeCommittedState(canonical)
		if !ok {
			return public, nil, nil
		}
	}
	return public, &preparedCanonicalNativeSnapshot{payload: payload, state: canonical}, nil
}

func TestPreparedNativeSnapshotMatchesOriginalCompleteObjectAndBytes(t *testing.T) {
	_, actual := retainedSealFixture(t)
	special := "\x00<>&\"\\\n汉字\u2028\u2029"
	values := []CommittedState{{}, {Accounts: []chain.ConsensusAccount{}, FeeEvents: []BFTFeeEvent{}}, actual, {MigrationStateHash: special, Accounts: []chain.ConsensusAccount{{Address: special, Lots: map[string]int64{"z": 1, "a": 2, special: 3}}}, FeeEvents: []BFTFeeEvent{{ID: special, TxHash: strings.Repeat(special, 2000), RecordedAt: time.Date(2026, 1, 2, 3, 4, 5, 123, time.FixedZone("odd", 137*60))}}}}
	for i, state := range values {
		public, want, err := originalEncodeAndOwnNativeSnapshot(state)
		if err != nil || want == nil {
			t.Fatal("oracle not native", i, err)
		}
		got, err := prepareCanonicalNativeSnapshot(state)
		if err != nil || got == nil || !bytes.Equal(public, got.payload) || !reflect.DeepEqual(want.state, got.state) {
			t.Fatalf("owned encoded object differs case%d: %v", i, err)
		}
		if len(got.state.Accounts) > 0 && len(state.Accounts) > 0 {
			state.Accounts[0].Balance++
			if reflect.DeepEqual(state.Accounts[0], got.state.Accounts[0]) {
				t.Fatal("caller account aliases private state")
			}
		}
	}
	// Non-UTC JSON time, monotonic clock and omitted empty fields must normalize
	// exactly like a fresh strict target, without changing canonical JSON bytes.
	for _, when := range []time.Time{time.Now(), time.Date(0, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(9999, 12, 31, 23, 59, 59, 999999999, time.UTC)} {
		s := CommittedState{FeeEvents: []BFTFeeEvent{{RecordedAt: when}}}
		_, want, err := originalEncodeAndOwnNativeSnapshot(s)
		got, e := prepareCanonicalNativeSnapshot(s)
		if err != nil || e != nil || got == nil || !reflect.DeepEqual(want, got) {
			t.Fatal("canonical time/bytes differ", err, e)
		}
	}
}
func TestPreparedNativeSnapshotFallbackAndPrivateOwnership(t *testing.T) {
	_, actual := retainedSealFixture(t)
	for _, bad := range []CommittedState{{MigrationStateHash: string([]byte{0xff})}, {FeeEvents: []BFTFeeEvent{{ID: string([]byte{0xff})}}}, {FeeEvents: []BFTFeeEvent{{RecordedAt: time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)}}}} {
		got, err := prepareCanonicalNativeSnapshot(bad)
		if err != nil || got != nil {
			t.Fatal("unsupported canonical shape did not require original route", err)
		}
	}
	actual.Accounts[0].Lots = map[string]int64{"original": 1}
	got, err := prepareCanonicalNativeSnapshot(actual)
	if err != nil || got == nil {
		t.Fatal(err)
	}
	preserved := append([]byte(nil), got.payload...)
	actual.Accounts[0].Lots["original"] = 2
	actual.FeeEvents[0].ID = "changed"
	if got.state.Accounts[0].Lots["original"] != 1 || got.state.FeeEvents[0].ID == "changed" || !bytes.Equal(got.payload, preserved) {
		t.Fatal("caller mutated private snapshot")
	}
	public := append([]byte(nil), got.payload...)
	public[0] = '!'
	if got.payload[0] == '!' {
		t.Fatal("public byte copy aliases private payload")
	}
}

var preparedNativeSink *preparedCanonicalNativeSnapshot
var preparedPublicSink []byte

func BenchmarkPreparedNativeSnapshotActualHistory(b *testing.B) {
	_, state := retainedSealFixture(b)
	expectedPublic, expected, err := originalEncodeAndOwnNativeSnapshot(state)
	if err != nil {
		b.Fatal(err)
	}
	for index, newMode := range []bool{false, true, true, false, false, true} {
		b.Run(fmt.Sprintf("%02d_candidate%t", index, newMode), func(b *testing.B) {
			produce := func() ([]byte, *preparedCanonicalNativeSnapshot, error) {
				if !newMode {
					return originalEncodeAndOwnNativeSnapshot(state)
				}
				p, e := prepareCanonicalNativeSnapshot(state)
				if e != nil || p == nil {
					return nil, p, e
				}
				return append([]byte(nil), p.payload...), p, nil
			}
			public, got, e := produce()
			if e != nil || !bytes.Equal(public, expectedPublic) || !reflect.DeepEqual(got, expected) {
				b.Fatal("same actual-history complete bytes/object differ", e)
			}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				preparedPublicSink, preparedNativeSink, err = produce()
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func TestPreparedNativeSnapshotEveryOtherDomainFallsBack(t *testing.T) {
	_, actual := retainedSealFixture(t)
	typ := reflect.TypeOf(actual)
	for i := 0; i < typ.NumField(); i++ {
		field := typ.Field(i)
		if field.Name == "Accounts" || field.Name == "FeeEvents" || field.Type.Kind() != reflect.Slice {
			continue
		}
		bad := actual
		reflect.ValueOf(&bad).Elem().Field(i).Set(reflect.MakeSlice(field.Type, 1, 1))
		if got, err := prepareCanonicalNativeSnapshot(bad); err != nil || got != nil {
			t.Fatal("non-native record family accepted", field.Name, err)
		}
	}
	bad := actual
	bad.Accounts = append([]chain.ConsensusAccount(nil), actual.Accounts...)
	bad.Accounts[0].Lots = map[string]int64{string([]byte{0xff}): 1}
	if got, err := prepareCanonicalNativeSnapshot(bad); err != nil || got != nil {
		t.Fatal("invalid map key must use strict original route", err)
	}
}
func TestPreparedNativeSnapshotDoesNotGrantValidation(t *testing.T) {
	migration, state := retainedSealFixture(t)
	state.Accounts[0].Balance++
	got, err := prepareCanonicalNativeSnapshot(state)
	if err != nil || got == nil {
		t.Fatal(err)
	}
	if err := got.state.Validate(migration); err == nil {
		t.Fatal("prepared encoding bypassed full state validation")
	}
}
func TestPreparedNativeSnapshotParallelPrivateStorage(t *testing.T) {
	_, state := retainedSealFixture(t)
	_, want, err := originalEncodeAndOwnNativeSnapshot(state)
	if err != nil {
		t.Fatal(err)
	}
	for worker := 0; worker < 4; worker++ {
		t.Run("worker", func(t *testing.T) {
			t.Parallel()
			for i := 0; i < 3; i++ {
				got, err := prepareCanonicalNativeSnapshot(state)
				if err != nil || got == nil || !reflect.DeepEqual(got, want) {
					t.Fatal("parallel snapshot differs", err)
				}
			}
		})
	}
}
