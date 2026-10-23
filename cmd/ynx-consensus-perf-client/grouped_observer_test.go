package main

import (
	"context"
	"encoding/hex"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"
	cometed25519 "github.com/cometbft/cometbft/crypto/ed25519"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

type groupedTestClient struct {
	txs                                             map[string]*coretypes.ResultTx
	commit                                          *coretypes.ResultCommit
	validators                                      *coretypes.ResultValidators
	info                                            *coretypes.ResultABCIInfo
	txCalls, commitCalls, validatorCalls, infoCalls int
	afterInfo                                       func()
	requireMeasuredTick                             bool
}

// A pure in-memory RPC fixture can finish within one platform clock tick.
// Timing assertions opt into actual clock progress inside that same call;
// production counters/clock reads and the positive-duration assertion stay intact.
func (c *groupedTestClient) timingFixtureBoundary() {
	if !c.requireMeasuredTick {
		return
	}
	start := time.Now()
	for !time.Now().After(start) {
	}
}

func (c *groupedTestClient) Tx(_ context.Context, hash []byte, _ bool) (*coretypes.ResultTx, error) {
	c.timingFixtureBoundary()
	c.txCalls++
	tx := c.txs[string(hash)]
	if tx == nil {
		return nil, errors.New("not found")
	}
	return tx, nil
}
func (c *groupedTestClient) Commit(context.Context, *int64) (*coretypes.ResultCommit, error) {
	c.timingFixtureBoundary()
	c.commitCalls++
	return c.commit, nil
}
func (c *groupedTestClient) Validators(context.Context, *int64, *int, *int) (*coretypes.ResultValidators, error) {
	c.timingFixtureBoundary()
	c.validatorCalls++
	return c.validators, nil
}
func (c *groupedTestClient) ABCIInfo(context.Context) (*coretypes.ResultABCIInfo, error) {
	c.timingFixtureBoundary()
	c.infoCalls++
	if c.afterInfo != nil {
		c.afterInfo()
	}
	return c.info, nil
}

func groupedObservationFixture(t *testing.T) (*groupedObserver, *groupedTestClient, []acceptedObservation) {
	t.Helper()
	r, path, raws, height := durableBatchFixture(t)
	m, trusted, vals, commit, _, _ := confirmationFixture(t, []int64{1, 1, 1, 1}, 4)
	all := cmttypes.Txs(raws)
	commit.Header.Height, commit.Header.DataHash = height, all.Hash()
	commit.Commit.Height = height
	commit.Commit.BlockID.Hash = commit.Header.Hash()
	for i, v := range trusted.Validators {
		var key cometed25519.PrivKey
		for j := 0; j < 4; j++ {
			candidate := cometed25519.GenPrivKeyFromSecret([]byte{byte(j + 1)})
			if string(candidate.PubKey().Address()) == string(v.Address) {
				key = candidate
				break
			}
		}
		vote := &cmtproto.Vote{Type: cmtproto.PrecommitType, Height: height, Round: 0, BlockID: commit.Commit.BlockID.ToProto(), Timestamp: commit.Header.Time, ValidatorAddress: v.Address, ValidatorIndex: int32(i)}
		sig, err := key.Sign(cmttypes.VoteSignBytes(m.ChainID, vote))
		if err != nil {
			t.Fatal(err)
		}
		commit.Commit.Signatures[i].Signature = sig
	}
	vals.BlockHeight = height
	m.Nodes[0].ABCIStatePath = path
	c := &groupedTestClient{txs: map[string]*coretypes.ResultTx{}, commit: commit, validators: vals}
	state, err := r.verify(context.Background(), path, raws[0], height)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := hex.DecodeString(state.AppHash)
	if err != nil {
		t.Fatal(err)
	}
	c.info = &coretypes.ResultABCIInfo{Response: abci.ResponseInfo{LastBlockHeight: state.Height, LastBlockAppHash: hash}}
	// Keep the real store validation cache, reset only accounting so the test
	// can assert one fresh batch capture after the warm-up above.
	r.slots[path].stats = durableReaderStats{}
	g := &groupedObserver{manifest: m, trusted: trusted, reader: r, clients: []observationClient{c, c, c, c}, txs: make([]cmttypes.Tx, 9), results: make([]transactionResult, 9), included: map[int]*coretypes.ResultTx{}}
	jobs := make([]acceptedObservation, 3)
	for j, raw := range raws {
		i := j * 4
		g.txs[i] = raw
		jobs[j] = acceptedObservation{i, time.Now().Add(-time.Millisecond)}
		ack := time.Now().UTC()
		g.results[i].CheckTxObservedAt = &ack
		c.txs[string(raw.Hash())] = &coretypes.ResultTx{Hash: raw.Hash(), Height: height, Index: uint32(j), Tx: raw, TxResult: abci.ExecTxResult{Code: 0}, Proof: all.Proof(j)}
	}
	return g, c, jobs
}

func TestGroupedObserverOneCaptureAndQuorumForActualSignedBlock(t *testing.T) {
	g, c, jobs := groupedObservationFixture(t)
	if pending := g.step(context.Background(), jobs); len(pending) != 0 {
		t.Fatal("valid group remained pending")
	}
	if c.txCalls != 3 || c.commitCalls != 1 || c.validatorCalls != 1 || c.infoCalls != 1 {
		t.Fatalf("shared RPCs not grouped: %+v", c)
	}
	stats := g.reader.stats()
	if stats.Attempts != 1 || stats.TransactionVerifications != 3 {
		t.Fatal("disk checks duplicated or signatures omitted", stats)
	}
	for _, job := range jobs {
		r := g.results[job.index]
		if r.Status != "confirmed" || !r.TransactionProofVerified || !r.QuorumVerified || !r.DurableInfoVerified || !r.DurableStateVerified || r.ConfirmedObservedAt.Before(*r.CheckTxObservedAt) {
			t.Fatalf("incomplete or backdated result: %+v", r)
		}
	}
	// Same signed block/store, old per-transaction verification work. Compare
	// counters and exact evidence rather than timing a synthetic RPC transport.
	before := g.reader.stats()
	for _, job := range jobs {
		raw := g.txs[job.index]
		if err := verifyConfirmation(g.manifest, g.trusted, c.validators, c.commit, c.txs[string(raw.Hash())], raw); err != nil {
			t.Fatal(err)
		}
		state, err := g.reader.verify(context.Background(), g.manifest.Nodes[0].ABCIStatePath, raw, c.commit.Header.Height)
		if err != nil {
			t.Fatal(err)
		}
		if err := verifyJournalPublishedState(state, c.info); err != nil {
			t.Fatal(err)
		}
		result := g.results[job.index]
		if state.AppHash != result.DurableStateAppHash || state.SnapshotSHA256 != result.DurableSnapshotSHA256 || state.StoreSHA256 != result.DurableStoreSHA256 {
			t.Fatal("grouped and individual evidence differ")
		}
	}
	after := g.reader.stats()
	if after.Attempts-before.Attempts != 3 || after.BytesHashed-before.BytesHashed != 3*before.BytesHashed || after.TransactionVerifications-before.TransactionVerifications != 3 {
		t.Fatal("comparison lost per-transaction signature work or fresh reads", before, after)
	}
	t.Logf("same 3 signed transactions: individual reads=3 bytes=%d signatures=3; grouped reads=1 bytes=%d signatures=3; exact state/store digests equal", after.BytesHashed-before.BytesHashed, before.BytesHashed)
}

func TestGroupedObserverRejectsBadEvidenceAndLatePublication(t *testing.T) {
	for _, mode := range []string{"quorum", "proof", "published_hash", "published_lag", "deadline_after_info", "late_ack"} {
		t.Run(mode, func(t *testing.T) {
			g, c, jobs := groupedObservationFixture(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			switch mode {
			case "quorum":
				c.commit.Commit.Signatures[0].Signature[0] ^= 1
			case "proof":
				c.txs[string(g.txs[4].Hash())].Proof.Proof.Aunts[0][0] ^= 1
			case "published_hash":
				c.info.Response.LastBlockAppHash[0] ^= 1
			case "published_lag":
				c.info.Response.LastBlockHeight--
			case "deadline_after_info":
				c.afterInfo = cancel
			case "late_ack":
				if remaining := g.step(ctx, jobs[:2]); len(remaining) != 0 {
					t.Fatal("first capture failed")
				}
				ack := time.Now().UTC()
				g.results[8].CheckTxObservedAt = &ack
				if remaining := g.step(ctx, jobs[2:]); len(remaining) != 0 {
					t.Fatal("late ACK failed")
				}
				if c.commitCalls != 2 || c.infoCalls != 2 || g.reader.stats().Attempts != 2 || g.results[8].ConfirmedObservedAt.Before(ack) {
					t.Fatal("late ACK reused stale evidence/time")
				}
				return
			}
			pending := g.step(ctx, jobs)
			if mode == "published_lag" {
				if len(pending) != 3 || len(g.included) != 3 {
					t.Fatal("publication wait lost pending identities")
				}
				for _, job := range jobs {
					if g.results[job.index].Status == "confirmed" {
						t.Fatal("unpublished journal confirmed")
					}
				}
				c.info.Response.LastBlockHeight++
				if len(g.step(ctx, pending)) != 0 || c.txCalls != 3 || c.commitCalls != 2 || c.infoCalls != 2 {
					t.Fatal("retry failed or repeated per-tx query")
				}
				return
			}
			if len(pending) != 0 {
				t.Fatal("bad evidence retained for retry")
			}
			for _, job := range jobs {
				want := "observation_failed"
				if mode == "proof" && job.index != 4 {
					want = "confirmed"
				}
				if mode == "deadline_after_info" {
					want = "timeout"
				}
				if g.results[job.index].Status != want {
					t.Fatalf("index %d status %s want %s", job.index, g.results[job.index].Status, want)
				}
			}
			if mode == "quorum" && g.reader.stats().Attempts != 0 {
				t.Fatal("readback bypassed bad quorum")
			}
		})
	}
}

func TestGroupedPacedWorkersDoNotBlockSubmissionOrObserveUnknown(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	results := make([]transactionResult, 16)
	var submits, observed, largest atomic.Int64
	stats := runPacedWorkers(ctx, options{concurrency: 4, observers: 4, offeredRate: 2048, poll: 20 * time.Millisecond}, time.Now(), results,
		func(i int) (time.Time, bool) { submits.Add(1); return time.Now(), i != 5 },
		func(worker int, queue <-chan acceptedObservation, completed func(int)) {
			runGroupedObservationLoop(ctx, 20*time.Millisecond, queue, completed, func(pending []acceptedObservation) []acceptedObservation {
				if submits.Load() < 16 {
					return pending
				}
				atomicMaximum(&largest, int64(len(pending)))
				for _, job := range pending {
					if job.index%4 != worker || job.index == 5 {
						t.Error("wrong worker or unknown accepted")
					}
					observed.Add(1)
				}
				return nil
			})
		})
	if submits.Load() != 16 || observed.Load() != 15 || largest.Load() < 3 || stats.PeakAwaitingObservation < 4 {
		t.Fatalf("lost work or serial confirmation: submit=%d observe=%d batch=%d stats=%+v", submits.Load(), observed.Load(), largest.Load(), stats)
	}
}

func TestGroupedPacedCancellationDrainsAcceptedWithoutRetry(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	queue := make(chan acceptedObservation, 2)
	queue <- acceptedObservation{index: 0}
	queue <- acceptedObservation{index: 4}
	close(queue)
	cancel()
	completed, observed := 0, 0
	runGroupedObservationLoop(ctx, time.Second, queue, func(n int) { completed += n }, func(pending []acceptedObservation) []acceptedObservation {
		if ctx.Err() == nil {
			t.Fatal("missing cancellation")
		}
		observed += len(pending)
		return nil
	})
	if completed != 2 || observed != 2 {
		t.Fatal("accepted work disappeared at deadline", completed, observed)
	}
}
