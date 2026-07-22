package quantworker

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/quantlab"
)

func validRequest() quantlab.BacktestRequest {
	bars := make([]quantlab.Bar, 30)
	for i := range bars {
		price := int64(1_000_000 + i*100)
		bars[i] = quantlab.Bar{Time: time.Date(2026, 1, 1, 0, i, 0, 0, time.UTC), Open: price, High: price + 10, Low: price - 10, Close: price, Volume: 10_000_000}
	}
	return quantlab.BacktestRequest{Strategy: quantlab.StrategySpec{ID: "worker-ma", Name: "Worker MA", Family: "transparent", Source: "quant://built-in/ma", SourceCommit: "test", License: "Apache-2.0", Params: map[string]int64{"fast": 3, "slow": 8}}, Bars: bars, Assumptions: quantlab.Assumptions{FeeBPS: 1, SlippageBPS: 1, LatencyBars: 1, ParticipationBPS: 1000, TrainEnd: 15, WalkForwardWindows: 2}}
}

func TestSignedDeterministicJobAndTamperRejection(t *testing.T) {
	root := t.TempDir()
	inbox, outbox := filepath.Join(root, "in"), filepath.Join(root, "out")
	_ = os.MkdirAll(inbox, 0700)
	service, _ := quantlab.New(quantlab.Config{StatePath: filepath.Join(root, "state.json")})
	request := validRequest()
	payload, _ := json.Marshal(request)
	hash := sha256.Sum256(payload)
	job := Job{Schema: 1, ID: "job-001", PayloadHash: hex.EncodeToString(hash[:]), Request: request}
	encoded, _ := json.Marshal(job)
	_ = os.WriteFile(filepath.Join(inbox, "job.json"), encoded, 0600)
	result, err := (Worker{Inbox: inbox, Outbox: outbox, Service: service}).RunOne()
	if err != nil || result.Status != "completed" || result.Experiment.ID == "" {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	if _, err := os.Stat(filepath.Join(outbox, "job-001.result.json")); err != nil {
		t.Fatal(err)
	}

	job.ID = "job-002"
	job.PayloadHash = "0000000000000000000000000000000000000000000000000000000000000000"
	encoded, _ = json.Marshal(job)
	_ = os.WriteFile(filepath.Join(inbox, "tampered.json"), encoded, 0600)
	if _, err = (Worker{Inbox: inbox, Outbox: outbox, Service: service}).RunOne(); err != quantlab.ErrForbidden {
		t.Fatalf("tamper=%v", err)
	}
}
