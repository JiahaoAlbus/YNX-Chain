package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"testing"

	rpchttp "github.com/cometbft/cometbft/rpc/client/http"
	cmttypes "github.com/cometbft/cometbft/types"
)

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestSubmissionRejectsUnboundAcknowledgementAndRetainsUnknownStart(t *testing.T) {
	for _, mode := range []string{"transport_error", "wrong_hash", "rejected"} {
		t.Run(mode, func(t *testing.T) {
			raw := cmttypes.Tx("offline transport identity fixture")
			calls := 0
			transport := transportFunc(func(request *http.Request) (*http.Response, error) {
				calls++
				if mode == "transport_error" {
					return nil, errors.New("offline transport failure with uncertain write outcome")
				}
				var rpcRequest struct {
					ID json.RawMessage `json:"id"`
				}
				body, err := io.ReadAll(request.Body)
				if err != nil {
					return nil, err
				}
				if err := json.Unmarshal(body, &rpcRequest); err != nil {
					return nil, err
				}
				hash := append([]byte(nil), raw.Hash()...)
				code := 2
				if mode == "wrong_hash" {
					hash[0] ^= 1
					code = 0
				}
				response, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": rpcRequest.ID, "result": map[string]any{"code": code, "hash": fmt.Sprintf("%X", hash), "log": "offline rejected/unbound acknowledgement"}})
				if err != nil {
					return nil, err
				}
				return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(response)), Request: request}, nil
			})
			client, err := rpchttp.NewWithClient("http://127.0.0.1:1", "/websocket", &http.Client{Transport: transport})
			if err != nil {
				t.Fatal(err)
			}
			var result transactionResult
			started, accepted := submitTransaction(context.Background(), client, raw, &result)
			if calls != 1 || accepted || started.IsZero() || result.SubmittedAt == nil {
				t.Fatalf("submission lost timing or retried: calls=%d accepted=%v result=%+v", calls, accepted, result)
			}
			if mode == "rejected" {
				if result.Status != "checktx_rejected" || !result.CheckTxIdentityVerified {
					t.Fatalf("rejection identity lost: %+v", result)
				}
			} else if result.Status != "submission_unknown" || result.CheckTxIdentityVerified {
				t.Fatalf("unbound/unknown response became accepted: %+v", result)
			}
			summary := summarize([]transactionResult{result}, 1)
			if summary.CheckTxAccepted != 0 || summary.FinalSubmitted != 0 {
				t.Fatal("failed or unknown response inflated successful throughput")
			}
		})
	}
}
