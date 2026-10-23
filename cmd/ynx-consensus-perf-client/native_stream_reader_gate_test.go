package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"
)

func TestNativeStreamingReaderGateMeasuresRealWaitAndHold(t *testing.T) {
	_, migration, path, raw, height := durableJournalFixture(t, "block-journal")
	o := nativeStreamingOptions()
	r, err := newWorkloadDurableReader(migration, []string{path}, o)
	if err != nil {
		t.Fatal(err)
	}
	if err = r.configureNativeStreamingReplay(o); err != nil {
		t.Fatal(err)
	}
	r.profileMu.Lock()
	done := make(chan error, 1)
	go func() { _, err := r.verify(context.Background(), path, raw, height); done <- err }()
	select {
	case err := <-done:
		r.profileMu.Unlock()
		t.Fatal("readback bypassed original gate", err)
	case <-time.After(5 * time.Millisecond):
	}
	r.profileMu.Unlock()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("readback did not finish after gate release")
	}
	data, err := json.Marshal(r.stats())
	if err != nil {
		t.Fatal(err)
	}
	var actual struct {
		Gate *struct {
			Acquisitions uint64 `json:"acquisitions"`
			WaitNs       int64  `json:"waitNs"`
			MaxWaitNs    int64  `json:"maxWaitNs"`
			HoldNs       int64  `json:"holdNs"`
			MaxHoldNs    int64  `json:"maxHoldNs"`
		} `json:"readerGate"`
	}
	if err = json.Unmarshal(data, &actual); err != nil {
		t.Fatal(err)
	}
	if actual.Gate == nil {
		t.Fatal("actual outer reader gate wait/hold absent from original report")
	}
	gate := actual.Gate
	if gate.Acquisitions != 1 || gate.WaitNs <= 0 || gate.MaxWaitNs != gate.WaitNs || gate.HoldNs <= 0 || gate.MaxHoldNs != gate.HoldNs {
		t.Fatalf("original wait/hold not measured: %+v", gate)
	}
}

func TestNativeStreamingReaderGateRetainsFailureAndLegacyScope(t *testing.T) {
	_, migration, path, raw, height := durableJournalFixture(t, "block-journal")
	legacy, err := newDurableReaderWithLimits(migration, []string{path}, 32<<20, 32<<20)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = legacy.verify(context.Background(), path, raw, height); err != nil {
		t.Fatal(err)
	}
	legacyJSON, err := json.Marshal(legacy.stats())
	if err != nil || bytes.Contains(legacyJSON, []byte(`"readerGate"`)) {
		t.Fatal("legacy report changed", err)
	}
	o := nativeStreamingOptions()
	r, err := newWorkloadDurableReader(migration, []string{path}, o)
	if err != nil {
		t.Fatal(err)
	}
	if err = r.configureNativeStreamingReplay(o); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, data[:len(data)-1], 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = r.verify(context.Background(), path, raw, height); err == nil {
		t.Fatal("corrupt current store accepted")
	}
	got := r.stats()
	if got.ReaderGate == nil || got.ReaderGate.Acquisitions != 1 || got.ReaderGate.HoldNs <= 0 || got.Attempts != 1 || got.TransactionVerifications != 0 {
		t.Fatal("failed readback disappeared from outer gate measurement", got)
	}
	got.ReaderGate.Acquisitions = 999
	if r.stats().ReaderGate.Acquisitions != 1 {
		t.Fatal("public snapshot mutated reader counters")
	}
}
