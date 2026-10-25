package main

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	cometed25519 "github.com/cometbft/cometbft/crypto/ed25519"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

type scannerTestClient struct {
	*groupedTestClient
	block                   *coretypes.ResultBlock
	results                 *coretypes.ResultBlockResults
	blocks                  map[int64]*coretypes.ResultBlock
	commits                 map[int64]*coretypes.ResultCommit
	blockResults            map[int64]*coretypes.ResultBlockResults
	blockCalls, resultCalls int
	resultErr               error
	afterResults            func()
}

func (c *scannerTestClient) Block(_ context.Context, height *int64) (*coretypes.ResultBlock, error) {
	c.blockCalls++
	if height == nil || c.blocks == nil {
		return c.block, nil
	}
	return c.blocks[*height], nil
}
func (c *scannerTestClient) BlockResults(_ context.Context, height *int64) (*coretypes.ResultBlockResults, error) {
	c.resultCalls++
	if c.afterResults != nil {
		c.afterResults()
	}
	if c.resultErr != nil {
		return nil, c.resultErr
	}
	if c.blockResults != nil {
		return c.blockResults[*height], nil
	}
	return c.results, nil
}

func corruptDurableScannerStore(t *testing.T, g *groupedObserver) {
	t.Helper()
	path := g.manifest.Nodes[0].ABCIStatePath
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	raw[len(raw)-2] ^= 1
	if err = os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
}
func (c *scannerTestClient) Commit(ctx context.Context, height *int64) (*coretypes.ResultCommit, error) {
	if c.commits != nil {
		c.commitCalls++
		return c.commits[*height], nil
	}
	return c.groupedTestClient.Commit(ctx, height)
}
func (c *scannerTestClient) Validators(_ context.Context, height *int64, _ *int, _ *int) (*coretypes.ResultValidators, error) {
	c.validatorCalls++
	v := *c.validators
	v.BlockHeight = *height
	return &v, nil
}

func scannerFixture(t *testing.T) (*groupedObserver, *scannerTestClient, []acceptedObservation) {
	t.Helper()
	g, c, jobs := groupedObservationFixture(t)
	raws := make(cmttypes.Txs, len(jobs))
	results := make([]*abci.ExecTxResult, len(jobs))
	for i, job := range jobs {
		raws[i] = append(cmttypes.Tx(nil), g.txs[job.index]...)
		results[i] = &abci.ExecTxResult{Code: 0, Log: "transfer"}
	}
	b := &cmttypes.Block{Header: *c.commit.Header, Data: cmttypes.Data{Txs: raws}}
	client := &scannerTestClient{groupedTestClient: c, block: &coretypes.ResultBlock{BlockID: c.commit.Commit.BlockID, Block: b}, results: &coretypes.ResultBlockResults{Height: b.Height, TxsResults: results}}
	g.clients = []observationClient{client, client, client, client}
	g.inclusionMode = "block-scan"
	return g, client, jobs
}

func TestBlockScannerAuthenticatesOneBlockForAllAcceptedInputs(t *testing.T) {
	g, c, jobs := scannerFixture(t)
	if pending := g.step(context.Background(), jobs); len(pending) != 0 {
		t.Fatal("valid block not confirmed")
	}
	if c.txCalls != 0 || c.blockCalls != 1 || c.resultCalls != 1 || c.commitCalls != 1 || c.validatorCalls != 1 || c.infoCalls != 1 {
		t.Fatalf("unexpected discovery/RPC work: %+v", c)
	}
	stats := g.reader.stats()
	if stats.Attempts != 1 || stats.TransactionVerifications != 3 || g.stats.ScannedBlocks != 1 || g.stats.CachedConfirmationHits != 1 || g.stats.QuorumVerifications != 1 {
		t.Fatal("weakened or repeated verification", stats, g.stats)
	}
	for _, job := range jobs {
		r := g.results[job.index]
		if r.Status != "confirmed" || !r.TransactionProofVerified || !r.QuorumVerified || !r.DurableStateVerified || !r.DurableInfoVerified {
			t.Fatal("incomplete block result", r.Status)
		}
	}
	s := summarize(g.results, 1)
	if s.EffectiveBusinessIncluded != 3 || s.EffectiveInclusionRate != 3 || s.EffectiveInclusionLatency.Samples != 3 || !s.InclusionBlocks.CompleteObservedBlockCoverage {
		t.Fatal("actual verified execution omitted from effective inclusion", s)
	}
}

func TestBlockScannerRejectsCorruptOrMismatchedBlockEvidence(t *testing.T) {
	for _, mode := range []string{"signature", "payload", "block_id", "results_height", "results_count", "missing_result", "oversize_log", "tx_count", "byte_bound", "height_bound"} {
		t.Run(mode, func(t *testing.T) {
			g, c, jobs := scannerFixture(t)
			switch mode {
			case "signature":
				c.commit.Commit.Signatures[0].Signature[0] ^= 1
			case "payload":
				c.block.Block.Data.Txs[0][0] ^= 1
			case "block_id":
				c.block.BlockID.PartSetHeader.Total++
			case "results_height":
				c.results.Height++
			case "results_count":
				c.results.TxsResults = c.results.TxsResults[:2]
			case "missing_result":
				c.results.TxsResults[0] = nil
			case "oversize_log":
				c.results.TxsResults[0].Log = string(make([]byte, 4097))
			case "tx_count":
				c.block.Block.Data.Txs = make(cmttypes.Txs, maxTransactions+1)
			case "byte_bound":
				c.block.Block.Data.Txs = cmttypes.Txs{make(cmttypes.Tx, (8<<20)+1)}
			case "height_bound":
				c.block.Block.Height = int64(g.reader.migration.Height) + 1 + blockScanWindowHeights
				c.block.BlockID.Hash = c.block.Block.Header.Hash()
			}
			if remaining := g.step(context.Background(), jobs); len(remaining) != 0 {
				t.Fatal("invalid evidence kept as pending", mode)
			}
			for _, job := range jobs {
				if g.results[job.index].Status != "observation_failed" {
					t.Fatal("invalid block became successful", mode)
				}
			}
			if g.reader.stats().Attempts != 0 || c.txCalls != 0 {
				t.Fatal("bad block reached durable read or transaction-query fallback")
			}
			queries := c.blockCalls
			g.step(context.Background(), jobs)
			if c.blockCalls != queries {
				t.Fatal("poisoned scanner queried again")
			}
		})
	}
}

func TestBlockScannerRetriesReadOnlyFailureAndPublicationLag(t *testing.T) {
	g, c, jobs := scannerFixture(t)
	c.resultErr = errors.New("temporary read failure")
	pending := g.step(context.Background(), jobs)
	if len(pending) != 3 || g.stats.ScannedBlocks != 0 || g.scanners[0].next != int64(g.reader.migration.Height)+1 {
		t.Fatal("read failure advanced block cursor")
	}
	c.resultErr = nil
	c.info.Response.LastBlockHeight--
	pending = g.step(context.Background(), pending)
	if len(pending) != 3 || g.stats.ScannedBlocks != 1 || g.stats.TransactionQueries != 0 {
		t.Fatal("publication lag accepted or lost inputs")
	}
	quorums := g.stats.QuorumVerifications
	c.info.Response.LastBlockHeight++
	if len(g.step(context.Background(), pending)) != 0 || g.stats.QuorumVerifications != quorums || c.txCalls != 0 || g.reader.stats().Attempts != 2 {
		t.Fatal("cache weakened freshness or repeated quorum work")
	}
}

func TestBlockScannerCacheOwnsEvidenceButLateAckNeedsFreshDurability(t *testing.T) {
	for _, corruptStore := range []bool{false, true} {
		t.Run(map[bool]string{false: "owned_cache", true: "changed_store"}[corruptStore], func(t *testing.T) {
			g, c, jobs := scannerFixture(t)
			if len(g.step(context.Background(), jobs[:1])) != 0 {
				t.Fatal("initial capture failed")
			}
			ack := time.Now().UTC()
			g.results[4].CheckTxObservedAt = &ack
			g.results[8].CheckTxObservedAt = &ack
			c.commit.Commit.Signatures[0].Signature[0] ^= 1
			c.block.Block.Data.Txs[1][0] ^= 1
			c.results.TxsResults[1].Code = 9
			if corruptStore {
				corruptDurableScannerStore(t, g)
			}
			if len(g.step(context.Background(), jobs[1:])) != 0 {
				t.Fatal("late ACK not processed")
			}
			want := "confirmed"
			if corruptStore {
				want = "observation_failed"
			}
			for _, job := range jobs[1:] {
				r := g.results[job.index]
				if r.Status != want {
					t.Fatal("cache alias or stale store accepted", r.Status, want)
				}
				if !corruptStore && r.ConfirmedObservedAt.Before(ack) {
					t.Fatal("late ACK backdated")
				}
			}
			if g.reader.stats().Attempts != 2 || g.stats.QuorumVerifications != 1 || c.commitCalls != 1 || c.txCalls != 0 {
				t.Fatal("fresh store capture lost or quorum unnecessarily repeated")
			}
		})
	}
}

func scannerSignedBlockAt(t *testing.T, c *scannerTestClient, height int64, raws cmttypes.Txs) (*coretypes.ResultBlock, *coretypes.ResultCommit, *coretypes.ResultBlockResults) {
	t.Helper()
	encoded, err := c.commit.SignedHeader.ToProto().Marshal()
	if err != nil {
		t.Fatal(err)
	}
	var pb cmtproto.SignedHeader
	if err = pb.Unmarshal(encoded); err != nil {
		t.Fatal(err)
	}
	signed, err := cmttypes.SignedHeaderFromProto(&pb)
	if err != nil {
		t.Fatal(err)
	}
	signed.Header.Height = height
	signed.Header.DataHash = raws.Hash()
	signed.Commit.Height = height
	signed.Commit.BlockID.Hash = signed.Header.Hash()
	for i, v := range c.validators.Validators {
		var key cometed25519.PrivKey
		for j := 0; j < 4; j++ {
			candidate := cometed25519.GenPrivKeyFromSecret([]byte{byte(j + 1)})
			if string(candidate.PubKey().Address()) == string(v.Address) {
				key = candidate
				break
			}
		}
		vote := &cmtproto.Vote{Type: cmtproto.PrecommitType, Height: height, Round: 0, BlockID: signed.Commit.BlockID.ToProto(), Timestamp: signed.Header.Time, ValidatorAddress: v.Address, ValidatorIndex: int32(i)}
		sig, err := key.Sign(cmttypes.VoteSignBytes(signed.Header.ChainID, vote))
		if err != nil {
			t.Fatal(err)
		}
		signed.Commit.Signatures[i].Signature = sig
	}
	results := &coretypes.ResultBlockResults{Height: height}
	for range raws {
		results.TxsResults = append(results.TxsResults, &abci.ExecTxResult{Code: 0})
	}
	return &coretypes.ResultBlock{BlockID: signed.Commit.BlockID, Block: &cmttypes.Block{Header: *signed.Header, Data: cmttypes.Data{Txs: raws}}}, &coretypes.ResultCommit{SignedHeader: *signed, CanonicalCommit: true}, results
}

func TestBlockScannerBoundedCatchupAndCacheEviction(t *testing.T) {
	g, c, _ := scannerFixture(t)
	start := c.block.Block.Height
	c.blocks = map[int64]*coretypes.ResultBlock{}
	c.commits = map[int64]*coretypes.ResultCommit{}
	c.blockResults = map[int64]*coretypes.ResultBlockResults{}
	firstRaw := append(cmttypes.Tx(nil), g.txs[0]...)
	for i := 0; i < 17; i++ {
		height := start + int64(i)
		var raws cmttypes.Txs
		if i == 0 {
			raws = cmttypes.Txs{firstRaw}
		}
		b, commit, results := scannerSignedBlockAt(t, c, height, raws)
		c.blocks[height], c.commits[height], c.blockResults[height] = b, commit, results
		if i == 16 {
			c.block = b
		}
	}
	s := &blockInclusionScanner{manifest: g.manifest, trusted: g.trusted, client: c, stats: &g.stats, start: start, next: start}
	if err := s.refresh(context.Background()); err != nil || g.stats.ScannedBlocks != 8 {
		t.Fatal("catchup was unbounded", err, g.stats)
	}
	if _, err := s.find(firstRaw); err != nil {
		t.Fatal("first cached input lost")
	}
	for i := 0; i < 2; i++ {
		if err := s.refresh(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if g.stats.ScannedBlocks != 17 || len(s.blocks) != 16 || s.bytes > blockScanCacheBytes || s.next != start+17 || s.confirmation(start) != nil {
		t.Fatal("cache/cursor bounds violated", g.stats, s.next, len(s.blocks))
	}
	if _, err := s.find(firstRaw); !errors.Is(err, errBlockScanNotReady) {
		t.Fatal("evicted evidence invented inclusion", err)
	}
}

func TestBlockScannerDeadlineCannotPublishCacheOrConfirmation(t *testing.T) {
	g, c, jobs := scannerFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	c.afterResults = cancel
	if len(g.step(ctx, jobs)) != 0 {
		t.Fatal("canceled observations left pending")
	}
	for _, job := range jobs {
		if g.results[job.index].Status != "timeout" || g.results[job.index].ConfirmedObservedAt != nil {
			t.Fatal("canceled block produced confirmation")
		}
	}
	if g.stats.ScannedBlocks != 0 || g.reader.stats().Attempts != 0 || len(g.scanners[0].blocks) != 0 {
		t.Fatal("canceled scan published evidence")
	}
}

func TestBlockScannerSignedInclusionAndRPCCodeCannotInventBusinessExecution(t *testing.T) {
	g, c, jobs := scannerFixture(t)
	base, err := consensus.DecodeSignedTransaction(g.txs[0])
	if err != nil {
		t.Fatal(err)
	}
	tx, err := consensus.NewSignedTransfer(secp256k1.PrivKeyFromBytes([]byte{1}), base.ChainID, base.To, 1, 2)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := consensus.EncodeSignedTransaction(tx)
	if err != nil {
		t.Fatal(err)
	}
	g.txs[0] = raw
	// The fixture validators sign inclusion of this valid nonce-2 payload, and
	// RPC reports code zero. The actual durable app has only executed nonce 1.
	c.block, c.commit, c.results = scannerSignedBlockAt(t, c, c.block.Block.Height, cmttypes.Txs{raw})
	if pending := g.step(context.Background(), jobs[:1]); len(pending) != 0 {
		t.Fatal("missing execution evidence retried")
	}
	r := g.results[0]
	if !r.QuorumVerified || !r.TransactionProofVerified || r.Status != "observation_failed" || r.DurableStateVerified || r.ConfirmedObservedAt != nil {
		t.Fatal("unsigned execution result bypassed durable fee/nonce gate", r.Status)
	}
	s := summarize([]transactionResult{r}, 1)
	if s.FinalSubmitted != 0 || s.EffectiveBusinessIncluded != 0 || len(s.InclusionBlocks.Blocks) != 0 || s.InclusionBlocks.ActiveOfferInteriorTPS != nil {
		t.Fatal("unexecuted signed inclusion inflated business TPS", s)
	}
}
