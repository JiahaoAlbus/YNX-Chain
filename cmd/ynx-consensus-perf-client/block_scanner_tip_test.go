package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	cmttypes "github.com/cometbft/cometbft/types"
	"os"
	"path/filepath"
	"testing"
)

func TestBlockScannerTipBaselineRequeriesUnchangedPayload(t *testing.T) {
	g, c, jobs := scannerFixture(t)
	if pending := g.step(context.Background(), jobs); len(pending) != 0 {
		t.Fatal("signed fixture did not finish original full checks")
	}
	scanner := g.scanners[0]
	for i := 0; i < 8; i++ {
		if err := scanner.refresh(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if c.blockCalls != 9 || g.stats.ScannedBlocks != 1 || g.stats.QuorumVerifications != 1 || g.reader.stats().Attempts != 1 {
		t.Fatal("baseline work changed", c.blockCalls, g.stats)
	}
	bytes := 0
	for _, raw := range c.block.Block.Data.Txs {
		bytes += len(raw)
	}
	t.Logf("UNCHANGED_TIP_BASELINE refreshes=9 fullBlockQueries=%d authenticatedBlocks=1 transactionPayloadBytesPerRepeatedBody=%d networkTPS=false", c.blockCalls, bytes)
}

type tipScannerTestClient struct {
	*scannerTestClient
	status      *coretypes.ResultStatus
	statusErr   error
	statusCalls int
	afterStatus func()
}

func (c *tipScannerTestClient) Status(context.Context) (*coretypes.ResultStatus, error) {
	c.timingFixtureBoundary()
	c.statusCalls++
	if c.afterStatus != nil {
		c.afterStatus()
	}
	if c.statusErr != nil {
		return nil, c.statusErr
	}
	if c.status != nil {
		return c.status, nil
	}
	status := &coretypes.ResultStatus{}
	status.NodeInfo.Network = c.block.Block.ChainID
	status.SyncInfo.LatestBlockHeight = c.block.Block.Height
	status.SyncInfo.LatestBlockHash = append([]byte(nil), c.block.BlockID.Hash...)
	return status, nil
}
func tipScannerFixture(t *testing.T) (*groupedObserver, *tipScannerTestClient, []acceptedObservation) {
	g, c, jobs := scannerFixture(t)
	client := &tipScannerTestClient{scannerTestClient: c}
	g.clients = []observationClient{client, client, client, client}
	g.blockTipHint = true
	return g, client, jobs
}
func TestBlockScannerTipHintUnchangedHeightAvoidsBodiesAndRetainsFullVerification(t *testing.T) {
	g, c, jobs := tipScannerFixture(t)
	if pending := g.step(context.Background(), jobs); len(pending) != 0 {
		t.Fatal("full signed fixture not confirmed")
	}
	s := g.scanners[0]
	for i := 0; i < 8; i++ {
		if err := s.refresh(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if c.statusCalls != 9 || c.blockCalls != 1 || c.resultCalls != 1 || c.commitCalls != 1 || c.validatorCalls != 1 || g.stats.QuorumVerifications != 1 || g.stats.ScannedBlocks != 1 || g.reader.stats().Attempts != 1 {
		t.Fatal("missing/repeated authority or block work", c, g.stats)
	}
	for _, job := range jobs {
		r := g.results[job.index]
		if r.Status != "confirmed" || !r.QuorumVerified || !r.TransactionProofVerified || !r.DurableStateVerified || !r.DurableInfoVerified {
			t.Fatal("hint invented completion", r.Status)
		}
	}
	t.Logf("UNCHANGED_TIP_HINT refreshes=9 statusQueries=%d fullBlockQueries=%d authenticatedBlocks=1 signedExecutedDurable=3 networkTPS=false", c.statusCalls, c.blockCalls)
}
func TestBlockScannerTipHintBadStatusCannotPublishOrFallback(t *testing.T) {
	for _, fault := range []string{"chain", "negative", "hash", "bound", "missing-capability"} {
		t.Run(fault, func(t *testing.T) {
			g, c, jobs := tipScannerFixture(t)
			status, _ := c.Status(context.Background())
			c.statusCalls = 0
			c.status = status
			switch fault {
			case "chain":
				status.NodeInfo.Network = "wrong-chain"
			case "negative":
				status.SyncInfo.LatestBlockHeight = -1
			case "hash":
				status.SyncInfo.LatestBlockHash = nil
			case "bound":
				status.SyncInfo.LatestBlockHeight = int64(g.reader.migration.Height) + 1 + blockScanWindowHeights
			case "missing-capability":
				g.clients = []observationClient{c.scannerTestClient, c.scannerTestClient, c.scannerTestClient, c.scannerTestClient}
			}
			g.step(context.Background(), jobs)
			for _, job := range jobs {
				if g.results[job.index].Status != "observation_failed" {
					t.Fatal("bad hint accepted", fault)
				}
			}
			if c.blockCalls != 0 || c.commitCalls != 0 || g.reader.stats().Attempts != 0 || g.stats.ScannedBlocks != 0 {
				t.Fatal("bad hint reached authority/store")
			}
			calls := c.statusCalls
			g.step(context.Background(), jobs)
			if c.statusCalls != calls {
				t.Fatal("poisoned hint queried again")
			}
		})
	}
}
func TestBlockScannerTipHintCannotBypassSignedBlockFailures(t *testing.T) {
	for _, fault := range []string{"signature", "payload", "results", "hint-hash"} {
		t.Run(fault, func(t *testing.T) {
			g, c, jobs := tipScannerFixture(t)
			switch fault {
			case "signature":
				c.commit.Commit.Signatures[0].Signature[0] ^= 1
			case "payload":
				c.block.Block.Data.Txs[0][0] ^= 1
			case "results":
				c.results.Height++
			case "hint-hash":
				status, _ := c.Status(context.Background())
				status.SyncInfo.LatestBlockHash[0] ^= 1
				c.status = status
			}
			g.step(context.Background(), jobs)
			for _, job := range jobs {
				if g.results[job.index].Status != "observation_failed" {
					t.Fatal("bad block accepted", fault)
				}
			}
			if g.reader.stats().Attempts != 0 || g.stats.ScannedBlocks != 0 {
				t.Fatal("bad block reached fresh durability")
			}
		})
	}
}
func TestBlockScannerTipHintRetryFrontierAndFreshDurability(t *testing.T) {
	g, c, jobs := tipScannerFixture(t)
	c.statusErr = errors.New("temporary status read failure")
	if pending := g.step(context.Background(), jobs); len(pending) != 3 || c.blockCalls != 0 || g.stats.ScannedBlocks != 0 {
		t.Fatal("read failure advanced cursor")
	}
	c.statusErr = nil
	if pending := g.step(context.Background(), jobs[:1]); len(pending) != 0 {
		t.Fatal("valid first member failed")
	}
	corruptDurableScannerStore(t, g)
	if pending := g.step(context.Background(), jobs[1:]); len(pending) != 0 {
		t.Fatal("bad durable state not terminal")
	}
	for _, job := range jobs[1:] {
		if g.results[job.index].Status != "observation_failed" {
			t.Fatal("cached hint bypassed fresh durability")
		}
	}
	if g.reader.stats().Attempts != 2 || c.blockCalls != 1 || c.statusCalls != 3 {
		t.Fatal("fresh capture or hint work differs")
	}
	// A later hint contradicting an authenticated frontier must poison the scanner.
	g, c, jobs = tipScannerFixture(t)
	g.step(context.Background(), jobs)
	status, _ := c.Status(context.Background())
	status.SyncInfo.LatestBlockHash[0] ^= 1
	c.status = status
	if err := g.scanners[0].refresh(context.Background()); err == nil {
		t.Fatal("conflicting frontier accepted")
	}
	if _, err := g.scanners[0].find(g.txs[jobs[0].index]); err == nil {
		t.Fatal("poisoned cache reused")
	}
}
func TestBlockScannerTipHintBoundedCatchupStillFetchesEveryHeight(t *testing.T) {
	g, c, _ := tipScannerFixture(t)
	start := c.block.Block.Height
	c.blocks = map[int64]*coretypes.ResultBlock{}
	c.commits = map[int64]*coretypes.ResultCommit{}
	c.blockResults = map[int64]*coretypes.ResultBlockResults{}
	for i := 0; i < 17; i++ {
		height := start + int64(i)
		var txs cmttypes.Txs
		if i == 0 {
			txs = cmttypes.Txs{append(cmttypes.Tx(nil), g.txs[0]...)}
		}
		b, commit, results := scannerSignedBlockAt(t, c.scannerTestClient, height, txs)
		c.blocks[height] = b
		c.commits[height] = commit
		c.blockResults[height] = results
		if i == 16 {
			c.block = b
		}
	}
	s := &blockInclusionScanner{manifest: g.manifest, trusted: g.trusted, client: c, stats: &g.stats, start: start, next: start, useStatusTip: true}
	if err := s.refresh(context.Background()); err != nil || g.stats.ScannedBlocks != 8 {
		t.Fatal("unbounded hint catchup", err)
	}
	for i := 0; i < 2; i++ {
		if err := s.refresh(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if g.stats.ScannedBlocks != 17 || c.blockCalls != 17 || c.commitCalls != 17 || c.validatorCalls != 17 || c.resultCalls != 17 || s.next != start+17 || len(s.blocks) != 16 || s.bytes > blockScanCacheBytes {
		t.Fatal("hint skipped height/authentication or cache bound", g.stats)
	}
}
func TestNativeStreamingBlockTipHintScopeDefaultAndPlan(t *testing.T) {
	o := nativeStreamingOptions()
	if o.nativeBlockTipHint {
		t.Fatal("tip hint default on")
	}
	for _, selected := range []bool{false, true} {
		_, manifest, m, _, initial := senderFixture(t)
		o := nativeStreamingOptions()
		o.nativeBlockTipHint = selected
		o.output = filepath.Join(t.TempDir(), "report.json")
		if err := validateOptions(o); err != nil {
			t.Fatal(err)
		}
		path, _, err := persistStreamingWorkloadPlan(o, manifest, m, initial)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var plan streamingWorkloadPlan
		if err = json.Unmarshal(raw, &plan); err != nil || plan.NativePrefix.BlockTipHint != selected {
			t.Fatal("persisted actual hint mode differs", err)
		}
		encoded, _ := json.Marshal(report{NativeBlockTipHint: selected})
		if bytes.Contains(encoded, []byte("nativeBlockTipHint")) != selected {
			t.Fatal("default report shape changed")
		}
	}
	for _, mutate := range []func(*options){func(o *options) { o.nativeStream8 = false }, func(o *options) { o.nativeCanonicalCertificate = true }, func(o *options) { o.nativeSuffixSetup = true }, func(o *options) { o.observerPhaseTiming = false }} {
		o := nativeStreamingOptions()
		o.nativeBlockTipHint = true
		mutate(&o)
		if validateOptions(o) == nil {
			t.Fatal("unsupported/mixed hint accepted")
		}
	}
}

func TestBlockScannerTipHintStartupRegressionAndDeadline(t *testing.T) {
	g, c, jobs := tipScannerFixture(t)
	status, _ := c.Status(context.Background())
	status.SyncInfo.LatestBlockHeight = 0
	status.SyncInfo.LatestBlockHash = nil
	c.status = status
	c.statusCalls = 0
	if pending := g.step(context.Background(), jobs); len(pending) != 3 || g.stats.ScannedBlocks != 0 || c.blockCalls != 0 || g.scanners[0].poisoned != nil {
		t.Fatal("startup hint invented/poisoned a block")
	}
	c.status = nil
	if pending := g.step(context.Background(), jobs); len(pending) != 0 {
		t.Fatal("startup did not recover")
	}
	status, _ = c.Status(context.Background())
	status.SyncInfo.LatestBlockHeight--
	c.status = status
	if err := g.scanners[0].refresh(context.Background()); err == nil || g.scanners[0].poisoned == nil {
		t.Fatal("regressed status accepted")
	}
	for _, after := range []bool{false, true} {
		g, c, _ := tipScannerFixture(t)
		ctx, cancel := context.WithCancel(context.Background())
		s := &blockInclusionScanner{manifest: g.manifest, trusted: g.trusted, client: c, stats: &g.stats, start: c.block.Block.Height, next: c.block.Block.Height, useStatusTip: true}
		if after {
			c.afterStatus = cancel
		} else {
			cancel()
		}
		if err := s.refresh(ctx); !errors.Is(err, context.Canceled) {
			t.Fatal("cancelled hint observation continued", err)
		}
		cancel()
		if c.blockCalls != 0 || len(s.blocks) != 0 || g.stats.ScannedBlocks != 0 || c.statusCalls != map[bool]int{false: 0, true: 1}[after] {
			t.Fatal("deadline published/fetched block")
		}
	}
	var total groupedObservationStats
	total.add(groupedObservationStats{BlockTipStatusQueries: 3})
	if total.BlockTipStatusQueries != 3 {
		t.Fatal("status query aggregation lost")
	}
}
