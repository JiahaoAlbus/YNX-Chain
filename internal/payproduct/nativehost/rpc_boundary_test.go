//go:build pay_pq && pay_cloud && pay_auth_source

package nativehost

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func TestBFTRPCPolicyRequiresCompleteTypedBoundary(t *testing.T) {
	routes := []securelink.Route{{Method: "POST", Path: "/rpc/", Risk: "write"}, {Method: "POST", Path: "/transactions/pq/actions/broadcast", Risk: "write"}}
	for path := range originalRPCReads {
		routes = append(routes, securelink.Route{Method: "GET", Path: path, Risk: "read"})
	}
	for _, tc := range []struct {
		name   string
		change func(*securelink.Policy)
		ok     bool
	}{
		{"complete", func(*securelink.Policy) {}, true},
		{"missing read", func(p *securelink.Policy) { p.Edges[0].Routes = p.Edges[0].Routes[:len(routes)-1] }, false},
		{"wrong write risk", func(p *securelink.Policy) { p.Edges[0].Routes[0].Risk = "read" }, false},
		{"generic root", func(p *securelink.Policy) {
			p.Edges[0].Routes = append(p.Edges[0].Routes, securelink.Route{Method: "POST", Path: "/", Risk: "write"})
		}, false},
		{"unsafe RPC", func(p *securelink.Policy) {
			p.Edges[0].Routes = append(p.Edges[0].Routes, securelink.Route{Method: "GET", Path: "/rpc/unsafe_flush_mempool", Risk: "read"})
		}, false},
		{"another edge", func(p *securelink.Policy) { p.Edges[0].ID = "other" }, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := securelink.Policy{Edges: []securelink.Edge{{ID: "original", Routes: append([]securelink.Route(nil), routes...)}}}
			tc.change(&p)
			if err := validateBFTRPCRoutes(p, "original"); (err == nil) != tc.ok {
				t.Fatal("typed policy validation", err)
			}
		})
	}
}

func rpcOriginalEnvelope(t *testing.T) []byte {
	t.Helper()
	key, _, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(key.Destroy)
	genesis := bytes.Repeat([]byte{0x75}, 32)
	owner := "0x" + strings.Repeat("11", 20)
	payload, err := ynxauth.EncodeActionPayload(ynxauth.ActionInvoiceTerms, ynxauth.InvoiceTermsPayload{InvoiceID: "invoice-rpc", SessionID: "session-rpc", Recipient: owner, Payer: "0x" + strings.Repeat("22", 20), AssetID: "YNXT", UnitVersion: "1", FeeRule: "native-transfer-fee-one/v1", KeyEpoch: 1, Revision: 1, Amount: 100, MaxFee: 1, ExpiresAt: 100})
	if err != nil {
		t.Fatal(err)
	}
	a := ynxauth.Action{ChainID: genesis, NativeChainID: 6423, Owner: owner, Nonce: 1, Fee: 1, Kind: ynxauth.ActionInvoiceTerms, Payload: payload}
	message, err := a.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	batch, err := ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: genesis, Owner: owner, Purpose: ynxauth.TransactionPurpose}, [][]byte{message}, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		t.Fatal(err)
	}
	defer batch.Discard()
	member, err := ynxbatch.Extract(batch, 0)
	if err != nil {
		t.Fatal(err)
	}
	wire, err := ynxbatch.EncodeMember(member)
	if err != nil {
		t.Fatal(err)
	}
	envelope, err := consensus.EncodePQNativeActionTransaction(wire)
	if err != nil {
		t.Fatal(err)
	}
	return envelope
}

func TestEngineRPCOriginalCanonicalInvoiceOnly(t *testing.T) {
	envelope := rpcOriginalEnvelope(t)
	frame := struct {
		JSONRPC string `json:"jsonrpc"`
		ID      int    `json:"id"`
		Method  string `json:"method"`
		Params  struct {
			Tx []byte `json:"tx"`
		} `json:"params"`
	}{JSONRPC: "2.0", ID: 1, Method: "broadcast_tx_commit"}
	frame.Params.Tx = envelope
	raw, err := json.Marshal(frame)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, path string
		body       []byte
		ok         bool
	}{{"actual original gateway frame", "/rpc/", raw, true}, {"generic other RPC method", "/rpc/", bytes.Replace(raw, []byte("broadcast_tx_commit"), []byte("broadcast_evidence"), 1), false}, {"duplicate method", "/rpc/", append([]byte(`{"method":"broadcast_tx_commit",`), raw[1:]...), false}, {"JSON batch", "/rpc/", append(append([]byte("["), raw...), ']'), false}, {"query alias", "/rpc/?method=broadcast_tx_commit", raw, false}, {"frame identity", "/rpc/", bytes.Replace(raw, []byte(`"id":1`), []byte(`"id":2`), 1), false}, {"oversized", "/rpc/", bytes.Repeat([]byte{' '}, 792659), false}} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			handler := originalInvoiceRPCBoundary(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				body, _ := io.ReadAll(r.Body)
				if !bytes.Equal(body, raw) {
					t.Error("original gateway frame or Tx bytes rewritten")
				}
				w.WriteHeader(204)
			}))
			req := httptest.NewRequest("POST", tc.path, bytes.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)
			if tc.ok {
				if calls != 1 || w.Code != 204 {
					t.Fatal("exact original frame refused", calls, w.Code)
				}
			} else if calls != 0 || w.Code < 400 {
				t.Fatal("non-original/general RPC reached original handler", calls, w.Code)
			}
		})
	}
}

func TestEngineRPCFixedReadQueryRemainsOriginalDATA(t *testing.T) {
	for _, tc := range []struct {
		path string
		ok   bool
	}{{"/rpc/abci_query?path=%22%2Fpq-wallet%2Fauthorization%2Fowner%22&height=7", true}, {"/rpc/status", true}, {"/rpc/unsafe_flush_mempool", false}, {"/rpc/", false}} {
		calls := 0
		req := httptest.NewRequest("GET", tc.path, nil)
		originalQuery := req.URL.RawQuery
		handler := originalInvoiceRPCBoundary(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			calls++
			if r != req || r.URL.RawQuery != originalQuery {
				t.Error("original read request/query rewritten")
			}
			w.WriteHeader(204)
		}))
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if tc.ok && (calls != 1 || w.Code != 204) || !tc.ok && (calls != 0 || w.Code < 400) {
			t.Fatal(tc.path, calls, w.Code)
		}
	}
}
