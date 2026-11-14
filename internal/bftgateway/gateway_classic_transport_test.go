package bftgateway

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

// The original native and Ethereum HTTP handlers must preserve the configured
// Comet authority just as the PQ broadcast handler does. Only RPC transport is
// synthetic here: the original canonical transaction decoder and signatures run.
func TestGatewayClassicBroadcastPreservesConfiguredAuthority(t *testing.T) {
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 9))
	recipientKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 10))
	recipient, err := consensus.NativeAddress(recipientKey.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	native, err := consensus.NewSignedTransfer(key, 6423, recipient, 10, 1)
	if err != nil {
		t.Fatal(err)
	}
	nativePayload, err := consensus.EncodeSignedTransaction(native)
	if err != nil {
		t.Fatal(err)
	}
	ethereumPayload, _, err := consensus.NewEthereumLegacyTransfer(key, 6423, 0, 2, recipient, 10)
	if err != nil {
		t.Fatal(err)
	}
	stake, err := consensus.NewSignedApplicationAction(key, 6423, consensus.ActionStakeDelegate, consensus.StakeDelegatePayload{Validator: recipient, AmountYNXT: 1}, 1)
	if err != nil {
		t.Fatal(err)
	}
	stakePayload, err := consensus.EncodeSignedApplicationAction(stake)
	if err != nil {
		t.Fatal(err)
	}
	for _, route := range []struct {
		name    string
		path    string
		payload []byte
		rpc     bool
	}{
		{"native-rest", "/transactions/broadcast", nativePayload, false},
		{"staking-rest", "/staking/delegations", stakePayload, false},
		{"ethereum-rpc", "/evm", ethereumPayload, true},
	} {
		for _, status := range []int{301, 302, 303, 307, 308} {
			t.Run(fmt.Sprintf("%s/HTTP%d", route.name, status), func(t *testing.T) {
				var firstWrites, foreignWrites, redirectHooks, readTargets atomic.Int32
				rejected := []byte(`{"result":{"check_tx":{"code":7,"log":"fixture rejection at the original authority"}}}`)
				foreign := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					foreignWrites.Add(1)
					if r.Method != http.MethodGet || r.URL.Path != "/broadcast_tx_commit" || r.URL.Query().Get("tx") != "0x"+hex.EncodeToString(route.payload) {
						t.Error("redirect changed the original signed transaction")
					}
					w.Header().Set("Content-Type", "application/json")
					_, _ = w.Write(rejected)
				}))
				defer foreign.Close()
				var redirected atomic.Bool
				original := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					switch r.URL.Path {
					case "/broadcast_tx_commit":
						firstWrites.Add(1)
						if r.Method != http.MethodGet || r.URL.Query().Get("tx") != "0x"+hex.EncodeToString(route.payload) {
							t.Error("normal handler changed the original broadcast request")
						}
						if redirected.Load() {
							http.Redirect(w, r, foreign.URL+r.URL.RequestURI(), status)
							return
						}
						w.Header().Set("Content-Type", "application/json")
						_, _ = w.Write(rejected)
					case "/readonly-redirect":
						http.Redirect(w, r, "/readonly-target", http.StatusFound)
					case "/readonly-target":
						readTargets.Add(1)
						_, _ = w.Write([]byte(`{"ok":true}`))
					default:
						t.Error("broadcast failure triggered an unrelated read")
						http.NotFound(w, r)
					}
				}))
				defer original.Close()
				hc := &http.Client{Timeout: time.Second, CheckRedirect: func(*http.Request, []*http.Request) error {
					redirectHooks.Add(1)
					return nil
				}}
				gateway, err := New(Config{CometRPCURL: original.URL, HTTPClient: hc})
				if err != nil {
					t.Fatal(err)
				}
				request := func() *httptest.ResponseRecorder {
					path, payload := route.path, route.payload
					if route.rpc {
						path = "/evm"
						payload, err = json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "eth_sendRawTransaction", "params": []string{"0x" + hex.EncodeToString(route.payload)}})
						if err != nil {
							t.Fatal(err)
						}
					}
					req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(payload))
					req.Header.Set("Content-Type", "application/json")
					out := httptest.NewRecorder()
					gateway.Handler().ServeHTTP(out, req)
					return out
				}
				assertResponse := func(out *httptest.ResponseRecorder, unknown bool) {
					t.Helper()
					if route.rpc {
						var body struct {
							Result json.RawMessage    `json:"result"`
							Error  struct{ Code int } `json:"error"`
						}
						want := -32003
						if unknown {
							want = -32603
						}
						if json.Unmarshal(out.Body.Bytes(), &body) != nil || body.Error.Code != want || len(body.Result) != 0 {
							t.Errorf("normal RPC outcome: %d %s", out.Code, out.Body.String())
						}
					} else {
						want := http.StatusUnprocessableEntity
						if unknown {
							want = http.StatusBadGateway
						}
						if out.Code != want {
							t.Errorf("normal REST outcome: %d want %d: %s", out.Code, want, out.Body.String())
						}
					}
				}
				// First establish the original authority's ordinary rejection.
				assertResponse(request(), false)
				if firstWrites.Load() != 1 {
					t.Fatal("the original configured authority was not reached exactly once")
				}
				redirected.Store(true)
				assertResponse(request(), true)
				if firstWrites.Load() != 2 || foreignWrites.Load() != 0 || redirectHooks.Load() != 0 {
					t.Errorf("signed write escaped configured authority: original=%d foreign=%d redirects=%d", firstWrites.Load(), foreignWrites.Load(), redirectHooks.Load())
				}
				// The bounded write must not mutate the shared read client.
				var read struct{ OK bool }
				before := redirectHooks.Load()
				if err := gateway.client.get(context.Background(), "/readonly-redirect", nil, &read); err != nil || !read.OK || readTargets.Load() != 1 || redirectHooks.Load() != before+1 {
					t.Fatalf("ordinary read redirect policy changed: %+v %v", read, err)
				}
			})
		}
	}
}
