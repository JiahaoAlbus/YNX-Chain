package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestParsePeerSyncTargets(t *testing.T) {
	targets, err := parsePeerSyncTargets("ynx_val_sg|http://127.0.0.1:6421;ynx_val_sv|https://validator.example/status-base/")
	if err != nil {
		t.Fatal(err)
	}
	if len(targets) != 2 || targets[0].Address != "ynx_val_sg" || targets[0].URL != "http://127.0.0.1:6421" || targets[1].URL != "https://validator.example/status-base" {
		t.Fatalf("unexpected parsed targets: %+v", targets)
	}

	jsonTargets, err := parsePeerSyncTargets(`[{"address":"ynx_val_sg","url":"http://127.0.0.1:6421"}]`)
	if err != nil {
		t.Fatal(err)
	}
	if len(jsonTargets) != 1 || jsonTargets[0].Address != "ynx_val_sg" {
		t.Fatalf("unexpected JSON targets: %+v", jsonTargets)
	}

	if _, err := parsePeerSyncTargets("ynx_val_sg"); err == nil {
		t.Fatal("expected invalid target error")
	}
	if _, err := parsePeerSyncTargets("ynx_val_sg|not-a-url"); err == nil {
		t.Fatal("expected invalid url error")
	}
}

func TestPeerSyncPollingRecordsDerivedHeightEvidence(t *testing.T) {
	validators, err := chain.ParseValidatorSet("ynx_val_primary|primary|127.0.0.1|primary validator|peer-primary;ynx_val_sg|singapore|127.0.0.2|bonded validator|peer-sg")
	if err != nil {
		t.Fatal(err)
	}
	devnet := chain.NewDevnetWithValidators(chain.DefaultNetworkConfig("testnet"), validators)
	devnet.ProduceBlock()
	devnet.ProduceBlock()

	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/status" {
			t.Fatalf("unexpected peer path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"height": 2})
	}))
	defer peer.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	startPeerSyncPolling(ctx, devnet, "ynx_val_primary", []peerSyncTarget{{Address: "ynx_val_sg", URL: peer.URL}}, 10*time.Millisecond, peer.Client())

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		syncs := devnet.ValidatorPeerSyncs()
		if len(syncs) == 1 {
			sync := syncs[0]
			if sync.Source != "ynx_val_primary" || sync.Target != "ynx_val_sg" || sync.SourceHeight < 2 || sync.TargetHeight != 2 || sync.Evidence != "peer-rpc-poll:"+peer.URL+"/status" {
				t.Fatalf("unexpected sync evidence: %+v", sync)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("expected peer sync evidence, got %+v", devnet.ValidatorPeerSyncs())
}

func TestFetchPeerHeight(t *testing.T) {
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"height": "12"})
	}))
	defer peer.Close()

	height, err := fetchPeerHeight(context.Background(), peer.Client(), peer.URL)
	if err != nil {
		t.Fatal(err)
	}
	if height != 12 {
		t.Fatalf("expected height 12, got %d", height)
	}
}
