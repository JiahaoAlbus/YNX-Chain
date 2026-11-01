//go:build unix

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// Local PUBLIC synthetic custody and four ordinary application checkpoints.
// No Node.Start/network/500-load, no finality or production Wallet claim.
func TestPQLabCalleeElapsedPUBLICColdSingleBefore(t *testing.T) {
	created, pin, height, appHash := pqLabSenderCommandFixture(t, true)
	directory := filepath.Join(created.Plan.RootDir, "workload")
	credential, err := os.ReadFile(filepath.Join(directory, "private-senders", "recovery.raw"))
	if err != nil {
		t.Fatal(err)
	}
	defer clear(credential)
	metrics := &consensus.PQLabMetrics{}
	start := time.Now()
	sender, err := consensus.OpenPQLabSenderMeasured(directory, pin, 0, credential, metrics)
	if err != nil {
		t.Fatal(err)
	}
	defer sender.Close()
	coldOpen := time.Since(start)
	checkpoint, err := consensus.LoadPQLabSenderCheckpointMeasured(created.Plan.RootDir, created.PlanSHA256, "", height, appHash, metrics)
	if err != nil {
		t.Fatal(err)
	}
	request := consensus.PQLabSenderRequest{Version: "YNX-PQ-LAB-SENDER-REQUEST/v1", OperationID: strings.Repeat("a", 64), OwnerIndex: 0, FirstNonce: 2, Members: 1}
	result, err := sender.SignMeasured(request, checkpoint, metrics)
	if err != nil {
		t.Fatal(err)
	}
	if result.Transaction.Members != "1" || result.AuthorityGranted || result.CheckpointHeight != height {
		t.Fatal("single transaction semantics changed")
	}
	snapshot := metrics.Snapshot()
	for _, stage := range []string{"sender.pbkdf2_600000", "sender.importFullPrivatePublicPair", "checkpoint.initialFourNodeRead", "checkpoint.currentFourNodeRead", "sender.dualSignEncodeAndSelfVerify", "sender.fileFsync", "sender.directoryFsync"} {
		if snapshot.Stages[stage].Calls == 0 || snapshot.Stages[stage].ElapsedNS <= 0 {
			t.Fatal("actual stage not measured", stage)
		}
	}
	if snapshot.Stages["checkpoint.nodeReadAndValidate"].Calls != 12 || snapshot.Stages["checkpoint.currentFourNodeRead"].Calls != 2 {
		t.Fatal("dynamic four-node reads omitted")
	}
	raw, _ := json.Marshal(struct {
		Go, Scope  string
		ColdOpenNS int64
		Metrics    consensus.PQLabMetricsSnapshot
	}{runtime.Version(), "PUBLIC local two-owner B1; no node/network/finality", coldOpen.Nanoseconds(), snapshot})
	t.Log(string(raw))
}

func TestPQLabCalleeElapsedPUBLICSameInputCurrentReadBeforeAfter(t *testing.T) {
	created, pin, height, appHash := pqLabSenderCommandFixture(t, true)
	cache := consensus.NewPQLabStaticCache()
	defer cache.Close()
	before := &consensus.PQLabMetrics{}
	after := &consensus.PQLabMetrics{}
	for i := 0; i < 3; i++ {
		if _, err := consensus.LoadPQLabSenderCheckpointMeasured(created.Plan.RootDir, created.PlanSHA256, "", height, appHash, before); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 3; i++ {
		if _, err := consensus.LoadPQLabSenderCheckpointCached(created.Plan.RootDir, created.PlanSHA256, "", height, appHash, after, cache); err != nil {
			t.Fatal(err)
		}
	}
	a, b := before.Snapshot(), after.Snapshot()
	measuredCacheStats := cache.Stats()
	if a.Stages["checkpoint.nodeReadAndValidate"].Calls != 12 || b.Stages["checkpoint.nodeReadAndValidate"].Calls != 12 || b.Stages["lab.validatedMigrationOwnerBuild"].Calls != 1 || b.Stages["lab.staticOwnerHitRevalidateSources"].Calls != 2 {
		t.Fatal("dynamic checks or owner construction count changed")
	}
	directory := filepath.Join(created.Plan.RootDir, "workload")
	credential, err := os.ReadFile(filepath.Join(directory, "private-senders", "recovery.raw"))
	if err != nil {
		t.Fatal(err)
	}
	defer clear(credential)
	sender, err := consensus.OpenPQLabSenderMeasured(directory, pin, 0, credential, after)
	if err != nil {
		t.Fatal(err)
	}
	defer sender.Close()
	checkpoint, err := consensus.LoadPQLabSenderCheckpointCached(created.Plan.RootDir, created.PlanSHA256, "", height, appHash, after, cache)
	if err != nil {
		t.Fatal(err)
	}
	request := consensus.PQLabSenderRequest{Version: "YNX-PQ-LAB-SENDER-REQUEST/v1", OperationID: strings.Repeat("b", 64), OwnerIndex: 0, FirstNonce: 2, Members: 1}
	if _, err = sender.SignMeasured(request, checkpoint, after); err != nil {
		t.Fatal(err)
	}
	if after.Snapshot().Stages["checkpoint.currentFourNodeRead"].Calls != 2 {
		t.Fatal("cached path removed either pre/post-sign four-node check")
	}
	// Actual committed source becomes invalid after an otherwise valid checkpoint.
	checkpoint, err = consensus.LoadPQLabSenderCheckpointCached(created.Plan.RootDir, created.PlanSHA256, "", height, appHash, after, cache)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(created.Plan.Nodes[0].StatePath, []byte(`{"PUBLIC-corrupt-current":true}`), 0600); err != nil {
		t.Fatal(err)
	}
	next := request
	next.OperationID = strings.Repeat("c", 64)
	if _, err = sender.SignMeasured(next, checkpoint, after); err == nil {
		t.Fatal("static cache authorized stale actual current state")
	}
	if _, err = os.Stat(filepath.Join(directory, "sender-public", "0000", next.OperationID)); !os.IsNotExist(err) {
		t.Fatal("failed current check reserved operation/nonce")
	}
	raw, _ := json.Marshal(struct {
		Scope                           string
		SameInputBefore, SameInputAfter consensus.PQLabMetricsSnapshot
		StaticCache                     consensus.PQLabStaticCacheStats
	}{"PUBLIC same original root/pins/H/AppHash; 3x4 actual dynamic reads each; no Node/network/finality", a, b, measuredCacheStats})
	t.Log(string(raw))
}
