package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

type observationClient interface {
	Tx(context.Context, []byte, bool) (*coretypes.ResultTx, error)
	Commit(context.Context, *int64) (*coretypes.ResultCommit, error)
	Validators(context.Context, *int64, *int, *int) (*coretypes.ResultValidators, error)
	ABCIInfo(context.Context) (*coretypes.ResultABCIInfo, error)
}

type groupedObservationStats struct {
	TransactionQueries   uint64 `json:"transactionQueries"`
	CommitQueries        uint64 `json:"commitQueries"`
	ValidatorQueries     uint64 `json:"validatorQueries"`
	QuorumVerifications  uint64 `json:"quorumVerifications"`
	DurableBatches       uint64 `json:"durableBatches"`
	LargestDurableBatch  uint64 `json:"largestDurableBatch"`
	PublishedInfoQueries uint64 `json:"publishedInfoQueries"`
}

func (s *groupedObservationStats) add(other groupedObservationStats) {
	s.TransactionQueries += other.TransactionQueries
	s.CommitQueries += other.CommitQueries
	s.ValidatorQueries += other.ValidatorQueries
	s.QuorumVerifications += other.QuorumVerifications
	s.DurableBatches += other.DurableBatches
	s.PublishedInfoQueries += other.PublishedInfoQueries
	if other.LargestDurableBatch > s.LargestDurableBatch {
		s.LargestDurableBatch = other.LargestDurableBatch
	}
}

// A worker owns all fields of its accepted transactions until it returns. A
// poll coalesces the currently accepted backlog; late ACKs enter a later poll
// and obtain fresh evidence. No completion time is borrowed from an earlier poll.
func runGroupedObservationLoop(ctx context.Context, poll time.Duration, queue <-chan acceptedObservation, completed func(int), step func([]acceptedObservation) []acceptedObservation) {
	ticker := time.NewTicker(poll)
	defer ticker.Stop()
	var pending []acceptedObservation
	advance := func() {
		before := len(pending)
		pending = step(pending)
		completed(before - len(pending))
	}
	for queue != nil || len(pending) > 0 {
		select {
		case <-ctx.Done():
			// Submitters still own their in-flight ACKs. Drain until they close;
			// observe every accepted result as a timeout without retrying a write.
			if queue != nil {
				for job := range queue {
					pending = append(pending, job)
				}
			}
			advance()
			return
		case job, ok := <-queue:
			if !ok {
				queue = nil
				advance()
			} else {
				pending = append(pending, job)
			}
		case <-ticker.C:
			advance()
		}
	}
}

type groupedObserver struct {
	manifest consensus.EphemeralNetworkManifest
	trusted  *cmttypes.ValidatorSet
	reader   *durableReader
	clients  []observationClient
	txs      []cmttypes.Tx
	results  []transactionResult
	included map[int]*coretypes.ResultTx
	stats    groupedObservationStats
}

func (g *groupedObserver) fail(job acceptedObservation, stage string, err error) {
	r := &g.results[job.index]
	r.Status = "observation_failed"
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		r.Status = "timeout"
	}
	addError(&r.Errors, stage, err)
	delete(g.included, job.index)
}

func observationDeadline(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if deadline, ok := ctx.Deadline(); ok && !time.Now().Before(deadline) {
		return context.DeadlineExceeded
	}
	return nil
}

// step never resubmits. Only node+height peers share a quorum query and durable
// capture. Transaction proofs, signed payloads and fee/nonce checks stay per tx.
func (g *groupedObserver) step(ctx context.Context, pending []acceptedObservation) []acceptedObservation {
	type groupKey struct {
		node   int
		height int64
	}
	groups := map[groupKey][]acceptedObservation{}
	var waiting []acceptedObservation
	for _, job := range pending {
		if err := observationDeadline(ctx); err != nil {
			g.fail(job, "observation_deadline", err)
			continue
		}
		i := job.index
		raw, r := g.txs[i], &g.results[i]
		included := g.included[i]
		if included == nil {
			g.stats.TransactionQueries++
			queried, err := g.clients[i%4].Tx(ctx, raw.Hash(), true)
			if err != nil {
				addError(&r.Errors, "tx_query", err)
				waiting = append(waiting, job)
				continue
			}
			if queried == nil || queried.Height <= 0 || !bytes.Equal(queried.Hash, raw.Hash()) || !bytes.Equal(queried.Tx, raw) {
				g.fail(job, "tx_identity", errors.New("transaction query identity or height mismatch"))
				continue
			}
			r.ExecutionCode, r.ExecutionLog, r.Height = &queried.TxResult.Code, queried.TxResult.Log, queried.Height
			r.BlockTxIndex, r.BlockTxTotal = queried.Index, queried.Proof.Proof.Total
			if queried.TxResult.Code != 0 {
				r.Status = "execution_failed"
				continue
			}
			observed := time.Now()
			now, elapsed := observed.UTC(), observed.Sub(job.started).Seconds()*1000
			r.IncludedObservedAt, r.InclusionMs = &now, &elapsed
			included = queried
			g.included[i] = included
		}
		key := groupKey{i % 4, included.Height}
		groups[key] = append(groups[key], job)
	}
	// Stable order prevents map iteration from changing which block goes first.
	keys := make([]groupKey, 0, len(groups))
	for key := range groups {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].node != keys[j].node {
			return keys[i].node < keys[j].node
		}
		return keys[i].height < keys[j].height
	})
	for _, key := range keys {
		jobs := groups[key]
		client, height := g.clients[key.node], key.height
		if err := observationDeadline(ctx); err != nil {
			for _, job := range jobs {
				g.fail(job, "observation_deadline", err)
			}
			continue
		}
		g.stats.CommitQueries++
		commit, err := client.Commit(ctx, &height)
		stage := "commit_query"
		var validators *coretypes.ResultValidators
		if err == nil {
			g.stats.ValidatorQueries++
			page, perPage := 1, 100
			validators, err = client.Validators(ctx, &height, &page, &perPage)
			stage = "validators_query"
		}
		if err != nil {
			for _, job := range jobs {
				addError(&g.results[job.index].Errors, stage, err)
			}
			waiting = append(waiting, jobs...)
			continue
		}
		g.stats.QuorumVerifications++
		if err := verifyBlockConfirmation(g.manifest, g.trusted, validators, commit, height); err != nil {
			for _, job := range jobs {
				g.fail(job, "confirmation_verification", err)
			}
			continue
		}
		valid := make([]acceptedObservation, 0, len(jobs))
		raws := make([]cmttypes.Tx, 0, len(jobs))
		for _, job := range jobs {
			i := job.index
			if err := verifyTransactionInclusion(commit, g.included[i], g.txs[i]); err != nil {
				g.fail(job, "confirmation_verification", err)
				continue
			}
			r := &g.results[i]
			r.QuorumVerified, r.TransactionProofVerified = true, true
			r.BlockHash, r.HeaderAppHash = fmt.Sprintf("%X", commit.Commit.BlockID.Hash), fmt.Sprintf("%X", commit.Header.AppHash)
			blockTime := commit.Header.Time.UTC()
			r.BlockTime = &blockTime
			valid, raws = append(valid, job), append(raws, g.txs[i])
		}
		if len(valid) == 0 {
			continue
		}
		g.stats.DurableBatches++
		if uint64(len(raws)) > g.stats.LargestDurableBatch {
			g.stats.LargestDurableBatch = uint64(len(raws))
		}
		batch, err := g.reader.verifyBlockBatch(ctx, g.manifest.Nodes[key.node].ABCIStatePath, raws, height)
		state := batch.Evidence
		var info *coretypes.ResultABCIInfo
		if err == nil && isJournalLayout(state.StoreFormat) {
			g.stats.PublishedInfoQueries++
			info, err = client.ABCIInfo(ctx)
			if err != nil {
				err = fmt.Errorf("%w: journal published-state query: %v", errDurableNotReady, err)
			} else {
				err = verifyJournalPublishedState(state, info)
			}
		}
		if err == nil {
			err = observationDeadline(ctx)
		}
		if err != nil {
			for _, job := range valid {
				if errors.Is(err, errDurableNotReady) {
					addError(&g.results[job.index].Errors, "local_durable_readback", err)
					waiting = append(waiting, job)
				} else {
					g.fail(job, "local_durable_readback", err)
				}
			}
			continue
		}
		// This timestamp follows every member's ACK, proof, disk read and Info.
		// It must never use the block timestamp or an earlier cache capture time.
		observed := time.Now()
		if deadline, ok := ctx.Deadline(); ctx.Err() != nil || (ok && !observed.Before(deadline)) {
			for _, job := range valid {
				g.fail(job, "observation_deadline", context.DeadlineExceeded)
			}
			continue
		}
		for _, job := range valid {
			r := &g.results[job.index]
			now, elapsed := observed.UTC(), observed.Sub(job.started).Seconds()*1000
			r.Status, r.ConfirmedObservedAt, r.ConfirmationMs = "confirmed", &now, &elapsed
			r.DurableStateVerified, r.DurableStateHeight, r.DurableStateAppHash = true, state.Height, state.AppHash
			r.DurableSnapshotSHA256, r.DurableSnapshotCacheHit = state.SnapshotSHA256, state.SnapshotCacheHit
			r.DurableStoreSHA256, r.DurableStoreFormat = state.StoreSHA256, state.StoreFormat
			r.DurableJournalCompleteBytes, r.DurableJournalIncompleteTail = state.JournalCompleteBytes, state.JournalIncompleteTail
			if info != nil {
				r.DurableInfoVerified = true
				r.DurableInfoHeight = info.Response.LastBlockHeight
				r.DurableInfoAppHash = fmt.Sprintf("%X", info.Response.LastBlockAppHash)
			}
			delete(g.included, job.index)
		}
	}
	return waiting
}
