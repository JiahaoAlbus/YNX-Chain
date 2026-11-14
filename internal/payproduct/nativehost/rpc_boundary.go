//go:build pay_pq && pay_cloud && pay_auth_source

package nativehost

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

var originalRPCReads = map[string]bool{"/rpc/status": true, "/rpc/abci_query": true, "/rpc/tx": true, "/rpc/block": true, "/rpc/block_results": true, "/rpc/commit": true, "/rpc/validators": true, "/rpc/consensus_params": true}

func validateBFTRPCRoutes(p securelink.Policy, edge string) error {
	required := map[string]bool{"POST /rpc/": false, "POST /transactions/pq/actions/broadcast": false}
	for path := range originalRPCReads {
		required["GET "+path] = false
	}
	found := false
	for _, e := range p.Edges {
		if e.ID != edge {
			continue
		}
		found = true
		for _, r := range e.Routes {
			key := r.Method + " " + r.Path
			if _, needed := required[key]; needed {
				if r.Method == http.MethodPost && r.Risk != "write" || r.Method == http.MethodGet && r.Risk != "read" {
					return errors.New("wrong original RPC route risk")
				}
				required[key] = true
			}
			if !strings.HasPrefix(r.Path, "/rpc/") {
				if r.Path == "/" {
					return errors.New("generic RPC route forbidden")
				}
				continue
			}
			if r.Path == "/rpc/" && r.Method == http.MethodPost && r.Risk == "write" {
				continue
			}
			if !originalRPCReads[r.Path] || r.Method != http.MethodGet || r.Risk != "read" {
				return errors.New("unregistered typed BFT RPC route")
			}
		}
	}
	if !found {
		return errors.New("original BFT edge not registered")
	}
	for _, present := range required {
		if !present {
			return errors.New("original BFT RPC path set incomplete")
		}
	}
	return nil
}

// The ORIGINAL gateway postBroadcast sends one canonical JSON-RPC POST to '/'.
// That route is not a general RPC tunnel here: only the exact existing invoice
// broadcast envelope is admitted, before the original Node RPC handler. It
// neither re-encodes the transaction nor verifies/creates Source approval.
func originalInvoiceRPCBoundary(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/rpc/" {
			if r.Method != http.MethodPost || r.URL.RawQuery != "" || r.Header.Get("Content-Type") != "application/json" {
				http.Error(w, "typed invoice RPC required", 403)
				return
			}
			raw, err := io.ReadAll(io.LimitReader(r.Body, 792659))
			if err != nil || len(raw) > 792658 {
				http.Error(w, "bounded invoice RPC required", 413)
				return
			}
			var frame struct {
				JSONRPC string `json:"jsonrpc"`
				ID      int    `json:"id"`
				Method  string `json:"method"`
				Params  struct {
					Tx []byte `json:"tx"`
				} `json:"params"`
			}
			decoder := json.NewDecoder(bytes.NewReader(raw))
			decoder.DisallowUnknownFields()
			err = decoder.Decode(&frame)
			canonical, _ := json.Marshal(frame)
			_, action, txErr := consensus.DecodePQActionTransport(frame.Params.Tx)
			if err != nil || !bytes.Equal(raw, canonical) || frame.JSONRPC != "2.0" || frame.ID != 1 || frame.Method != "broadcast_tx_commit" || txErr != nil || !ynxauth.IsInvoiceAction(action.Kind) {
				http.Error(w, "exact original invoice RPC required", 403)
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(raw))
		} else if !originalRPCReads[r.URL.Path] || r.Method != http.MethodGet {
			http.Error(w, "typed BFT RPC route unavailable", 403)
			return
		}
		next.ServeHTTP(w, r)
	})
}
