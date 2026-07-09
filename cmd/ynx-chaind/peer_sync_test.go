package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
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

func TestValidateNodeStartupConfig(t *testing.T) {
	validators, err := chain.ParseValidatorSet("ynx_val_primary|primary|127.0.0.1|primary validator|peer-primary;ynx_val_sg|singapore|127.0.0.2|bonded validator|peer-sg;ynx_val_sv|silicon-valley|127.0.0.3|bonded validator|peer-sv")
	if err != nil {
		t.Fatal(err)
	}
	cfg := chain.DefaultNetworkConfig("testnet")
	validTargets := []peerSyncTarget{
		{Address: "ynx_val_sg", URL: "http://127.0.0.1:6421"},
		{Address: "ynx_val_sv", URL: "http://127.0.0.1:6422"},
	}
	if err := validateNodeStartupConfig(cfg, validators, "ynx_val_primary", validTargets); err != nil {
		t.Fatalf("valid startup config rejected: %v", err)
	}
	cases := []struct {
		name      string
		local     string
		targets   []peerSyncTarget
		wantError string
	}{
		{
			name:      "missing local validator",
			local:     "",
			targets:   validTargets,
			wantError: "YNX_LOCAL_VALIDATOR_ADDRESS is required",
		},
		{
			name:      "local validator outside set",
			local:     "ynx_val_missing",
			targets:   validTargets,
			wantError: "not in YNX_VALIDATOR_SET",
		},
		{
			name:  "incomplete targets",
			local: "ynx_val_primary",
			targets: []peerSyncTarget{
				{Address: "ynx_val_sg", URL: "http://127.0.0.1:6421"},
			},
			wantError: "expected 2 peer RPC targets",
		},
		{
			name:  "self target",
			local: "ynx_val_primary",
			targets: []peerSyncTarget{
				{Address: "ynx_val_primary", URL: "http://127.0.0.1:6420"},
				{Address: "ynx_val_sg", URL: "http://127.0.0.1:6421"},
			},
			wantError: "must not include local validator",
		},
		{
			name:  "target outside set",
			local: "ynx_val_primary",
			targets: []peerSyncTarget{
				{Address: "ynx_val_sg", URL: "http://127.0.0.1:6421"},
				{Address: "ynx_val_missing", URL: "http://127.0.0.1:6429"},
			},
			wantError: "not in YNX_VALIDATOR_SET",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateNodeStartupConfig(cfg, validators, tc.local, tc.targets)
			if err == nil || !strings.Contains(err.Error(), tc.wantError) {
				t.Fatalf("expected %q error, got %v", tc.wantError, err)
			}
		})
	}
	if err := validateNodeStartupConfig(chain.DefaultNetworkConfig("devnet"), validators, "", nil); err != nil {
		t.Fatalf("devnet should allow ad hoc local startup: %v", err)
	}
	if err := validateNodeStartupConfig(cfg, nil, "", nil); err != nil {
		t.Fatalf("single-validator testnet smoke should allow local startup: %v", err)
	}
}

func TestCheckNodeRuntimeConfigDoesNotStartOrWriteState(t *testing.T) {
	setBuildInfoForTest(t, "abc123", "ynx-chain-abc123", "2026-07-10T00:00:00Z")
	t.Setenv("YNX_VALIDATOR_SET", "ynx_val_primary|primary|127.0.0.1|primary validator|peer-primary;ynx_val_sg|singapore|127.0.0.2|bonded validator|peer-sg")
	t.Setenv("YNX_BOOTSTRAP_PEERS", "ynx_val_primary|peer-primary|127.0.0.1|127.0.0.1:26656|primary validator;ynx_val_sg|peer-sg|127.0.0.2|127.0.0.2:26656|bonded validator")
	dataDir := t.TempDir() + "/must-not-be-created"
	var out bytes.Buffer
	err := checkNodeRuntimeConfig(nodeRuntimeConfig{
		Network:          "testnet",
		DataDir:          dataDir,
		LocalValidator:   "ynx_val_primary",
		PeerSyncRaw:      "ynx_val_sg|http://127.0.0.1:6421",
		PeerSyncInterval: time.Second,
		CheckConfig:      true,
	}, &out)
	if err != nil {
		t.Fatalf("check config rejected valid env: %v", err)
	}
	if !strings.Contains(out.String(), "ynx-chaind config check passed") || !strings.Contains(out.String(), "peerTargets=1") {
		t.Fatalf("unexpected check output: %q", out.String())
	}
	if !strings.Contains(out.String(), "buildCommit=abc123") || !strings.Contains(out.String(), "release=ynx-chain-abc123") || !strings.Contains(out.String(), "buildTime=2026-07-10T00:00:00Z") {
		t.Fatalf("check output missing build identity: %q", out.String())
	}
	if _, err := os.Stat(dataDir); !os.IsNotExist(err) {
		t.Fatalf("check config should not create data dir, stat err=%v", err)
	}
}

func TestCurrentBuildInfoDefaults(t *testing.T) {
	setBuildInfoForTest(t, "", "", "")
	info := currentBuildInfo()
	if info.Commit != "unknown" || info.Release != "local" || info.BuildTime != "unknown" {
		t.Fatalf("unexpected default build info: %+v", info)
	}
}

func TestCheckNodeRuntimeConfigRejectsUnsafeRoleEnv(t *testing.T) {
	t.Setenv("YNX_VALIDATOR_SET", "ynx_val_primary|primary|127.0.0.1|primary validator|peer-primary;ynx_val_sg|singapore|127.0.0.2|bonded validator|peer-sg")
	t.Setenv("YNX_BOOTSTRAP_PEERS", "")
	var out bytes.Buffer
	err := checkNodeRuntimeConfig(nodeRuntimeConfig{
		Network:          "testnet",
		LocalValidator:   "ynx_val_primary",
		PeerSyncRaw:      "ynx_val_primary|http://127.0.0.1:6420",
		PeerSyncInterval: time.Second,
		CheckConfig:      true,
	}, &out)
	if err == nil || !strings.Contains(err.Error(), "must not include local validator") {
		t.Fatalf("expected self-target rejection, got %v", err)
	}
	if out.Len() != 0 {
		t.Fatalf("failed config check should not print pass output: %q", out.String())
	}
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

func setBuildInfoForTest(t *testing.T, commit, release, builtAt string) {
	t.Helper()
	oldCommit, oldRelease, oldTime := buildCommit, buildRelease, buildTime
	buildCommit, buildRelease, buildTime = commit, release, builtAt
	t.Cleanup(func() {
		buildCommit, buildRelease, buildTime = oldCommit, oldRelease, oldTime
	})
}
