package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abci "github.com/cometbft/cometbft/abci/types"
)

// This test intentionally uses only the original application/public state
// representation. The identical test and signed input can run against the
// unmodified source as well as the private persistent-proof candidate.
type proofHistoryCurrentBlock struct {
	Txs           [][]byte `json:"txs"`
	CheckAccepted []bool   `json:"checkAccepted"`
	Selected      []int    `json:"selected"`
	Executed      []bool   `json:"executed"`
}

type proofHistoryCurrentInput struct {
	Version   string                        `json:"version"`
	Migration chain.ConsensusMigrationState `json:"migration"`
	Owner     string                        `json:"owner"`
	Blocks    []proofHistoryCurrentBlock    `json:"blocks"`
}

func proofHistoryCurrentWrite(t *testing.T, path string, data []byte) {
	t.Helper()
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	_, writeErr := f.Write(data)
	if err := errors.Join(writeErr, f.Sync(), f.Close()); err != nil {
		t.Fatal(err)
	}
}

func proofHistoryCurrentFixture(t *testing.T) proofHistoryCurrentInput {
	t.Helper()
	inputPath, pin := os.Getenv("YNX_PQ_HISTORY_INPUT"), os.Getenv("YNX_PQ_HISTORY_INPUT_SHA256")
	if inputPath != "" || pin != "" {
		data, err := os.ReadFile(inputPath)
		if err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(data)
		if len(data) > 32<<20 || len(pin) != 64 || hex.EncodeToString(digest[:]) != pin {
			t.Fatal("exact shared public-input pin required")
		}
		var in proofHistoryCurrentInput
		if err := json.Unmarshal(data, &in); err != nil || !bytes.Equal(data, mustJSON(t, in)) || in.Version != "YNX-PQ-HISTORY-CURRENT-INPUT/v1" {
			t.Fatal("invalid complete signed input", err)
		}
		return in
	}
	f := newABCIRevocationFixture(t)
	seedMessages := make([][]byte, 32)
	for i := range seedMessages {
		seedMessages[i] = f.transferMessage(t, false, uint64(i+2), 1)
	}
	whole := func(messages ...[]byte) []byte { return mustPQEnvelope(t, PQWholeType, abciWhole(t, f, messages...)) }
	seed := whole(seedMessages...)
	partial := whole(f.transferMessage(t, false, 34, 999), f.transferMessage(t, false, 34, 1), f.transferMessage(t, false, 37, 1), f.transferMessage(t, false, 35, 1))
	mixed := whole(f.transferMessage(t, false, 37, 1), f.transferMessage(t, false, 38, 1))
	rejected := whole(f.transferMessage(t, false, 99, 1), f.transferMessage(t, false, 100, 1))
	lastWire := abciWhole(t, f, f.transferMessage(t, false, 39, 1), f.transferMessage(t, false, 40, 1))
	broken := make([][]byte, 2)
	for i := range broken {
		decoded, err := ynxbatch.DecodeWhole(lastWire)
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			decoded.Certificate.SigmaA[0] ^= 1
		} else {
			decoded.Certificate.SigmaB[0] ^= 1
		}
		wire, err := ynxbatch.EncodeWhole(decoded)
		if err != nil {
			t.Fatal(err)
		}
		broken[i] = mustPQEnvelope(t, PQWholeType, wire)
	}
	in := proofHistoryCurrentInput{Version: "YNX-PQ-HISTORY-CURRENT-INPUT/v1", Migration: f.m, Owner: f.owner, Blocks: []proofHistoryCurrentBlock{
		{Txs: [][]byte{mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3))}, CheckAccepted: []bool{true}, Selected: []int{0}, Executed: []bool{true}},
		{Txs: [][]byte{seed, seed}, CheckAccepted: []bool{true, true}, Selected: []int{0}, Executed: []bool{true, false}},
		{Txs: [][]byte{partial, partial}, CheckAccepted: []bool{true, true}, Selected: []int{0}, Executed: []bool{true, false}},
		{Txs: [][]byte{mustPQEnvelope(t, PQTransferType, f.transfer(t, false, 36, 1)), mixed, rejected}, CheckAccepted: []bool{true, false, false}, Selected: []int{0, 1}, Executed: []bool{true, true, false}},
		{Txs: [][]byte{broken[0], broken[1], mustPQEnvelope(t, PQWholeType, lastWire)}, CheckAccepted: []bool{false, false, true}, Selected: []int{2}, Executed: []bool{false, false, true}},
		{Txs: [][]byte{mustPQEnvelope(t, PQRevocationType, f.revocation(t, 41, 7, 1))}, CheckAccepted: []bool{true}, Selected: []int{0}, Executed: []bool{true}},
		{Txs: [][]byte{whole(f.transferMessage(t, false, 42, 1), f.transferMessage(t, false, 43, 1)), seed}, CheckAccepted: []bool{false, false}, Selected: []int{}, Executed: []bool{false, false}},
	}}
	if out := os.Getenv("YNX_PQ_HISTORY_INPUT_OUT"); out != "" {
		proofHistoryCurrentWrite(t, out, mustJSON(t, in))
	}
	return in
}

type proofHistoryCurrentObservation struct {
	Height        int64             `json:"height"`
	Checks        []json.RawMessage `json:"checks"`
	Prepared      json.RawMessage   `json:"prepared"`
	Processed     json.RawMessage   `json:"processed"`
	Original      json.RawMessage   `json:"original"`
	Finalized     json.RawMessage   `json:"finalized"`
	Committed     json.RawMessage   `json:"committed"`
	State         json.RawMessage   `json:"state"`
	OriginalProof []json.RawMessage `json:"originalProof"`
	LostAck       bool              `json:"lostAck"`
}

func TestPQProofHistoryCurrentSourceTranscript(t *testing.T) {
	in := proofHistoryCurrentFixture(t)
	if len(in.Blocks) != 7 || in.Migration.Height != 1 {
		t.Fatal("unexpected same-input trajectory")
	}
	constructors := []struct {
		name string
		open func(chain.ConsensusMigrationState, string) (*Application, error)
	}{{"atomic-json", NewPersistentApplication}, {"snapshot-journal", NewJournaledApplication}, {"block-journal", NewBlockJournaledApplication}}
	var reference []byte
	for _, constructor := range constructors {
		t.Run(constructor.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "state")
			a, err := constructor.open(in.Migration, path)
			if err != nil {
				t.Fatal(err)
			}
			ctx := context.Background()
			observations := make([]proofHistoryCurrentObservation, 0, len(in.Blocks))
			for bi, block := range in.Blocks {
				height := int64(bi + 2)
				at := time.Unix(height, 0).UTC()
				before := mustJSON(t, a.committed)
				unchanged := func(stage string) {
					t.Helper()
					if !bytes.Equal(before, mustJSON(t, a.committed)) {
						t.Fatal(stage, "mutated committed accounts, policy, proof, history or effects")
					}
				}
				obs := proofHistoryCurrentObservation{Height: height}
				for i, tx := range block.Txs {
					check, err := a.CheckTx(ctx, &abci.RequestCheckTx{Tx: tx})
					if err != nil || (check.Code == 0) != block.CheckAccepted[i] {
						t.Fatalf("H%d CheckTx[%d]: %+v %v", height, i, check, err)
					}
					obs.Checks = append(obs.Checks, mustJSON(t, check))
					unchanged("CheckTx")
				}
				prepared, err := a.PrepareProposal(ctx, &abci.RequestPrepareProposal{Height: height, Time: at, Txs: block.Txs, MaxTxBytes: math.MaxInt64})
				if err != nil || len(prepared.Txs) != len(block.Selected) {
					t.Fatalf("H%d PrepareProposal: %+v %v", height, prepared, err)
				}
				for i, index := range block.Selected {
					if !bytes.Equal(prepared.Txs[i], block.Txs[index]) {
						t.Fatal("proposal selected different original bytes")
					}
				}
				obs.Prepared = mustJSON(t, prepared)
				unchanged("PrepareProposal")
				processed, err := a.ProcessProposal(ctx, &abci.RequestProcessProposal{Height: height, Time: at, Txs: prepared.Txs})
				if err != nil || processed.Status != abci.ResponseProcessProposal_ACCEPT {
					t.Fatal("valid proposal refused", err)
				}
				obs.Processed = mustJSON(t, processed)
				original, err := a.ProcessProposal(ctx, &abci.RequestProcessProposal{Height: height, Time: at, Txs: block.Txs})
				if err != nil || (original.Status == abci.ResponseProcessProposal_ACCEPT) != (len(block.Selected) == len(block.Txs)) {
					t.Fatal("failed/replayed proposal decision changed", err)
				}
				obs.Original = mustJSON(t, original)
				unchanged("ProcessProposal")
				// Mutate only an outward-owned execution snapshot. Neither the
				// old committed map nor another candidate may acquire these edits.
				owned := a.cloneExecutionState()
				for hash, proof := range owned.pqBatches {
					proof.Whole[0] ^= 1
					proof.Results[0].Outcome = "foreign-mutation"
					owned.pqBatches[hash] = proof
					delete(owned.pqBatches, hash)
				}
				unchanged("owned proof mutation")
				ownedTxs := make([][]byte, len(block.Txs))
				for i, tx := range block.Txs {
					ownedTxs[i] = bytes.Clone(tx)
				}
				final, err := a.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: height, Time: at, Txs: ownedTxs})
				if err != nil || len(final.TxResults) != len(block.Executed) {
					t.Fatal("FinalizeBlock", err)
				}
				for i, result := range final.TxResults {
					if (result.Code == 0) != block.Executed[i] {
						t.Fatalf("H%d execution[%d]: %+v", height, i, result)
					}
				}
				obs.Finalized = mustJSON(t, final)
				unchanged("FinalizeBlock")
				pending := mustJSON(t, *a.pending)
				for _, tx := range ownedTxs {
					tx[len(tx)-1] ^= 1
				}
				if !bytes.Equal(pending, mustJSON(t, *a.pending)) {
					t.Fatal("Finalize retained caller-owned wire bytes")
				}
				if _, err := a.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: height, Time: at, Txs: block.Txs}); err == nil || !bytes.Equal(pending, mustJSON(t, *a.pending)) {
					t.Fatal("pending candidate was replaced or replayed")
				}
				if height == 5 {
					lost := errors.New("injected lost durable acknowledgement")
					fault := func(stage string) error {
						if stage == "append_synced" {
							return lost
						}
						return nil
					}
					switch constructor.name {
					case "atomic-json":
						a.persistenceHooks = &committedPersistenceHooks{syncDirectory: func(string) error { return lost }}
					case "snapshot-journal":
						a.journal.fault = fault
					case "block-journal":
						a.blockJournal.io.fault = fault
					}
					if _, err := a.Commit(ctx, &abci.RequestCommit{}); !errors.Is(err, lost) {
						t.Fatalf("original persistence failure lost: %v", err)
					}
					unchanged("failed Commit")
					if a.pending == nil || !bytes.Equal(pending, mustJSON(t, *a.pending)) {
						t.Fatal("UNKNOWN dropped the original pending state")
					}
					obs.LostAck = true
					// Reconcile original persisted bytes through the normal cold
					// constructor. Never replay or sign a replacement transaction.
				} else {
					committed, err := a.Commit(ctx, &abci.RequestCommit{})
					if err != nil {
						t.Fatal(err)
					}
					obs.Committed = mustJSON(t, committed)
					if !bytes.Equal(pending, mustJSON(t, a.committed)) {
						t.Fatal("Commit published a different candidate")
					}
				}
				cold, err := constructor.open(in.Migration, path)
				if err != nil || !bytes.Equal(pending, mustJSON(t, cold.committed)) {
					t.Fatal("normal cold recovery differs from full finalized state", err)
				}
				a = cold
				obs.State = mustJSON(t, a.committed)
				keys := make([]string, 0, len(a.committed.PQBatches))
				for hash := range a.committed.PQBatches {
					keys = append(keys, hash)
				}
				sort.Strings(keys)
				for _, hash := range keys {
					q, err := a.Query(ctx, &abci.RequestQuery{Path: "/pq-batches/" + hash})
					if err != nil || q.Code != 0 || !bytes.Equal(q.Value, mustJSON(t, a.committed.PQBatches[hash])) {
						t.Fatal("historical full proof changed", err)
					}
					obs.OriginalProof = append(obs.OriginalProof, mustJSON(t, q))
					q.Value[0] ^= 1
					if !bytes.Equal(obs.State, mustJSON(t, a.committed)) {
						t.Fatal("query response aliases committed state")
					}
				}
				observations = append(observations, obs)
			}
			owner := queryConsensusAccount(t, a, in.Owner)
			if owner.Nonce != 41 || len(a.committed.PQBatches) != 4 || len(a.committed.NativeTransfers) != 39 || len(a.committed.PQHistory) != 41 {
				t.Fatalf("full trajectory lost effects: nonce=%d proofs=%d receipts=%d history=%d", owner.Nonce, len(a.committed.PQBatches), len(a.committed.NativeTransfers), len(a.committed.PQHistory))
			}
			actual := mustJSON(t, observations)
			if reference == nil {
				reference = actual
			} else if !bytes.Equal(reference, actual) {
				t.Fatal("full three-layout transcript mismatch")
			}
		})
	}
	if t.Failed() {
		return
	}
	if out := os.Getenv("YNX_PQ_HISTORY_TRANSCRIPT_OUT"); out != "" {
		proofHistoryCurrentWrite(t, out, reference)
	}
	digest := sha256.Sum256(reference)
	t.Logf("PQ_HISTORY_CURRENT_SOURCE_PASS heights=7 layouts=3 transcriptBytes=%d transcriptSHA256=%x sameInput=true partial=true unknownColdReadback=true nodeStarted=false", len(reference), digest)
}
