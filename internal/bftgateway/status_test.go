package bftgateway

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/crypto/ed25519"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

// These are precisely the existing healthy predicates in the fixed Wallet's
// original-policy-supplier/operator-query.mjs and pq-transaction/node-transport.mjs.
// Build pins are still independently supplied by that owner after deployment;
// this test neither updates those pins nor supplies transaction permission.
func originalWalletStatusHealthy(raw []byte, pinned buildinfo.Info) bool {
	var status struct {
		ChainID          int64          `json:"chainId"`
		CatchingUp       *bool          `json:"catchingUp"`
		Persistence      *bool          `json:"persistence"`
		PersistenceError *string        `json:"persistenceError"`
		Build            buildinfo.Info `json:"build"`
	}
	return json.Unmarshal(raw, &status) == nil && status.ChainID == 6423 &&
		status.CatchingUp != nil && !*status.CatchingUp && status.Persistence != nil && *status.Persistence &&
		status.PersistenceError != nil && *status.PersistenceError == "" &&
		status.Build.Commit == pinned.Commit && status.Build.Release == pinned.Release
}

type walletStatusFixture struct {
	mu               sync.Mutex
	t                *testing.T
	f                *pqIdentityFixture
	mode             string
	reads            []string
	build            buildinfo.Info
	server           *httptest.Server
	lastCacheControl string
}

func newWalletStatusFixture(t *testing.T) *walletStatusFixture {
	t.Helper()
	f := &walletStatusFixture{t: t, f: newPQIdentityFixture(t), build: buildinfo.Info{Commit: "0123456789ab", Release: "ynx-bft-gateway-0123456789ab", BuildTime: "2026-10-18T00:00:00Z"}}
	rpc := httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(rpc.Close)
	g, err := New(Config{CometRPCURL: rpc.URL, Build: f.build})
	if err != nil {
		t.Fatal(err)
	}
	f.server = httptest.NewServer(g.Handler())
	t.Cleanup(f.server.Close)
	return f
}

// Only the Comet transport is controlled. Both Info and the persistence value
// come from a real initialized, committed, file-backed Application, including
// after cold construction. No node, private key material or public network runs.
func (f *walletStatusFixture) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.reads = append(f.reads, r.URL.Path)
	if r.Method != http.MethodGet {
		f.t.Error("status observation attempted a mutation")
		http.Error(w, "GET required", 405)
		return
	}
	info, err := f.f.app.Info(r.Context(), &abci.RequestInfo{})
	if err != nil {
		f.t.Error(err)
		http.Error(w, "application Info unavailable", 500)
		return
	}
	var result any
	switch r.URL.Path {
	case "/status":
		var status coretypes.ResultStatus
		status.NodeInfo.Network = "ynx_6423-1"
		at := time.Date(2026, 10, 18, 1, 2, 3, 0, time.UTC)
		status.SyncInfo = coretypes.SyncInfo{LatestBlockHeight: info.LastBlockHeight, EarliestBlockHeight: 1, LatestBlockHash: bytes.Repeat([]byte{0x11}, 32), EarliestBlockHash: bytes.Repeat([]byte{0x22}, 32), LatestBlockTime: at.Add(time.Duration(info.LastBlockHeight) * time.Second), EarliestBlockTime: at, CatchingUp: f.mode == "catching-up"}
		// Actual Comet /status uses HEADER H's AppHash (H-1 state). Deliberately
		// differ from the current application's H hash to prevent that confusion.
		status.SyncInfo.LatestAppHash = bytes.Repeat([]byte{0x77}, 32)
		if f.mode == "status-height" {
			status.SyncInfo.LatestBlockHeight++
		}
		result = status
	case "/validators":
		// Use Comet's real RPC DTO and registered public-key type. Its codec
		// cannot serialize arbitrary interface-valued scalar map entries.
		validators := make([]*cmttypes.Validator, 4)
		for i := range validators {
			key := ed25519.GenPrivKeyFromSecret([]byte("wallet-status-public-test-validator-" + strconv.Itoa(i)))
			validators[i] = cmttypes.NewValidator(key.PubKey(), 1)
		}
		result = coretypes.ResultValidators{BlockHeight: info.LastBlockHeight, Validators: validators, Count: len(validators), Total: len(validators)}
	case "/abci_info":
		if f.mode == "info-error" {
			writeJSON(w, 200, map[string]any{"error": map[string]any{"code": -32603, "message": "Info unavailable"}})
			return
		}
		if f.mode == "info-height" {
			info.LastBlockHeight++
		}
		if f.mode == "info-hash" {
			info.LastBlockAppHash = bytes.Repeat([]byte{0x33}, 32)
		}
		if f.mode == "foreign-app" {
			info.Data = "foreign-application"
		}
		result = coretypes.ResultABCIInfo{Response: *info}
	case "/abci_query":
		path, err := strconv.Unquote(r.URL.Query().Get("path"))
		if err != nil || path != consensus.ApplicationPersistencePath || len(r.URL.Query()) != 1 {
			f.t.Error("status did not use the exact readonly persistence query", r.URL.RawQuery)
			http.Error(w, "bad query", 400)
			return
		}
		response, err := f.f.app.Query(r.Context(), &abci.RequestQuery{Path: path})
		if err != nil {
			f.t.Error(err)
			http.Error(w, "application query unavailable", 500)
			return
		}
		if f.mode == "query-error" {
			response.Code, response.Value = 1, nil
		}
		if f.mode == "envelope-height" {
			response.Height++
		}
		var value consensus.ApplicationPersistenceView
		if response.Code == 0 && json.Unmarshal(response.Value, &value) == nil {
			switch f.mode {
			case "state-height":
				value.StateHeight++
			case "state-hash":
				value.StateAppHash = strings.Repeat("55", 32)
			case "header-apphash":
				value.StateAppHash = strings.Repeat("77", 32)
			case "wrong-source":
				value.Source = "foreign"
			case "wrong-version":
				value.Version = "v0"
			case "wrong-storage":
				value.Storage = "assumed-durable"
			case "error-with-success":
				value.PersistenceError = "save_failed"
			}
			if strings.HasPrefix(f.mode, "state-") || strings.HasPrefix(f.mode, "wrong-") || f.mode == "header-apphash" || f.mode == "error-with-success" {
				response.Value, err = json.Marshal(value)
				if err != nil {
					f.t.Error(err)
					http.Error(w, "invalid test value", 500)
					return
				}
			}
		}
		if f.mode == "extra-value" || f.mode == "duplicate-value" {
			extra := `,"extra":true}`
			if f.mode == "duplicate-value" {
				extra = `,"persistence":true}`
			}
			response.Value = append(bytes.Clone(response.Value[:len(response.Value)-1]), []byte(extra)...)
		}
		result = coretypes.ResultABCIQuery{Response: *response}
	default:
		f.t.Error("unexpected status upstream request", r.URL.Path)
		http.NotFound(w, r)
		return
	}
	raw, err := cmtjson.Marshal(result)
	if err != nil {
		f.t.Error(err)
		http.Error(w, "invalid test RPC result", 500)
		return
	}
	if r.URL.Path == "/status" {
		if f.mode == "missing-sync" {
			raw = bytes.Replace(raw, []byte(`,"catching_up":false`), nil, 1)
		}
		if f.mode == "duplicate-sync" {
			raw = bytes.Replace(raw, []byte(`"catching_up":false`), []byte(`"catching_up":true,"catching_up":false`), 1)
		}
		if f.mode == "null-sync" {
			raw = bytes.Replace(raw, []byte(`"catching_up":false`), []byte(`"catching_up":null`), 1)
		}
		if f.mode == "invalid-sync" {
			raw = bytes.Replace(raw, []byte(`"catching_up":false`), []byte(`"catching_up":"false"`), 1)
		}
	}
	if r.URL.Path == "/abci_info" && f.mode == "extra-info" {
		raw = bytes.Replace(raw, []byte(`"response":{`), []byte(`"response":{"foreign":true,`), 1)
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(struct {
		Result json.RawMessage `json:"result"`
	}{raw}); err != nil {
		f.t.Error(err)
	}
}

func (f *walletStatusFixture) read(t *testing.T, path string) (int, []byte) {
	t.Helper()
	response, err := http.Get(f.server.URL + path)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	f.lastCacheControl = response.Header.Get("Cache-Control")
	f.mu.Unlock()
	return response.StatusCode, raw
}

func TestGatewayStatusMatchesWalletHealthAndColdCommittedStorage(t *testing.T) {
	f := newWalletStatusFixture(t)
	before, err := os.ReadFile(f.f.statePath)
	if err != nil {
		t.Fatal(err)
	}
	statBefore, err := os.Stat(f.f.statePath)
	if err != nil {
		t.Fatal(err)
	}
	for _, cold := range []bool{false, true} {
		if cold {
			app, loadErr := consensus.NewPersistentApplicationWithBootstrap(f.f.migration, f.f.statePath, f.f.bootstrap)
			err = loadErr
			if err != nil {
				t.Fatal(err)
			}
			f.mu.Lock()
			f.f.app = app
			f.mu.Unlock()
		}
		code, raw := f.read(t, "/status")
		if code != 200 || !originalWalletStatusHealthy(raw, f.build) {
			// With the complete original gateway.go from fb99060a7 this is a
			// real handler RED: CatchingUp/Persistence/Error/Build are absent.
			t.Fatalf("actual Gateway response fails the existing Wallet contract (cold=%v): %d %s", cold, code, raw)
		}
		// Check this only after the actual Wallet predicate: overlaying the
		// complete old handler must fail for its missing health contract,
		// rather than being masked by its separately missing cache header.
		f.mu.Lock()
		cacheControl := f.lastCacheControl
		f.mu.Unlock()
		if cacheControl != "no-store" {
			t.Fatal("status observation may be cached")
		}
		var result struct {
			Height                 int64                                `json:"height"`
			PersistenceObservation consensus.ApplicationPersistenceView `json:"persistenceObservation"`
		}
		if err := json.Unmarshal(raw, &result); err != nil {
			t.Fatal(err)
		}
		info, err := f.f.app.Info(context.Background(), &abci.RequestInfo{})
		if err != nil || result.Height != info.LastBlockHeight || result.PersistenceObservation.StateHeight != info.LastBlockHeight || result.PersistenceObservation.StateAppHash != hex.EncodeToString(info.LastBlockAppHash) || result.PersistenceObservation.Storage != "atomic-json" {
			t.Fatal("status did not bind actual committed H/appHash/storage", result, err)
		}
		oldPin := buildinfo.Info{Commit: "65efa82e0615", Release: "ynx-network-surgical-65efa82e0615"}
		if originalWalletStatusHealthy(raw, oldPin) {
			t.Fatal("a correct interface silently replaced the Wallet's independent old build pin")
		}
	}
	after, err := os.ReadFile(f.f.statePath)
	statAfter, statErr := os.Stat(f.f.statePath)
	if err != nil || statErr != nil || !bytes.Equal(before, after) || !os.SameFile(statBefore, statAfter) || !statBefore.ModTime().Equal(statAfter.ModTime()) {
		t.Fatal("status or cold observation changed the original committed state")
	}
}

func TestGatewayStatusRejectsUnknownOrInconsistentObservations(t *testing.T) {
	f := newWalletStatusFixture(t)
	for _, mode := range []string{"missing-sync", "duplicate-sync", "null-sync", "invalid-sync", "status-height", "info-height", "info-hash", "foreign-app", "info-error", "extra-info", "query-error", "envelope-height", "state-height", "state-hash", "header-apphash", "wrong-source", "wrong-version", "wrong-storage", "error-with-success", "extra-value", "duplicate-value"} {
		t.Run(mode, func(t *testing.T) {
			f.mu.Lock()
			f.mode = mode
			f.mu.Unlock()
			code, raw := f.read(t, "/status")
			if code != http.StatusBadGateway || originalWalletStatusHealthy(raw, f.build) {
				t.Fatalf("unverified status became healthy: %d %s", code, raw)
			}
		})
	}
}

func TestGatewayStatusPreservesMemoryCatchupAndMissingSourceRefusal(t *testing.T) {
	t.Run("catching-up", func(t *testing.T) {
		f := newWalletStatusFixture(t)
		f.mu.Lock()
		f.mode = "catching-up"
		f.mu.Unlock()
		code, raw := f.read(t, "/status")
		if code != 200 || !bytes.Contains(raw, []byte(`"catchingUp":true`)) || originalWalletStatusHealthy(raw, f.build) {
			t.Fatal("actual catchup was hidden", code, string(raw))
		}
	})
	t.Run("actual-memory-application", func(t *testing.T) {
		f := newWalletStatusFixture(t)
		app, err := consensus.NewApplication(f.f.migration)
		if err != nil {
			t.Fatal(err)
		}
		f.mu.Lock()
		f.f.app = app
		f.mu.Unlock()
		code, raw := f.read(t, "/status")
		if code != 200 || !bytes.Contains(raw, []byte(`"persistence":false`)) || !bytes.Contains(raw, []byte(`"persistenceError":"memory_only"`)) || originalWalletStatusHealthy(raw, f.build) {
			t.Fatal("in-memory Info was mislabeled as persistence", code, string(raw))
		}
	})
	t.Run("retained-source-unavailable", func(t *testing.T) {
		f := newWalletStatusFixture(t)
		retained := f.f.statePath + ".retained"
		if err := os.Rename(f.f.statePath, retained); err != nil {
			t.Fatal(err)
		}
		code, raw := f.read(t, "/status")
		if code != 200 || !bytes.Contains(raw, []byte(`"persistence":false`)) || originalWalletStatusHealthy(raw, f.build) {
			t.Fatal("missing actual storage was labeled durable", code, string(raw))
		}
		if _, err := os.Stat(f.f.statePath); !os.IsNotExist(err) {
			t.Fatal("readonly observation recreated missing storage", err)
		}
		if _, err := os.Stat(retained); err != nil {
			t.Fatal("original retained state disappeared", err)
		}
	})
	t.Run("actual-save-failure-retains-committed-height-and-original", func(t *testing.T) {
		f := newWalletStatusFixture(t)
		before, err := os.ReadFile(f.f.statePath)
		if err != nil {
			t.Fatal(err)
		}
		info, err := f.f.app.Info(context.Background(), &abci.RequestInfo{})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.f.app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: info.LastBlockHeight + 1, Time: time.Date(2026, 10, 18, 1, 3, 0, 0, time.UTC), NextValidatorsHash: f.f.set.Hash()}); err != nil {
			t.Fatal(err)
		}
		// Keep the complete original file, but make its old parent a regular
		// file. The normal Commit now fails its actual filesystem operation;
		// there is no synthetic persistence=true/false response in this case.
		parent := filepath.Dir(f.f.statePath)
		retained := parent + ".retained"
		if err := os.Rename(parent, retained); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(parent, []byte("original parent unavailable"), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := f.f.app.Commit(context.Background(), &abci.RequestCommit{}); err == nil {
			t.Fatal("actual unavailable storage did not fail Commit")
		}
		code, raw := f.read(t, "/status")
		if code != 200 || originalWalletStatusHealthy(raw, f.build) || !bytes.Contains(raw, []byte(`"persistenceError":"save_failed"`)) {
			t.Fatal("actual failed save became healthy", code, string(raw))
		}
		var observed struct {
			Height int64 `json:"height"`
		}
		if err := json.Unmarshal(raw, &observed); err != nil || observed.Height != info.LastBlockHeight {
			t.Fatal("failed pending Commit was published as committed", string(raw), err)
		}
		after, err := os.ReadFile(filepath.Join(retained, filepath.Base(f.f.statePath)))
		if err != nil || !bytes.Equal(before, after) {
			t.Fatal("failed save/status lost the complete retained original", err)
		}
	})
	t.Run("health-retains-original-rpc-observations", func(t *testing.T) {
		f := newWalletStatusFixture(t)
		code, raw := f.read(t, "/health")
		var health Health
		if code != 200 || json.Unmarshal(raw, &health) != nil || !health.OK || health.Build != f.build {
			t.Fatal("existing health behavior changed", code, string(raw))
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		if strings.Join(f.reads, ",") != "/status,/validators" {
			t.Fatal("health acquired new persistence/finality dependencies", f.reads)
		}
	})
}
