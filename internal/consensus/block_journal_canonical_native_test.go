package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"reflect"
	"runtime"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
)

func TestBlockJournalCertificateCanonicalNativeMatchesStrictJSON(t *testing.T) {
	for _, at := range []time.Time{{}, time.Now(), time.Now().UTC(), time.Unix(1802736000, 123).In(time.FixedZone("offset-seconds", 12345))} {
		state := CommittedState{Version: 13, Accounts: []chain.ConsensusAccount{{Lots: nil}, {Lots: map[string]int64{}}, {Address: "<native>\u2028", Lots: map[string]int64{"a": 2}}}, FeeEvents: []BFTFeeEvent{{RecordedAt: at}}}
		v := reflect.ValueOf(&state).Elem()
		for i := 0; i < v.NumField(); i++ {
			f := v.Field(i)
			if f.Kind() == reflect.Slice && f.Len() == 0 {
				f.Set(reflect.MakeSlice(f.Type(), 0, 2))
			}
		}
		raw, err := encodeCommittedStateJSON(state)
		if err != nil {
			t.Fatal(err)
		}
		var expected CommittedState
		if err = decodeStrictJSON(raw, &expected); err != nil {
			t.Fatal(err)
		}
		got, ok := cloneCanonicalNativeCommittedState(state)
		if !ok || !reflect.DeepEqual(got, expected) {
			t.Fatalf("normalization differs for %v", at)
		}
		encoded, err := encodeCommittedStateJSON(got)
		if err != nil || !bytes.Equal(raw, encoded) {
			t.Fatal("canonical bytes differ", err)
		}
		got.Accounts[2].Lots["a"] = 9
		got.FeeEvents[0].ID = "caller"
		if state.Accounts[2].Lots["a"] != 2 || state.FeeEvents[0].ID != "" {
			t.Fatal("candidate aliases input")
		}
	}
}

// Opt-in component measurement: real signed/committed history, one immutable
// payload, alternating control/candidate order. This is not a network TPS test.
func TestBlockJournalCertificateCanonicalNativeMatchedMeasurement(t *testing.T) {
	if os.Getenv("YNX_MEASURE_CANONICAL_NATIVE") != "1" {
		t.Skip("explicit bounded component measurement only")
	}
	migration, path := journalFixture(t)
	app, err := NewBlockJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	for nonce := uint64(1); nonce <= 32; nonce++ {
		res, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: int64(migration.Height) + int64(nonce), Time: time.Unix(1802736000+int64(nonce), 123).UTC(), Txs: [][]byte{journalTransfer(t, nonce)}})
		if err != nil || len(res.TxResults) != 1 || res.TxResults[0].Code != 0 {
			t.Fatal("real signed history execution", err)
		}
		if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeBlockJournal(context.Background(), raw, migration)
	if err != nil {
		t.Fatal(err)
	}
	control := func() CommittedState {
		var canonical CommittedState
		if err := decodeStrictJSON(decoded.SnapshotJSON, &canonical); err != nil {
			t.Fatal(err)
		}
		private, ok := cloneNativeCommittedState(canonical)
		if !ok {
			t.Fatal("control refused")
		}
		return private
	}
	candidate := func() CommittedState {
		private, ok := cloneCanonicalNativeCommittedState(decoded.State)
		if !ok {
			t.Fatal("candidate refused")
		}
		return private
	}
	expected := control()
	actual := candidate()
	if !reflect.DeepEqual(actual, expected) || len(actual.FeeEvents) != 32 {
		t.Fatal("candidate differs from control")
	}
	if err := actual.Validate(migration); err != nil {
		t.Fatal(err)
	}
	encoded, err := encodeCommittedStateJSON(actual)
	if err != nil || !bytes.Equal(encoded, decoded.SnapshotJSON) {
		t.Fatal("canonical bytes differ", err)
	}
	// Both paths already warm above. Keep all correctness checks outside the
	// timed section and consume each result so neither path can be eliminated.
	measure := func(fn func() CommittedState) time.Duration {
		started := time.Now()
		for i := 0; i < 32; i++ {
			state := fn()
			runtime.KeepAlive(state)
		}
		return time.Since(started)
	}
	var controlTotal, candidateTotal time.Duration
	for round := 0; round < 7; round++ {
		var old, next time.Duration
		if round%2 == 0 {
			old, next = measure(control), measure(candidate)
		} else {
			next, old = measure(candidate), measure(control)
		}
		controlTotal += old
		candidateTotal += next
		t.Logf("round=%d iterations=32 strictJSONAndCloneNs=%d canonicalNativeNs=%d", round, old.Nanoseconds(), next.Nanoseconds())
	}
	t.Logf("componentOnly=true signedBusiness=32 feeEvents=%d payloadBytes=%d iterationsPerPath=224 controlNs=%d candidateNs=%d go=%s os=%s arch=%s gomaxprocs=%d networkProof=false", len(actual.FeeEvents), len(decoded.SnapshotJSON), controlTotal.Nanoseconds(), candidateTotal.Nanoseconds(), runtime.Version(), runtime.GOOS, runtime.GOARCH, runtime.GOMAXPROCS(0))
	oldDecoder, err := NewBlockJournalNativeSuffixPrefixDecoder(migration)
	if err != nil {
		t.Fatal(err)
	}
	nextDecoder, err := NewBlockJournalCanonicalNativePrefixDecoder(migration)
	if err != nil {
		t.Fatal(err)
	}
	publication := func(d *BlockJournalPrefixDecoder) func() CommittedState {
		return func() CommittedState {
			certificate, err := d.makePrefixCertificate(raw, decoded, 32, nil)
			if err != nil || certificate.native == nil {
				t.Fatal("publication failed", err)
			}
			return *certificate.native
		}
	}
	oldPublish, nextPublish := publication(oldDecoder), publication(nextDecoder)
	if !reflect.DeepEqual(oldPublish(), nextPublish()) {
		t.Fatal("publication differs")
	}
	controlTotal, candidateTotal = 0, 0
	for round := 0; round < 7; round++ {
		var old, next time.Duration
		if round%2 == 0 {
			old, next = measure(oldPublish), measure(nextPublish)
		} else {
			next, old = measure(nextPublish), measure(oldPublish)
		}
		controlTotal += old
		candidateTotal += next
		t.Logf("publishRound=%d iterations=32 controlNs=%d candidateNs=%d", round, old.Nanoseconds(), next.Nanoseconds())
	}
	t.Logf("publicationOnly=true canonicalByteCheck=true signedBusiness=32 iterationsPerPath=224 controlNs=%d candidateNs=%d networkProof=false", controlTotal.Nanoseconds(), candidateTotal.Nanoseconds())
	// Whole-process allocation counters bracket only the same publication calls.
	// No forced GC or runtime setting changes; alternating order retains actual
	// collector behavior. This component probe cannot explain network RSS alone.
	type allocationSample struct {
		ElapsedNs                            int64
		Bytes, Mallocs, Collections, PauseNs uint64
	}
	allocations := func(fn func() CommittedState) allocationSample {
		var before, after runtime.MemStats
		runtime.ReadMemStats(&before)
		elapsed := measure(fn)
		runtime.ReadMemStats(&after)
		return allocationSample{ElapsedNs: elapsed.Nanoseconds(), Bytes: after.TotalAlloc - before.TotalAlloc, Mallocs: after.Mallocs - before.Mallocs, Collections: uint64(after.NumGC - before.NumGC), PauseNs: after.PauseTotalNs - before.PauseTotalNs}
	}
	var oldTotal, nextTotal allocationSample
	add := func(total *allocationSample, v allocationSample) {
		total.ElapsedNs += v.ElapsedNs
		total.Bytes += v.Bytes
		total.Mallocs += v.Mallocs
		total.Collections += v.Collections
		total.PauseNs += v.PauseNs
	}
	for round := 0; round < 7; round++ {
		var old, next allocationSample
		if round%2 == 0 {
			old, next = allocations(oldPublish), allocations(nextPublish)
		} else {
			next, old = allocations(nextPublish), allocations(oldPublish)
		}
		add(&oldTotal, old)
		add(&nextTotal, next)
		t.Logf("allocRound=%d iterations=32 controlBytes=%d candidateBytes=%d controlMallocs=%d candidateMallocs=%d controlGC=%d candidateGC=%d controlPauseNs=%d candidatePauseNs=%d", round, old.Bytes, next.Bytes, old.Mallocs, next.Mallocs, old.Collections, next.Collections, old.PauseNs, next.PauseNs)
	}
	data, err := json.Marshal(map[string]any{"componentOnly": true, "wholeProcessCounters": true, "forcedGC": false, "networkRSSCauseProved": false, "signedBusiness": 32, "payloadBytes": len(decoded.SnapshotJSON), "iterationsPerPath": 224, "control": oldTotal, "candidate": nextTotal})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("REAL_MATCHED_PUBLICATION_ALLOCATION %s", data)
}

type futureCertificateScalar string

func (futureCertificateScalar) MarshalJSON() ([]byte, error) { return []byte(`"changed"`), nil }

func TestBlockJournalCertificateCanonicalNativeRejectsUnsupportedShapes(t *testing.T) {
	// Construct the ambiguous future schema dynamically: retaining this negative
	// case must not make go vet reject the test file's static struct tags.
	duplicate := reflect.New(reflect.StructOf([]reflect.StructField{
		{Name: "A", Type: reflect.TypeOf(""), Tag: `json:"same"`},
		{Name: "B", Type: reflect.TypeOf(""), Tag: `json:"same"`},
	})).Elem().Interface()
	for _, value := range []any{struct{ Future *string }{}, struct{ Value futureCertificateScalar }{}, struct {
		Hidden string `json:"-"`
	}{}, duplicate, struct {
		N int `json:",string"`
	}{}, struct {
		A int `json:"a\\bad"`
		B int `json:"A"`
	}{A: 3, B: 4}} {
		n := nativeCertificateNormalizer{plans: make(map[reflect.Type]nativeCertificateTypePlan)}
		v := reflect.New(reflect.TypeOf(value))
		v.Elem().Set(reflect.ValueOf(value))
		if n.normalize(v.Elem()) {
			t.Fatalf("future/custom schema accepted: %T", value)
		}
	}
	state := CommittedState{Accounts: []chain.ConsensusAccount{{Address: string([]byte{0xff})}}}
	if _, ok := cloneCanonicalNativeCommittedState(state); ok {
		t.Fatal("invalid UTF8 needs original JSON normalization")
	}
	state = CommittedState{FeeEvents: []BFTFeeEvent{{RecordedAt: time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)}}}
	if _, ok := cloneCanonicalNativeCommittedState(state); ok {
		t.Fatal("invalid JSON timestamp accepted")
	}
}

func TestBlockJournalCertificateCanonicalNativeRetainsRealSignedStateValidation(t *testing.T) {
	migration, path := journalFixture(t)
	app, err := NewBlockJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	for nonce := uint64(1); nonce <= 4; nonce++ {
		res, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: int64(migration.Height) + int64(nonce), Time: time.Unix(1802736000+int64(nonce), 123).UTC(), Txs: [][]byte{journalTransfer(t, nonce)}})
		if err != nil || res.TxResults[0].Code != 0 {
			t.Fatal("real signed business execution", err)
		}
		if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		decoded, err := DecodeBlockJournal(context.Background(), raw, migration)
		if err != nil {
			t.Fatal(err)
		}
		private, ok := cloneCanonicalNativeCommittedState(decoded.State)
		if !ok {
			t.Fatal("real native state refused")
		}
		var control CommittedState
		if err = decodeStrictJSON(decoded.SnapshotJSON, &control); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(private, control) {
			t.Fatal("real canonical state differs")
		}
		if err = private.Validate(migration); err != nil {
			t.Fatal("full validation must remain valid", err)
		}
		encoded, err := encodeCommittedStateJSON(private)
		if err != nil || !bytes.Equal(encoded, decoded.SnapshotJSON) || len(private.FeeEvents) != int(nonce) {
			t.Fatal("history/hash/bytes changed", err)
		}
	}
}
