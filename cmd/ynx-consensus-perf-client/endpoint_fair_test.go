package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	rpchttp "github.com/cometbft/cometbft/rpc/client/http"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

// Four ordinary JSON-RPC test endpoints exercise the original HTTP submission
// function and signed CheckTx. Execution, Commit, fee/nonce readback and restart
// are real local application work. Quorum/Merkle flags are explicit unit gate
// inputs, never CometBFT network finality or a four-node performance result.
func TestEndpointFairSignedRequestsProgressPastOneDelayedEndpoint(t *testing.T) {
	path, manifest, m, migration, initial := senderFixture(t, 16)
	pool, err := loadSenderPool(path, manifest, m, migration, initial, 2)
	if err != nil {
		t.Fatal(err)
	}
	if err := claimSenderPool(path); err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(t.TempDir(), "state.json")
	app, err := consensus.NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	reader, err := newDurableReader(migration, []string{statePath})
	if err != nil {
		t.Fatal(err)
	}
	senders := map[string]int{}
	for i, raw := range initial {
		tx, err := consensus.DecodeSignedTransaction(raw)
		if err != nil || tx.Verify(6423) != nil {
			t.Fatal("original signed input invalid", err)
		}
		senders[tx.From] = i
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	release, saturated, fast := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var releaseOnce, saturatedOnce, fastOnce sync.Once
	releaseSlow := func() { releaseOnce.Do(func() { close(release) }) }
	defer releaseSlow()
	var active [4]atomic.Int64
	var peaks [4]atomic.Int64
	var mu sync.Mutex
	requests := make(map[int]int)
	var clients [4]*rpchttp.HTTP
	var urls [4]string
	for endpoint := 0; endpoint < 4; endpoint++ {
		endpoint := endpoint
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
			var request struct {
				ID     json.RawMessage `json:"id"`
				Method string          `json:"method"`
				Params struct {
					Tx []byte `json:"tx"`
				} `json:"params"`
			}
			if err != nil || json.Unmarshal(body, &request) != nil || request.Method != "broadcast_tx_sync" {
				t.Error("unexpected RPC request")
				http.Error(w, "bad request", 400)
				return
			}
			tx, err := consensus.DecodeSignedTransaction(request.Params.Tx)
			sender, known := senders[tx.From]
			if err != nil || !known || tx.Verify(6423) != nil || tx.Nonce < 1 || tx.Nonce > 2 {
				t.Error("signature/fixture identity invalid", err)
				http.Error(w, "bad identity", 400)
				return
			}
			index := sender + int(tx.Nonce-1)*16
			if index%4 != endpoint {
				t.Error("original endpoint authority changed", index, endpoint)
			}
			mu.Lock()
			requests[index]++
			mu.Unlock()
			n := active[endpoint].Add(1)
			atomicMaximum(&peaks[endpoint], n)
			defer active[endpoint].Add(-1)
			if endpoint == 0 {
				if n == 4 {
					saturatedOnce.Do(func() { close(saturated) })
				}
				select {
				case <-release:
				case <-r.Context().Done():
					return
				}
			}
			if index == 13 {
				fastOnce.Do(func() { close(fast) })
			}
			checked, err := app.CheckTx(r.Context(), &abci.RequestCheckTx{Tx: request.Params.Tx})
			if err != nil {
				t.Error(err)
				http.Error(w, "check failed", 500)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": coretypes.ResultBroadcastTx{Code: checked.Code, Log: checked.Log, Hash: cmttypes.Tx(request.Params.Tx).Hash()}})
		}))
		defer server.Close()
		urls[endpoint] = server.URL
		clients[endpoint], err = rpchttp.New(server.URL, "/websocket")
		if err != nil {
			t.Fatal(err)
		}
	}
	txs := make([]cmttypes.Tx, 32)
	results := readyResults(16)
	for i := range results {
		results[i].Endpoint = urls[i%4]
	}
	type outcome struct {
		stats readySenderStats
		err   error
	}
	done := make(chan outcome, 1)
	var execution sync.Mutex
	height := int64(migration.Height)
	go func() {
		stats, err := runReadySenderPool(ctx, options{rounds: 2, offeredRate: 2048, concurrency: 4, observers: 4, endpointFair: true}, pool, txs, results,
			func(i int) (time.Time, bool) { return submitTransaction(ctx, clients[i%4], txs[i], &results[i]) },
			func(_ int, q <-chan acceptedObservation, terminal func(int)) {
				for job := range q {
					execution.Lock()
					height++
					finalized, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: height, Time: time.Unix(1802736000+height, 0), Txs: [][]byte{txs[job.index]}})
					if err != nil || len(finalized.TxResults) != 1 || finalized.TxResults[0].Code != 0 {
						t.Errorf("actual execution failed: %v", err)
					}
					if _, err := app.Commit(ctx, &abci.RequestCommit{}); err != nil {
						t.Error(err)
					}
					evidence, err := reader.verify(ctx, statePath, txs[job.index], height)
					if err != nil {
						t.Error("actual signed fee/nonce readback failed", err)
					}
					r := results[job.index]
					zero := uint32(0)
					now := time.Now()
					r.Status = "confirmed"
					r.ExecutionCode = &zero
					r.Height = height
					r.ConfirmedObservedAt = &now
					r.QuorumVerified = true
					r.TransactionProofVerified = true // Unit gate inputs only.
					r.DurableStateVerified = err == nil
					r.DurableStateHeight = evidence.Height
					r.DurableSnapshotSHA256 = evidence.SnapshotSHA256
					r.DurableStoreFormat = evidence.StoreFormat
					results[job.index] = r
					execution.Unlock()
					terminal(job.index)
				}
			})
		done <- outcome{stats, err}
	}()
	progressed := false
	select {
	case <-fast:
		progressed = true
	case <-saturated:
	case <-ctx.Done():
		t.Error("controlled completion deadline", ctx.Err())
	}
	releaseSlow()
	result := <-done
	if result.err != nil || result.stats.Completed != 32 || result.stats.Offered != 32 || result.stats.RoundsCompleted != 2 || result.stats.Quarantined != 0 {
		t.Fatal("original business counts changed", result.stats, result.err)
	}
	mu.Lock()
	for i := 0; i < 32; i++ {
		if requests[i] != 1 || results[i].Endpoint != urls[i%4] || !qualifiedBusinessFinal(results[i]) {
			t.Fatal("request replay/authority/business drift", i, requests[i], results[i].Status)
		}
	}
	mu.Unlock()
	counts := summarize(results, 0)
	if counts.Offered != 32 || counts.Submitted != 32 || counts.CheckTxAccepted != 32 || counts.EffectiveBusinessIncluded != 32 || counts.FinalSubmitted != 32 || counts.SubmissionUnknown != 0 {
		t.Fatal("original submission/inclusion/final counters drifted", counts)
	}
	reopened, err := consensus.NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	query, err := reopened.Query(ctx, &abci.RequestQuery{Path: "/state"})
	var state consensus.CommittedState
	if err != nil || json.Unmarshal(query.Value, &state) != nil || len(state.FeeEvents) != 32 {
		t.Fatal("durable restart/fee count changed", err)
	}
	for _, account := range state.Accounts {
		if _, ok := senders[account.Address]; ok && (account.Nonce != 2 || account.Balance != 9996) {
			t.Fatal("durable sender nonce/balance changed", account)
		}
	}
	if !progressed {
		t.Fatal("shared pool head-of-line: four signed requests to one endpoint blocked ready sender13 on another authority")
	}
	for i := range peaks {
		if peaks[i].Load() > 1 {
			t.Fatal(fmt.Sprintf("endpoint%d escaped one in-flight bound: %d", i, peaks[i].Load()))
		}
	}
}
