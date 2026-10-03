package quantlab

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestSnapshotDoesNotExposeMutableServiceState(t *testing.T) {
	s, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json")})
	if err != nil {
		t.Fatal(err)
	}
	experiment, err := s.RunBacktest(request())
	if err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	s.state.Paper.Orders = []PaperOrder{{ID: "retained-paper", Amount: 9007199254740993}}
	s.state.Paper.DailyRisk = &PaperDailyRisk{Loss: 17}
	s.state.Datasets["retained"] = DatasetRecord{ID: "retained", Lineage: []string{"original-lineage"}}
	s.state.AdapterSequences["original"] = 7
	s.state.ExecutionLedger["retained"] = ExecutionLedgerRecord{RequestID: "retained"}
	s.state.TestnetOrders["retained"] = TestnetOrder{ID: "retained", Amount: 9007199254740993, WalletSignature: "private-signature"}
	if err = s.save(); err != nil {
		s.mu.Unlock()
		t.Fatal(err)
	}
	s.mu.Unlock()
	before := hash(s.state)
	snapshot, fingerprint := s.streamSnapshot()
	paper := snapshot["paper"].(PaperState)
	if paper.Orders[0].Amount != 9007199254740993 {
		t.Fatal("exact integer precision lost")
	}
	paper.Orders[0].Amount = 1
	paper.DailyRisk.Loss = 999
	experiments := snapshot["experiments"].(map[string]Experiment)
	copy := experiments[experiment.ID]
	copy.Strategy.Params["fast"] = 999
	copy.EquityCurve[0].Equity = -999
	copy.MetricDefinitions["sharpeMilli"] = "changed"
	copy.Attribution.UnsupportedComponents[0] = "changed"
	delete(experiments, experiment.ID)
	strategies := snapshot["strategies"].(map[string]StrategySpec)
	for key, strategy := range strategies {
		strategy.Params["fast"] = 999
		delete(strategies, key)
	}
	datasets := snapshot["datasets"].(map[string]DatasetRecord)
	datasets["retained"].Lineage[0] = "changed"
	delete(datasets, "retained")
	snapshot["adapterSequences"].(map[string]int64)["original"] = 999
	delete(snapshot["executionLedger"].(map[string]ExecutionLedgerRecord), "retained")
	publicOrders := snapshot["testnetOrders"].(map[string]TestnetOrder)
	if publicOrders["retained"].WalletSignature != "" {
		t.Fatal("snapshot exposed Wallet signature")
	}
	delete(publicOrders, "retained")
	snapshot["audit"].([]AuditEvent)[0].Action = "changed"
	if hash(s.state) != before {
		t.Fatal("snapshot caller mutated the retained service state")
	}
	next, nextFingerprint := s.streamSnapshot()
	if fingerprint != nextFingerprint {
		t.Fatal("read-only snapshot changed durable fingerprint")
	}
	if !reflect.DeepEqual(next["experiments"].(map[string]Experiment)[experiment.ID], experiment) {
		t.Fatal("experiment observation was changed")
	}
}

func TestSnapshotCopyFailureNeverPublishesPartiallyAliasedData(t *testing.T) {
	s, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json")})
	if err != nil {
		t.Fatal(err)
	}
	s.state.Strategies["broken"] = StrategySpec{ID: "broken", CreatedAt: time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)}
	snapshot := s.Snapshot()
	if snapshot["failure"].(map[string]string)["code"] != "snapshot_copy_failed" {
		t.Fatal("copy failure not explicit")
	}
	if snapshot["sourceMetadata"].(SnapshotSourceMetadata).Status != "unavailable" {
		t.Fatal("copy failure claimed availability")
	}
	if len(snapshot["strategies"].(map[string]StrategySpec)) != 0 {
		t.Fatal("partial aliased data was returned")
	}
}

func TestSnapshotEncodingRemainsIndependentOfLockedServiceUpdates(t *testing.T) {
	s, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json")})
	if err != nil {
		t.Fatal(err)
	}
	experiment, err := s.RunBacktest(request())
	if err != nil {
		t.Fatal(err)
	}
	snapshot := s.Snapshot()
	before, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 100; i++ {
			s.mu.Lock()
			value := s.state.Experiments[experiment.ID]
			value.Strategy.Params["fast"] = int64(i)
			value.MetricDefinitions["sharpeMilli"] = strings.Repeat("changed", i+1)
			value.EquityCurve[0].Equity = int64(i)
			s.mu.Unlock()
		}
	}()
	for i := 0; i < 100; i++ {
		encoded, err := json.Marshal(snapshot)
		if err != nil || string(encoded) != string(before) {
			t.Errorf("retained snapshot changed during service update: %v", err)
			break
		}
	}
	<-done
}
