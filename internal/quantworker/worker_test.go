package quantworker

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/quantlab"
	"github.com/JiahaoAlbus/YNX-Chain/internal/quantpackage"
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
	artifactHash := hex.EncodeToString(hash[:])
	publicKey, privateKey, _ := ed25519.GenerateKey(rand.Reader)
	manifest := quantpackage.Manifest{Schema: 1, PackageID: "worker-ma", Version: "1.0.0", Runtime: "ynx-built-in-ma-v1", SourceSHA256: quantpackage.HashString(request.Strategy.Source + "\n" + request.Strategy.SourceCommit), ArtifactSHA256: artifactHash, Permissions: quantpackage.Permissions{}, Limits: quantpackage.Limits{CPUMilliseconds: 5_000, MemoryBytes: 128 << 20, WallMilliseconds: 10_000, MaxInputBars: 100_000}, DeterministicClock: true, CheckpointRecovery: true, Scan: quantpackage.ScanEvidence{SecretScanPassed: true, MalwareScanPassed: true, ScannerVersion: "test-scanner-1", EvidenceSHA256: strings.Repeat("a", 64)}, SignerKeyID: "test-signer"}
	manifest = quantpackage.Sign(manifest, privateKey)
	job := Job{Schema: 1, ID: "job-001", PayloadHash: artifactHash, Request: request, Package: manifest}
	worker := Worker{Inbox: inbox, Outbox: outbox, Service: service, PackageVerifier: quantpackage.Verifier{TrustedSigners: map[string]ed25519.PublicKey{"test-signer": publicKey}, DependencyAllowlist: map[string]map[string]string{}}}
	encoded, _ := json.Marshal(job)
	_ = os.WriteFile(filepath.Join(inbox, "job.json"), encoded, 0600)
	result, err := worker.RunOne()
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
	if _, err = worker.RunOne(); err != quantlab.ErrForbidden {
		t.Fatalf("tamper=%v", err)
	}
}
