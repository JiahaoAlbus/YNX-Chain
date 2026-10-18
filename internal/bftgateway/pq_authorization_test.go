package bftgateway

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func TestGatewayPQAuthorizationUsesOneCommittedApplicationQuery(t *testing.T) {
	f := newPQGatewayFixture(t)
	calls := 0
	var mutation func([]byte) []byte
	wrongHeight := false
	rpcErrorStatus := 0
	redirectURL := ""
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if redirectURL != "" {
			http.Redirect(w, r, redirectURL, http.StatusFound)
			return
		}
		path, err := strconv.Unquote(r.URL.Query().Get("path"))
		if err != nil || r.Method != http.MethodGet || r.URL.Path != "/abci_query" || path != consensus.PQWalletAuthorizationPath+f.owner || len(r.URL.Query()) != 1 {
			t.Errorf("not a single fixed account projection request: %s %v", r.URL, err)
			http.Error(w, "unexpected query", 400)
			return
		}
		result, err := f.a.Query(r.Context(), &abcitypes.RequestQuery{Path: path})
		if err != nil {
			t.Error(err)
			return
		}
		value := result.Value
		if mutation != nil {
			value = mutation(bytes.Clone(value))
		}
		height := result.Height
		if wrongHeight {
			height++
		}
		envelope := map[string]any{"result": map[string]any{"response": map[string]any{"code": result.Code, "log": result.Log, "height": strconv.FormatInt(height, 10), "value": base64.StdEncoding.EncodeToString(value)}}}
		if rpcErrorStatus != 0 {
			envelope["error"] = cometRPCError{Code: -32603, Message: "original query unavailable", Data: "retained first cause"}
			w.WriteHeader(rpcErrorStatus)
		}
		_ = json.NewEncoder(w).Encode(envelope)
	}))
	defer upstream.Close()
	g, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	request := func(path string) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		g.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		return w
	}
	path := "/accounts/" + f.owner + "/authorization"
	w := request(path)
	var view consensus.PQWalletAccountView
	if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" || json.Unmarshal(w.Body.Bytes(), &view) != nil {
		t.Fatalf("authorization route: %d %s", w.Code, w.Body)
	}
	if calls != 1 || view.Source != "comet-rpc" || view.RecordsView != "committed" || view.ExecutionHeight != 3 || view.CommittedHeight != 2 || view.LedgerNonce != 1 || view.AuthorizationStatus != "active" || view.CommittedAuthorizationStatus != "pending_activation" || view.NetworkID != f.migration.OriginalGenesisHash || view.Policy == nil || len(view.Policy.Records) != 1 || view.Policy.Records[0].Owner != f.owner {
		t.Fatalf("incorrect atomic projection: %+v calls=%d", view, calls)
	}
	if !bytes.Contains(w.Body.Bytes(), []byte(`"registeredAt":"2"`)) || !bytes.Contains(w.Body.Bytes(), []byte(`"enableAt":"2"`)) || bytes.Contains(w.Body.Bytes(), []byte("authoritative_producer")) {
		t.Fatal("Wallet received unsafe numeric policy fields or invented native provenance")
	}
	for _, status := range []int{http.StatusOK, http.StatusServiceUnavailable} {
		rpcErrorStatus = status
		bad := request(path)
		if bad.Code != http.StatusBadGateway || !strings.Contains(bad.Body.String(), "original query unavailable") || !strings.Contains(bad.Body.String(), "retained first cause") {
			t.Fatalf("mixed RPC error/result became authority or lost cause (upstream HTTP %d): %d %s", status, bad.Code, bad.Body)
		}
	}
	rpcErrorStatus = 0
	validValue, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	var redirectCalls atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		redirectCalls.Add(1)
		_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"response": map[string]any{"code": 0, "height": "2", "value": base64.StdEncoding.EncodeToString(validValue)}}})
	}))
	defer target.Close()
	redirectURL = target.URL
	if bad := request(path); bad.Code != http.StatusBadGateway || redirectCalls.Load() != 0 {
		t.Fatalf("authorization query followed another source: HTTP %d targetCalls=%d", bad.Code, redirectCalls.Load())
	}
	redirectURL = ""
	if g.client.httpClient.CheckRedirect != nil {
		t.Fatal("PQ query changed the shared HTTP client's redirect policy")
	}
	if good := request(path); good.Code != http.StatusOK {
		t.Fatal("original configured authority was not usable after rejected redirect")
	}
	for name, change := range map[string]func(*consensus.PQWalletAccountView){
		"wrong owner":            func(v *consensus.PQWalletAccountView) { v.Owner = f.recipient },
		"wrong original network": func(v *consensus.PQWalletAccountView) { v.NetworkID = strings.Repeat("0", 64) },
		"future execution":       func(v *consensus.PQWalletAccountView) { v.ExecutionHeight++ },
		"foreign history":        func(v *consensus.PQWalletAccountView) { v.Policy.Records[0].Owner = f.recipient },
		"rolled back nonce":      func(v *consensus.PQWalletAccountView) { v.LedgerNonce = 0 },
		"native source claim":    func(v *consensus.PQWalletAccountView) { v.Source = "authoritative_producer" },
		"pending records claim":  func(v *consensus.PQWalletAccountView) { v.RecordsView = "includes_pending" },
		"hidden signing disable": func(v *consensus.PQWalletAccountView) { v.PQSigningEnabled = false },
		"empty v2":               func(v *consensus.PQWalletAccountView) { v.Policy.Version = "YNX-ACCOUNT-POLICY/v2" },
	} {
		t.Run(name, func(t *testing.T) {
			mutation = func(data []byte) []byte {
				var candidate consensus.PQWalletAccountView
				if err := json.Unmarshal(data, &candidate); err != nil {
					t.Fatal(err)
				}
				change(&candidate)
				out, err := json.Marshal(candidate)
				if err != nil {
					t.Fatal(err)
				}
				return out
			}
			if bad := request(path); bad.Code != http.StatusBadGateway {
				t.Fatalf("mutated upstream projection accepted: %d %s", bad.Code, bad.Body)
			}
		})
	}
	mutation = nil
	wrongHeight = true
	if bad := request(path); bad.Code != http.StatusBadGateway {
		t.Fatal("ABCI height and value height disagreement accepted")
	}
	wrongHeight = false
	mutation = func(data []byte) []byte {
		return bytes.Replace(data, []byte(`"ledgerNonce":"1"`), []byte(`"ledgerNonce":1`), 1)
	}
	if bad := request(path); bad.Code != http.StatusBadGateway {
		t.Fatal("unsafe JSON numeric nonce accepted")
	}
	mutation = nil
	before := calls
	for _, invalid := range []string{path + "?height=1", "/accounts/" + strings.ToUpper(f.owner) + "/authorization"} {
		if bad := request(invalid); bad.Code != http.StatusBadRequest {
			t.Fatalf("noncanonical HTTP request accepted: %d", bad.Code)
		}
	}
	if calls != before {
		t.Fatal("invalid owner/historical request reached upstream")
	}
}

func TestGatewayPQWalletHistoryQueryRetainsImportedProvenance(t *testing.T) {
	f := newPQGatewayFixture(t)
	var importedHash string
	for _, block := range f.migration.Runtime.Blocks {
		for _, tx := range block.Transactions {
			if tx.Type == consensus.PQMigrationType {
				importedHash = tx.Hash
			}
		}
	}
	if importedHash == "" {
		t.Fatal("fixture has no actual source migration")
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path, err := strconv.Unquote(r.URL.Query().Get("path"))
		if err != nil {
			t.Error(err)
			return
		}
		result, err := f.a.Query(r.Context(), &abcitypes.RequestQuery{Path: path})
		if err != nil {
			t.Error(err)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"response": map[string]any{"code": result.Code, "log": result.Log, "height": strconv.FormatInt(result.Height, 10), "value": base64.StdEncoding.EncodeToString(result.Value)}}})
	}))
	defer upstream.Close()
	g, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	var history consensus.PQWalletHistoryView
	height, err := g.queryPQWalletJSON(context.Background(), consensus.PQWalletHistoryPath+importedHash, &history)
	if err != nil || height != history.Authorization.CommittedHeight || history.Source != "source_import" || history.ABCITransactionHash != "" || history.Transaction.Hash != importedHash || history.ExecutionHeight != 2 {
		t.Fatalf("imported original query: %+v %v", history, err)
	}
}
