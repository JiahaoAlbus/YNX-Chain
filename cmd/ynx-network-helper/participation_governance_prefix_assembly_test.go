package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/governanceview"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/participation"
)

// Exercises the normal helper assembly and original shared-source reader;
// local test data is not a publisher, account, permission or live chain.
func TestParticipationGovernancePrefixedAssembly(t *testing.T) {
	var reads atomic.Int32
	governance := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/fixed-prefix/governance/proposals" || r.URL.RawQuery != "" {
			t.Errorf("wrong governance request: %s %s", r.Method, r.URL.String())
			http.Error(w, "wrong route", http.StatusBadRequest)
			return
		}
		reads.Add(1)
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "source does not accept GET", http.StatusMethodNotAllowed)
	}))
	defer governance.Close()
	chain := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("unexpected chain fallback")
		http.Error(w, "unexpected", http.StatusInternalServerError)
	}))
	defer chain.Close()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	cfg := struct {
		Version string                `json:"version"`
		Network participation.Network `json:"network"`
	}{"YNX-NETWORK-PARTICIPATION-CONFIG/v1", participation.Network{Genesis: strings.Repeat("a", 64), NetworkID32: strings.Repeat("b", 64), NativeChainID: "6423", CometChainID: "PUBLIC-comet"}}
	raw, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	config := filepath.Join(root, "network.json")
	if err := os.WriteFile(config, raw, 0600); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(raw)
	source := governance.URL + "/fixed-prefix/"
	service, err := openParticipationConfig(config, hex.EncodeToString(digest[:]), source, chain.URL, root)
	if err != nil || service == nil {
		t.Fatalf("valid fixed prefix rejected: %v", err)
	}
	defer func() {
		if err := service.Close(); err != nil {
			t.Error(err)
		}
	}()
	status := service.LocalStatus()
	if !status.Configured || status.WalletPublisherConfigured || status.Code != "UNSUPPORTED" {
		t.Fatalf("source became authority: %+v", status)
	}
	reader, err := governanceview.New(source, nil)
	if err != nil {
		t.Fatal(err)
	}
	projection := reader.ListProposals(context.Background())
	if projection.Code != "METHOD_NOT_ALLOWED" || projection.Authority || projection.WalletApproval || projection.NativeEligibility || projection.ChainFinality || reads.Load() != 1 {
		t.Fatalf("405 lost: %+v reads=%d", projection, reads.Load())
	}
}
