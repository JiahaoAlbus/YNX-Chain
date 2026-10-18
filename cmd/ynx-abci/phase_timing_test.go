package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func phaseReports(t *testing.T, output string) []phaseTimingReport {
	t.Helper()
	var rows []phaseTimingReport
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		if !strings.HasPrefix(line, phaseTimingPrefix) {
			t.Fatal("unexpected output frame")
		}
		var row phaseTimingReport
		if err := json.Unmarshal([]byte(strings.TrimPrefix(line, phaseTimingPrefix)), &row); err != nil {
			t.Fatal(err)
		}
		rows = append(rows, row)
	}
	return rows
}

func TestPhaseTimingRealSignedExecutionPreservesDurableState(t *testing.T) {
	ctx := context.Background()
	key, err := secp256k1.GeneratePrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	sender, err := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	recipientKey, err := secp256k1.GeneratePrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	recipient, err := consensus.NativeAddress(recipientKey.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(sender, 10000); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	tx, err := consensus.NewSignedTransfer(key, 6423, recipient, 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := consensus.EncodeSignedTransaction(tx)
	if err != nil {
		t.Fatal(err)
	}
	var canonical []byte
	for _, enabled := range []bool{false, true} {
		file := filepath.Join(t.TempDir(), "state.json")
		app, err := consensus.NewPersistentApplication(migration, file)
		if err != nil {
			t.Fatal(err)
		}
		if _, ok := app.LastCommitTiming(); ok {
			t.Fatal("default diagnostics enabled")
		}
		var output bytes.Buffer
		var delegate abci.Application = app
		var timed *phaseTimedApplication
		if enabled {
			timed = withPhaseTiming(app, &output)
			delegate = timed
		}
		height := int64(migration.Height) + 1
		when := time.Unix(1802736000+height, 0)
		check, err := delegate.CheckTx(ctx, &abci.RequestCheckTx{Tx: raw})
		if err != nil || check.Code != 0 {
			t.Fatal("signed CheckTx failed", err, check)
		}
		bad, err := delegate.CheckTx(ctx, &abci.RequestCheckTx{Tx: []byte("invalid")})
		if err != nil || bad.Code == 0 {
			t.Fatal("bad transaction accepted", err)
		}
		proposal, err := delegate.PrepareProposal(ctx, &abci.RequestPrepareProposal{Txs: [][]byte{raw}, Height: height, Time: when})
		if err != nil || len(proposal.Txs) != 1 {
			t.Fatal("proposal failed", err)
		}
		accepted, err := delegate.ProcessProposal(ctx, &abci.RequestProcessProposal{Txs: proposal.Txs, Height: height, Time: when})
		if err != nil || accepted.Status != abci.ResponseProcessProposal_ACCEPT {
			t.Fatal("process failed", err)
		}
		response, err := delegate.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Txs: proposal.Txs, Height: height, Time: when})
		if err != nil || len(response.TxResults) != 1 || response.TxResults[0].Code != 0 {
			t.Fatal("execution failed", err)
		}
		if _, err := delegate.Commit(ctx, &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		actual, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if !enabled {
			canonical = actual
			continue
		}
		if !bytes.Equal(canonical, actual) {
			t.Fatal("diagnostics changed exact durable state")
		}
		reopened, err := consensus.NewPersistentApplication(migration, file)
		if err != nil {
			t.Fatal(err)
		}
		before, _ := app.Info(ctx, &abci.RequestInfo{})
		after, _ := reopened.Info(ctx, &abci.RequestInfo{})
		if before.LastBlockHeight != after.LastBlockHeight || !bytes.Equal(before.LastBlockAppHash, after.LastBlockAppHash) {
			t.Fatal("reopen differs")
		}
		if _, err := delegate.Commit(ctx, &abci.RequestCommit{}); err == nil {
			t.Fatal("missing finalized state accepted")
		}
		timed.recorder.emit("shutdown", nil)
		rows := phaseReports(t, output.String())
		if len(rows) != 3 {
			t.Fatal("missing actual attempts", len(rows))
		}
		if rows[0].Commit == nil || !rows[0].Commit.Durable || rows[0].Commit.Height != height || rows[0].Commit.StagesNs["file_sync"] <= 0 || rows[0].Commit.StagesNs["json_encode"] <= 0 {
			t.Fatal("missing actual persistence timings", rows[0])
		}
		if rows[1].Commit != nil || rows[1].Stages["commit"].FailedResponses != 1 {
			t.Fatal("failed commit reused success timing", rows[1])
		}
		for _, name := range []string{"check_tx", "prepare_proposal", "process_proposal", "finalize_block", "commit"} {
			v := rows[2].Stages[name]
			var counted uint64
			for _, n := range v.DurationBuckets {
				counted += n
			}
			if v.Calls == 0 || v.ElapsedNs == 0 || counted != v.Calls {
				t.Fatal("stage completion count differs", name, v)
			}
		}
		if rows[2].Stages["check_tx"].Calls != 2 || rows[2].Stages["check_tx"].FailedResponses != 1 || !rows[2].Valid {
			t.Fatal("rejection count or diagnostic validity differs")
		}
	}
}

type failingPhaseWriter struct{}

func (failingPhaseWriter) Write([]byte) (int, error) {
	return 0, errors.New("test diagnostic sink refused")
}

type shortPhaseWriter struct{}

func (shortPhaseWriter) Write(p []byte) (int, error) { return len(p) - 1, nil }
func TestPhaseTimingSinkFailureAndBoundsNeverPromoteValidEvidence(t *testing.T) {
	for _, writer := range []io.Writer{failingPhaseWriter{}, shortPhaseWriter{}} {
		recorder := newPhaseRecorder(writer)
		recorder.emit("commit", nil)
		var output bytes.Buffer
		recorder.writer = &output
		recorder.emit("shutdown", nil)
		rows := phaseReports(t, output.String())
		if rows[0].Valid {
			t.Fatal("failed or partial diagnostic write promoted")
		}
	}
	recorder := newPhaseRecorder(io.Discard)
	for i := 0; i < phaseTimingMaxReports+1; i++ {
		recorder.emit("commit", nil)
	}
	var output bytes.Buffer
	recorder.writer = &output
	recorder.emit("shutdown", nil)
	recorder.emit("shutdown", nil)
	rows := phaseReports(t, output.String())
	if len(rows) != 1 || rows[0].Sequence != phaseTimingMaxReports+1 || !rows[0].Capped || rows[0].Valid {
		t.Fatal("bounded terminal evidence differs", rows)
	}
}

func TestPhaseTimingShutdownWithActiveHandlerWithholdsValidity(t *testing.T) {
	var output bytes.Buffer
	recorder := newPhaseRecorder(&output)
	recorder.begin()
	recorder.emit("shutdown", nil)
	rows := phaseReports(t, output.String())
	if rows[0].Valid || rows[0].InFlight != 1 {
		t.Fatal("incomplete handler was accepted")
	}
}
