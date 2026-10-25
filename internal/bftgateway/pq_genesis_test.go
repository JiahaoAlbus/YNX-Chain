package bftgateway

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
)

func committedGatewayGenesisFixture(t *testing.T) *gatewayInitialFixture {
	t.Helper()
	f := newGatewayInitialFixture(t)
	var original struct {
		GenesisTime time.Time `json:"genesis_time"`
	}
	if err := json.Unmarshal(f.raw, &original); err != nil || original.GenesisTime.IsZero() {
		t.Fatal("original initial-account Genesis time missing", err)
	}
	// InitChain alone cannot expose a committed observation. Commit the first
	// actual empty block; the reserved owner still has no signing registration.
	result, err := f.f.a.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: int64(f.mock.height), Time: original.GenesisTime.Add(time.Second), NextValidatorsHash: bytes.Clone(f.mock.nextValidatorsHash)})
	if err != nil || len(result.TxResults) != 0 {
		t.Fatal(err)
	}
	if _, err := f.f.a.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	return f
}

func TestGatewayPQConsensusGenesisExactRawOwnerCoordinateAndCold(t *testing.T) {
	f := committedGatewayGenesisFixture(t)
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		f.mock.serve(w, r)
	}))
	defer upstream.Close()
	g, err := New(Config{CometRPCURL: upstream.URL, MigrationHeight: f.f.migration.Height, MigrationBlockHash: f.f.migration.LastBlockHash})
	if err != nil {
		t.Fatal(err)
	}
	read := func() *httptest.ResponseRecorder {
		t.Helper()
		before := calls.Load()
		w := httptest.NewRecorder()
		g.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/node/consensus-genesis", nil))
		if w.Code != http.StatusOK || calls.Load() != before+1 || w.Header().Get("Content-Type") != "application/json" || w.Header().Get("Cache-Control") != "no-store" ||
			!bytes.Equal(w.Body.Bytes(), f.raw) || w.Header().Get("X-YNX-Comet-Genesis-SHA256") != f.pins.CometGenesisSHA256 || w.Header().Get("X-YNX-Observation-Height") != strconv.FormatUint(f.mock.height, 10) {
			t.Fatal("normal GET lost the exact independently pinned raw Genesis or one-query coordinate", w.Code, w.Header())
		}
		return w
	}
	w := read()
	owner := httptest.NewRecorder()
	g.Handler().ServeHTTP(owner, httptest.NewRequest(http.MethodGet, "/accounts/"+f.f.owner+"/authorization", nil))
	var policy consensus.PQWalletAccountView
	if owner.Code != http.StatusOK || json.Unmarshal(owner.Body.Bytes(), &policy) != nil || strconv.FormatInt(policy.CommittedHeight, 10) != w.Header().Get("X-YNX-Observation-Height") ||
		policy.Owner != f.f.owner || policy.LedgerNonce != 0 || policy.PQSigningEnabled || policy.Policy == nil || len(policy.Policy.Records) != 0 {
		t.Fatal("normal owner query did not preserve the same unregistered policy coordinate", owner.Code)
	}
	w.Body.Bytes()[0] ^= 1
	read()
	disk, err := os.ReadFile(f.path)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(f.path)
	if err != nil {
		t.Fatal(err)
	}
	fresh, err := consensus.NewConsensusBootstrap(f.raw, f.pins, f.f.migration)
	if err != nil {
		t.Fatal(err)
	}
	cold, err := consensus.NewPersistentApplicationWithBootstrap(f.f.migration, f.path, fresh)
	if err != nil {
		t.Fatal(err)
	}
	f.mock.mu.Lock()
	f.f.a = cold
	f.mock.mu.Unlock()
	read()
	after, err := os.ReadFile(f.path)
	if err != nil {
		t.Fatal(err)
	}
	afterInfo, err := os.Stat(f.path)
	if err != nil || !bytes.Equal(disk, after) || !os.SameFile(info, afterInfo) || !info.ModTime().Equal(afterInfo.ModTime()) {
		t.Fatal("cold readonly HTTP Genesis query changed its original checkpoint", err)
	}
	f.mock.mu.Lock()
	defer f.mock.mu.Unlock()
	if f.mock.posts != 0 {
		t.Fatal("Genesis or owner observation issued a transaction")
	}
}

func TestGatewayPQConsensusGenesisRejectsTransportAndLabelsDrift(t *testing.T) {
	f := committedGatewayGenesisFixture(t)
	var calls, redirected atomic.Int32
	mode := ""
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { redirected.Add(1); w.WriteHeader(http.StatusOK) }))
	defer target.Close()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		path, err := strconv.Unquote(r.URL.Query().Get("path"))
		if r.Method != http.MethodGet || r.URL.Path != "/abci_query" || len(r.URL.Query()) != 1 || err != nil || path != consensus.PQWalletConsensusGenesisPath {
			t.Error("not the single original configured Genesis ABCI request", r.URL, err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if mode == "redirect" {
			http.Redirect(w, r, target.URL, http.StatusFound)
			return
		}
		response, err := f.f.a.Query(r.Context(), &abci.RequestQuery{Path: path})
		if err != nil {
			t.Error(err)
			return
		}
		value := base64.StdEncoding.EncodeToString(response.Value)
		fields := map[string]any{"code": response.Code, "height": strconv.FormatInt(response.Height, 10), "value": value}
		switch mode {
		case "code":
			fields["code"] = 1
		case "null-code":
			fields["code"] = nil
		case "height":
			fields["height"] = "02"
		case "zero-height":
			fields["height"] = "0"
		case "base64":
			fields["value"] = value + "\n"
		case "malformed-raw":
			fields["value"] = base64.StdEncoding.EncodeToString([]byte(`{"broken":`))
		case "drift":
			fields["value"] = base64.StdEncoding.EncodeToString(append([]byte(" \n"), response.Value...))
		}
		encoded, err := json.Marshal(map[string]any{"result": map[string]any{"response": fields}})
		if err != nil {
			t.Error(err)
			return
		}
		if mode == "duplicate" {
			encoded = bytes.Replace(encoded, []byte(`"height":`), []byte(`"height":"999","height":`), 1)
		}
		_, _ = w.Write(encoded)
	}))
	defer upstream.Close()
	g, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	request := func(method, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		g.Handler().ServeHTTP(w, httptest.NewRequest(method, path, strings.NewReader(body)))
		return w
	}
	for _, failure := range []string{"code", "null-code", "height", "zero-height", "base64", "malformed-raw", "duplicate", "redirect"} {
		mode = failure
		w := request(http.MethodGet, "/node/consensus-genesis", "")
		if w.Code != http.StatusBadGateway || w.Header().Get("X-YNX-Comet-Genesis-SHA256") != "" || w.Header().Get("X-YNX-Observation-Height") != "" {
			t.Fatal("invalid upstream Genesis observation released data/headers", failure, w.Code)
		}
	}
	if redirected.Load() != 0 || g.client.httpClient.CheckRedirect != nil {
		t.Fatal("Genesis observation followed a redirect or changed the shared client")
	}
	mode = "drift"
	w := request(http.MethodGet, "/node/consensus-genesis", "")
	digest := sha256.Sum256(w.Body.Bytes())
	if w.Code != http.StatusOK || w.Header().Get("X-YNX-Comet-Genesis-SHA256") != hex.EncodeToString(digest[:]) || hex.EncodeToString(digest[:]) == f.pins.CometGenesisSHA256 || bytes.Equal(w.Body.Bytes(), f.raw) {
		t.Fatal("upstream raw-byte drift reused an old pin or hid original-byte differences")
	}
	// The caller's independently admitted pin rejects this otherwise valid JSON;
	// the gateway's freshly computed digest is not authority for replacement.
	before := calls.Load()
	for _, invalid := range []struct{ method, path, body string }{{http.MethodGet, "/node/consensus-genesis?height=2", ""}, {http.MethodGet, "/node/consensus-genesis", "data"}, {http.MethodPost, "/node/consensus-genesis", ""}} {
		w := request(invalid.method, invalid.path, invalid.body)
		if w.Code != http.StatusBadRequest && w.Code != http.StatusMethodNotAllowed {
			t.Fatal("invalid Genesis request reached configured source", w.Code)
		}
	}
	if calls.Load() != before {
		t.Fatal("invalid HTTP Genesis request performed an upstream read")
	}
}
