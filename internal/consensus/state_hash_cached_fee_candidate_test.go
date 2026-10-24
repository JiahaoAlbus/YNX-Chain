package consensus

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"io"
	"math"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestCachedFeeHashCandidateExactBytes(t *testing.T) {
	_, actual := retainedSealFixture(t)
	weird := "\x00<>&\"\\\n汉字\u2028\u2029" + string([]byte{0xff})
	for _, fees := range [][]BFTFeeEvent{nil, {}, actual.FeeEvents, {{ID: weird, PolicyVersion: -1, TxHash: strings.Repeat(weird, 2000), Payer: weird, Recipient: weird, TransactionType: weird, Source: weird, AuditHash: weird, GrossFeeYNXT: math.MinInt64, TreasuryYNXT: math.MaxInt64, Sponsored: true, RecordedAt: time.Date(2026, 1, 2, 3, 4, 5, 123, time.FixedZone("odd", 137*60))}}} {
		state := actual
		state.FeeEvents = fees
		for version := 1; version <= 13; version++ {
			doc := state.hashDocument("domain\x00<>&", version)
			want, err := json.Marshal(doc)
			if err != nil {
				t.Fatal(err)
			}
			var got bytes.Buffer
			if err = encodeCachedFeeDocument(&got, doc); err != nil || !bytes.Equal(got.Bytes(), want) {
				t.Fatalf("canonical bytes differ len=%d/version%d: %v", len(fees), version, err)
			}
			digest, err := hashCachedFeeDocument(doc)
			oracle, _ := legacyHashDocument(doc)
			if err != nil || digest != oracle {
				t.Fatal("canonical hash differs", err)
			}
		}
	}
	// Each non-ASCII/escaping byte must preserve encoding/json replacement rules.
	for value := 0; value < 256; value++ {
		s := string([]byte{byte(value)})
		want, _ := json.Marshal(s)
		if !bytes.Equal(appendCachedJSONString(nil, s), want) {
			t.Fatal("string byte differs", value)
		}
	}
	for _, when := range []time.Time{time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(2026, 1, 1, 0, 0, 0, 0, time.FixedZone("bad", 25*3600))} {
		state := actual
		state.FeeEvents = []BFTFeeEvent{{RecordedAt: when}}
		doc := state.hashDocument("domain", 13)
		if _, err := json.Marshal(doc); err == nil {
			t.Fatal("oracle accepted invalid time")
		}
		if digest, err := hashCachedFeeDocument(doc); err == nil || digest != "" {
			t.Fatal("candidate published hash after encoding error")
		}
	}
}

type cachedFeeFailSink struct {
	err   error
	short bool
}

func (w cachedFeeFailSink) Write(b []byte) (int, error) {
	if w.short {
		return len(b) - 1, nil
	}
	return 0, w.err
}
func TestCachedFeeHashCandidateSinkAndFraming(t *testing.T) {
	_, state := retainedSealFixture(t)
	doc := state.hashDocument("domain", 13)
	first := errors.New("first sink failure")
	if err := encodeCachedFeeDocument(cachedFeeFailSink{err: first}, doc); !errors.Is(err, first) {
		t.Fatal(err)
	}
	if err := encodeCachedFeeDocument(cachedFeeFailSink{short: true}, doc); !errors.Is(err, io.ErrShortWrite) {
		t.Fatal(err)
	}
	for _, raw := range []string{"", "{}", "{}\n"} {
		w := cachedFeeScaffoldWriter{destination: io.Discard}
		if _, err := w.Write([]byte(raw)); err == nil {
			t.Fatal("invalid/missing scaffold accepted")
		}
	}
	var sink bytes.Buffer
	w := cachedFeeScaffoldWriter{destination: &sink, fees: state.FeeEvents}
	doc.FeeEvents = []BFTFeeEvent{{}}
	raw, _ := json.Marshal(doc)
	raw = append(raw, '\n')
	if _, err := w.Write(raw); err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write(raw); err == nil {
		t.Fatal("repeated scaffold accepted")
	}
}

func TestCachedFeeHashCandidateStringBytePairs(t *testing.T) {
	// Standard encoder oracle covers all byte pairs, including valid/invalid
	// UTF-8 boundaries, HTML characters, controls and escaping after a safe
	// prefix. A table lookup must not turn any byte into unchecked JSON.
	for first := 0; first < 256; first++ {
		for second := 0; second < 256; second++ {
			value := "prefix" + string([]byte{byte(first), byte(second)}) + "suffix"
			want, err := json.Marshal(value)
			if err != nil || !bytes.Equal(appendCachedJSONString(nil, value), want) {
				t.Fatalf("JSON bytes differ for pair %02x %02x: %v", first, second, err)
			}
		}
	}
}

func BenchmarkCachedFeeHashActualHistory(b *testing.B) {
	_, state := retainedSealFixture(b)
	doc := state.hashDocument("YNX_ABCI_STATE_V13", CommittedStateVersion)
	want, err := legacyHashDocument(doc)
	if err != nil || want != state.AppHash {
		b.Fatal("real fixture hash differs", err)
	}
	for _, mode := range []struct {
		name string
		hash func(committedStateHashDocument) (string, error)
	}{{"A-original", hashSingleBufferDocument}, {"B-direct", hashCachedFeeDocument}, {"B-direct", hashCachedFeeDocument}, {"A-original", hashSingleBufferDocument}, {"A-original", hashSingleBufferDocument}, {"B-direct", hashCachedFeeDocument}} {
		b.Run(mode.name, func(b *testing.B) {
			got, err := mode.hash(doc)
			if err != nil || got != want {
				b.Fatal("hash differs", err)
			}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				stateHashSink, err = mode.hash(doc)
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func TestCachedFeeHashCandidateParallelPrivateBuffers(t *testing.T) {
	_, state := retainedSealFixture(t)
	doc := state.hashDocument("YNX_ABCI_STATE_V13", CommittedStateVersion)
	want, _ := legacyHashDocument(doc)
	for worker := 0; worker < 4; worker++ {
		t.Run("worker", func(t *testing.T) {
			t.Parallel()
			for i := 0; i < 4; i++ {
				got, err := hashCachedFeeDocument(doc)
				if err != nil || got != want {
					t.Fatal("private encoder buffer changed hash", err)
				}
			}
		})
	}
}

func TestCachedFeeHashCandidateTimestampRepresentationsAndLateErrors(t *testing.T) {
	_, state := retainedSealFixture(t)
	at := time.Date(2026, 10, 24, 1, 2, 3, 456, time.UTC)
	values := []time.Time{at, at, at.In(time.FixedZone("sameInstantDifferentJSON", 137*60)), at.In(time.FixedZone("sameInstantOtherOffset", -45*60)), at, time.Now(), time.Time{}, at}
	state.FeeEvents = append([]BFTFeeEvent(nil), state.FeeEvents[:len(values)]...)
	for i, value := range values {
		state.FeeEvents[i].RecordedAt = value
	}
	doc := state.hashDocument("YNX_ABCI_STATE_V13", CommittedStateVersion)
	var out bytes.Buffer
	if err := encodeCachedFeeDocument(&out, doc); err != nil {
		t.Fatal(err)
	}
	want, err := json.Marshal(doc)
	if err != nil || !bytes.Equal(out.Bytes(), want) {
		t.Fatal("timestamp timezone/monotonic/cache boundary bytes differ", err)
	}
	bad := time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)
	state.FeeEvents[len(values)-1].RecordedAt = bad
	doc = state.hashDocument("YNX_ABCI_STATE_V13", CommittedStateVersion)
	if _, err := hashCachedFeeDocument(doc); err == nil {
		t.Fatal("late invalid timestamp accepted")
	}
	var cache feeJSONTimeCache
	if _, err := cache.encode(at); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err := cache.encode(bad); err == nil {
			t.Fatal("failed timestamp cached as valid")
		}
	}
	got, err := cache.encode(at)
	want, originalErr := at.MarshalJSON()
	if err != nil || originalErr != nil || !bytes.Equal(got, want) {
		t.Fatal("failed miss poisoned original valid timestamp")
	}
}

// Full original semantics still run. This test-only injection changes the hash
// implementation only, without adding a production selector or cached authority.
func validateStateWithCachedFeeCandidate(s CommittedState, migration chain.ConsensusMigrationState) error {
	if err := s.validateSemantics(migration); err != nil {
		return err
	}
	expected := migration.StateHash
	if s.hasApplicationRecords() || !accountsEqual(s.Accounts, migration.Accounts) {
		var err error
		expected, err = hashCachedFeeDocument(s.hashDocument("YNX_ABCI_STATE_V13", CommittedStateVersion))
		if err != nil {
			return fmt.Errorf("encode committed state hash document: %w", err)
		}
	}
	if !strings.EqualFold(s.AppHash, expected) {
		return fmt.Errorf("committed app hash mismatch: expected %s", expected)
	}
	return nil
}
func TestCachedFeeHashCandidateFullValidateFirstCause(t *testing.T) {
	migration, actual := retainedSealFixture(t)
	for _, kind := range []string{"actual", "anchor", "tampered-hash", "late-fee", "supply", "invalid-time"} {
		state := actual
		state.Accounts = cloneAccounts(actual.Accounts)
		state.FeeEvents = append([]BFTFeeEvent(nil), actual.FeeEvents...)
		switch kind {
		case "anchor":
			state = initialCommittedState(migration)
		case "tampered-hash":
			state.AppHash = strings.Repeat("0", 64)
		case "late-fee":
			state.FeeEvents[len(state.FeeEvents)-1].AuditHash = "bad"
		case "supply":
			state.Accounts[0].Balance++
		case "invalid-time":
			event := &state.FeeEvents[len(state.FeeEvents)-1]
			event.RecordedAt = time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)
			event.AuditHash = feeEventAuditHash(*event)
		}
		a, b := state.Validate(migration), validateStateWithCachedFeeCandidate(state, migration)
		if (a == nil) != (b == nil) || a != nil && a.Error() != b.Error() {
			t.Fatal(kind, a, b)
		}
		if kind != "actual" && kind != "anchor" && b == nil {
			t.Fatal("invalid state accepted", kind)
		}
		if kind == "invalid-time" {
			var x, y *json.MarshalerError
			if !errors.As(a, &x) || !errors.As(b, &y) || x.Type != y.Type || x.Err.Error() != y.Err.Error() {
				t.Fatal("original encoder error identity differs", a, b)
			}
		}
	}
}
func BenchmarkCachedFeeFullValidateActualHistory(b *testing.B) {
	migration, state := retainedSealFixture(b)
	for _, mode := range []struct {
		name string
		run  func(CommittedState, chain.ConsensusMigrationState) error
	}{
		{"A-original", func(s CommittedState, m chain.ConsensusMigrationState) error { return s.Validate(m) }}, {"B-cached", validateStateWithCachedFeeCandidate}, {"B-cached2", validateStateWithCachedFeeCandidate}, {"A-original2", func(s CommittedState, m chain.ConsensusMigrationState) error { return s.Validate(m) }}, {"A-original3", func(s CommittedState, m chain.ConsensusMigrationState) error { return s.Validate(m) }}, {"B-cached3", validateStateWithCachedFeeCandidate},
	} {
		b.Run(mode.name, func(b *testing.B) {
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if err := mode.run(state, migration); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func TestCachedFeeHashCandidateClosedFeeSchema(t *testing.T) {
	typ := reflect.TypeOf(BFTFeeEvent{})
	want := []string{"id", "policyVersion", "txHash", "transactionType", "payer", "recipient", "grossFeeYnxt", "burnYnxt", "validatorYnxt", "providerYnxt", "protocolYnxt", "treasuryYnxt", "sponsored", "source", "blockHeight", "recordedAt", "auditHash"}
	if typ.NumField() != len(want) {
		t.Fatal("fee schema grew; explicit encoder must be reviewed", typ.NumField())
	}
	for i, name := range want {
		if typ.Field(i).Tag.Get("json") != name {
			t.Fatal("fee field/tag/order changed", i, typ.Field(i))
		}
	}
}
