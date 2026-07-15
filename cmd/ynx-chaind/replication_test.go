package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestFetchReplicationSnapshotVerifiesSignature(t *testing.T) {
	source := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	source.ProduceBlock()
	payload, err := source.ReplicationSnapshotJSON()
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-YNX-Replication-Key") != "replication-key" {
			t.Fatal("missing replication key")
		}
		mac := hmac.New(sha256.New, []byte("replication-key"))
		_, _ = mac.Write(payload)
		w.Header().Set("X-YNX-Replication-SHA256", hex.EncodeToString(mac.Sum(nil)))
		_, _ = w.Write(payload)
	}))
	defer server.Close()

	got, err := fetchReplicationSnapshot(context.Background(), server.Client(), server.URL, "replication-key")
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(payload) {
		t.Fatal("replication payload changed")
	}
}

func TestFetchReplicationSnapshotRejectsBadSignature(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-YNX-Replication-SHA256", strings.Repeat("00", sha256.Size))
		_, _ = w.Write([]byte(`{"version":1}`))
	}))
	defer server.Close()
	_, err := fetchReplicationSnapshot(context.Background(), server.Client(), server.URL, "replication-key")
	if err == nil || !strings.Contains(err.Error(), "signature mismatch") {
		t.Fatalf("expected signature mismatch, got %v", err)
	}
}

func TestReplicationPollingReportsFailureRecoveryAndRestart(t *testing.T) {
	source := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	source.ProduceBlock()
	payload, err := source.ReplicationSnapshotJSON()
	if err != nil {
		t.Fatal(err)
	}
	var available atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !available.Load() {
			http.Error(w, "source unavailable", http.StatusServiceUnavailable)
			return
		}
		mac := hmac.New(sha256.New, []byte("replication-key"))
		_, _ = mac.Write(payload)
		w.Header().Set("X-YNX-Replication-SHA256", hex.EncodeToString(mac.Sum(nil)))
		_, _ = w.Write(payload)
	}))
	defer server.Close()

	dir := t.TempDir()
	follower, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	configureFollower := func(devnet *chain.Devnet) {
		devnet.SetNodeIdentityConfig(chain.NodeIdentityConfig{
			ValidatorAddress:  "ynx_validator_singapore",
			ReplicationMode:   "authoritative_follower",
			ReplicationSource: server.URL,
			PeerSyncInterval:  20 * time.Millisecond,
		})
	}
	configureFollower(follower)
	ctx, cancel := context.WithCancel(context.Background())
	startReplicationPolling(ctx, follower, server.URL, "replication-key", 20*time.Millisecond, server.Client())
	waitForReplicationState(t, follower, func(status chain.ReplicationRuntimeStatus) bool {
		return status.Status == "degraded" && status.CatchingUp && status.ConsecutiveFailures > 0 && status.LastErrorStage == "fetch"
	})

	available.Store(true)
	waitForReplicationState(t, follower, func(status chain.ReplicationRuntimeStatus) bool {
		return status.Status == "synced" && !status.CatchingUp && status.Fresh && status.LocalHeight == source.LatestHeight() && status.SourceHeight == source.LatestHeight() && status.LocalBlockHash == source.LatestBlock().Hash && status.SourceBlockHash == source.LatestBlock().Hash
	})
	cancel()
	waitForReplicationState(t, follower, func(status chain.ReplicationRuntimeStatus) bool { return status.Status == "stopped" })

	restarted, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	configureFollower(restarted)
	starting := restarted.NodeIdentity().Replication
	if starting.Status != "starting" || !starting.CatchingUp || starting.LocalHeight != source.LatestHeight() || starting.LocalBlockHash != source.LatestBlock().Hash {
		t.Fatalf("restart did not expose persisted local state before source verification: %+v", starting)
	}
	restartCtx, restartCancel := context.WithCancel(context.Background())
	defer restartCancel()
	startReplicationPolling(restartCtx, restarted, server.URL, "replication-key", 20*time.Millisecond, server.Client())
	waitForReplicationState(t, restarted, func(status chain.ReplicationRuntimeStatus) bool {
		return status.Status == "synced" && !status.CatchingUp && status.Successes > 0 && status.LocalHeight == status.SourceHeight && status.LocalBlockHash == status.SourceBlockHash
	})
}

func waitForReplicationState(t *testing.T, devnet *chain.Devnet, predicate func(chain.ReplicationRuntimeStatus) bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		status := devnet.NodeIdentity().Replication
		if predicate(status) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("replication state did not converge: %+v", devnet.NodeIdentity().Replication)
}
