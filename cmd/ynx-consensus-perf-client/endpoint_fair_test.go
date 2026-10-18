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
	testEndpointFairRPC(t, "slow")
}
func TestEndpointFairUnknownIdentityIsNeverRetried(t *testing.T) { testEndpointFairRPC(t, "unknown") }
func TestEndpointFairCancellationKeepsLateReplyUnknown(t *testing.T) {
	testEndpointFairRPC(t, "cancel_late")
}

func TestEndpointFairOptionGuardPreservesLegacyDefault(t *testing.T) {
	o := options{manifest: "manifest", transactions: "transactions", output: "new-result.json", timeout: 10 * time.Second, poll: 100 * time.Millisecond, rounds: 2, senderMode: "ready-pool", offeredRate: 512, concurrency: 4, observers: 4, endpointFair: true}
	if err := validateOptions(o); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"workers", "observers", "sender_mode", "unpaced"} {
		changed := o
		switch mode {
		case "workers":
			changed.concurrency = 3
		case "observers":
			changed.observers = 3
		case "sender_mode":
			changed.senderMode = "rounds"
		case "unpaced":
			changed.offeredRate = 0
		}
		if validateOptions(changed) == nil {
			t.Fatal("candidate widened original worker/endpoint scope", mode)
		}
	}
	o.endpointFair = false
	o.concurrency = 3
	if err := validateOptions(o); err != nil {
		t.Fatal("default legacy selection changed", err)
	}
}

func testEndpointFairRPC(t *testing.T, mode string) {
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
	normalDone, lateDone := make(chan struct{}), make(chan struct{})
	var normalOnce sync.Once
	var completed atomic.Int64
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
			if endpoint == 0 && mode == "slow" {
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
			if mode == "cancel_late" && index == 0 {
				<-release
			}
			responseHash := cmttypes.Tx(request.Params.Tx).Hash()
			if mode == "unknown" && index == 0 {
				responseHash = make([]byte, 32)
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": coretypes.ResultBroadcastTx{Code: checked.Code, Log: checked.Log, Hash: responseHash}})
			if mode == "cancel_late" && index == 0 {
				close(lateDone)
			}
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
					if completed.Add(1) == 24 && mode == "cancel_late" {
						normalOnce.Do(func() { close(normalDone) })
					}
					terminal(job.index)
				}
			})
		done <- outcome{stats, err}
	}()
	progressed := mode != "slow"
	if mode == "slow" {
		select {
		case <-fast:
			progressed = true
		case <-saturated:
		case <-ctx.Done():
			t.Error("controlled completion deadline", ctx.Err())
		}
		releaseSlow()
	} else if mode == "cancel_late" {
		select {
		case <-normalDone:
		case <-ctx.Done():
			t.Error("healthy endpoint completion deadline", ctx.Err())
		}
		cancel()
	}
	result := <-done
	if mode == "cancel_late" {
		beforeLate := results[0].Status
		releaseSlow()
		select {
		case <-lateDone:
		case <-time.After(time.Second):
			t.Fatal("late server reply did not complete")
		}
		if beforeLate != "submission_unknown" || results[0].Status != "submission_unknown" || results[0].CheckTxObservedAt != nil || qualifiedBusinessFinal(results[0]) {
			t.Fatal("late reply replayed or promoted UNKNOWN")
		}
	}
	final, offered, submitted, unknown, quarantined := 32, 32, 32, 0, 0
	if mode == "unknown" {
		final, offered, submitted, unknown, quarantined = 30, 31, 31, 1, 1
	}
	if mode == "cancel_late" {
		final, offered, submitted, unknown, quarantined = 24, 28, 25, 1, 4
	}
	if (mode == "slow" && result.err != nil) || (mode != "slow" && result.err == nil) || result.stats.Completed != final || result.stats.Offered != offered || result.stats.Quarantined != quarantined {
		t.Fatal("original business/quarantine counts changed", mode, result.stats, result.err)
	}
	suppressed := func(i int) bool { return mode == "unknown" && i%16 == 0 || mode == "cancel_late" && i%4 == 0 }
	mu.Lock()
	for i := 0; i < 32; i++ {
		want := 1
		if mode == "unknown" && i == 16 || mode == "cancel_late" && i%4 == 0 && i != 0 {
			want = 0
		}
		if requests[i] != want || results[i].Endpoint != urls[i%4] || (!suppressed(i) && !qualifiedBusinessFinal(results[i])) {
			t.Fatal("request replay/authority/business drift", mode, i, requests[i], results[i].Status)
		}
	}
	mu.Unlock()
	counts := summarize(results, 0)
	if counts.Offered != offered || counts.Submitted != submitted || counts.EffectiveBusinessIncluded != final || counts.FinalSubmitted != final || counts.SubmissionUnknown != unknown || counts.NotSubmitted != 32-submitted {
		t.Fatal("original submission/inclusion/final counters drifted", mode, counts)
	}
	if result.stats.EndpointDispatch == nil || result.stats.EndpointDispatch.Workers != 4 || result.stats.EndpointDispatch.PerEndpointInFlightLimit != 1 || result.stats.EndpointDispatch.QueueCapacityTotal != 32 {
		t.Fatal("candidate changed original worker/queue bound", result.stats.EndpointDispatch)
	}
	callbacks, returns := uint64(0), uint64(0)
	for i := range result.stats.EndpointDispatch.CallbackAttempts {
		callbacks += result.stats.EndpointDispatch.CallbackAttempts[i]
		returns += result.stats.EndpointDispatch.CallbackReturns[i]
	}
	if callbacks != uint64(offered) || returns != callbacks {
		t.Fatal("callback effect count changed", result.stats.EndpointDispatch)
	}
	reopened, err := consensus.NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	query, err := reopened.Query(context.Background(), &abci.RequestQuery{Path: "/state"})
	var state consensus.CommittedState
	if err != nil || json.Unmarshal(query.Value, &state) != nil || len(state.FeeEvents) != final {
		t.Fatal("durable restart/fee count changed", err)
	}
	for _, account := range state.Accounts {
		sender, ok := senders[account.Address]
		nonce, balance := uint64(2), int64(9996)
		if suppressed(sender) {
			nonce, balance = 0, 10000
		}
		if ok && (account.Nonce != nonce || account.Balance != balance) {
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
