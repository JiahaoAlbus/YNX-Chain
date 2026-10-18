package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httptrace"
	"sync/atomic"
	"testing"
	"time"

	rpchttp "github.com/cometbft/cometbft/rpc/client/http"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

// This test isolates the real HTTP/JSON-RPC timing path, not signature or BFT
// qualification. The signed application/UNKNOWN gates run in endpoint_fair_test.
func TestSubmissionPhasesObserveOriginalRPCWithoutExtraRequest(t *testing.T) {
	var requests atomic.Int64
	raw := cmttypes.Tx("transport-boundary-only")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		var body struct {
			ID json.RawMessage `json:"id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": body.ID, "result": coretypes.ResultBroadcastTx{Hash: raw.Hash()}})
	}))
	defer server.Close()
	client, err := rpchttp.New(server.URL, "/websocket")
	if err != nil {
		t.Fatal(err)
	}
	for _, measure := range []bool{false, true} {
		var row transactionResult
		_, ok := submitTransactionMeasured(context.Background(), client, raw, &row, measure)
		if !ok || !row.CheckTxIdentityVerified {
			t.Fatal("original RPC result changed", row)
		}
		p := row.SubmissionPhases
		if !measure {
			if p != nil {
				t.Fatal("default unexpectedly enabled trace")
			}
			continue
		}
		if p == nil || p.GetConnCalls != 1 || p.GotConnCalls != 1 || p.WroteRequestCalls != 1 || p.FirstByteCalls != 1 || p.WriteErrors != 0 {
			t.Fatal("HTTP hook counts", p)
		}
		if p.FirstGetConnNs == nil || p.FirstGotConnNs == nil || p.FirstWroteRequestNs == nil || p.FirstResponseByteNs == nil || p.FirstConnReused == nil {
			t.Fatal("missing actual boundaries", p)
		}
		if *p.FirstGetConnNs < 0 || *p.FirstGotConnNs < *p.FirstGetConnNs || p.CallbackReturnNs < *p.FirstResponseByteNs || p.CallbackReturnNs < *p.FirstWroteRequestNs {
			t.Fatal("invalid monotonic offsets", p)
		}
	}
	if requests.Load() != 2 {
		t.Fatal("measurement added/retried requests", requests.Load())
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var cancelled transactionResult
	_, ok := submitTransactionMeasured(ctx, client, raw, &cancelled, true)
	if ok || cancelled.Status != "not_submitted" || cancelled.SubmissionPhases != nil || requests.Load() != 2 {
		t.Fatal("cancelled request gained fabricated transport evidence", cancelled)
	}
}

func TestSubmissionPhasesKeepMissingAndRepeatedHooksExplicit(t *testing.T) {
	ctx, finish := traceSubmission(context.Background(), time.Now())
	trace := httptrace.ContextClientTrace(ctx)
	trace.GetConn("loopback")
	trace.GetConn("loopback")
	trace.WroteRequest(httptrace.WroteRequestInfo{Err: io.ErrUnexpectedEOF})
	p := finish()
	if p.GetConnCalls != 2 || p.WroteRequestCalls != 1 || p.WriteErrors != 1 || p.FirstGotConnNs != nil || p.FirstResponseByteNs != nil || p.FirstConnReused != nil {
		t.Fatal("missing/repeated hooks concealed", p)
	}
	trace.GotFirstResponseByte()
	if p.FirstByteCalls != 0 || p.FirstResponseByteNs != nil {
		t.Fatal("late hook mutated frozen result", p)
	}
}
