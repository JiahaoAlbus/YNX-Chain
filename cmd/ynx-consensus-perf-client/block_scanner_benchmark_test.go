package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/crypto/merkle"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

// Both modes authenticate the same retained real network block, then read the
// same real durable state. RPC answers are in memory: no server/network latency
// is simulated or counted as newly executed business throughput.
func BenchmarkBlockDiscoveryConfirmation(b *testing.B) {
	window := os.Getenv("YNX_CHAIN_BLOCK_SCAN_WINDOW")
	if window == "" {
		b.Skip("requires retained stopped four-node window")
	}
	read := func(path string, target any) []byte {
		raw, err := readBounded(path, 16<<20)
		if err != nil {
			b.Fatal(err)
		}
		if err = json.Unmarshal(raw, target); err != nil {
			b.Fatal(err)
		}
		return raw
	}
	manifestPath := filepath.Join(window, "network", "network-manifest.json")
	var m consensus.EphemeralNetworkManifest
	read(manifestPath, &m)
	if err := validateManifest(m); err != nil {
		b.Fatal(err)
	}
	if err := validateLocalPaths(m, manifestPath); err != nil {
		b.Fatal(err)
	}
	migration, err := readMigration(m)
	if err != nil {
		b.Fatal(err)
	}
	trusted, err := loadTrustedValidators(m)
	if err != nil {
		b.Fatal(err)
	}
	var replay struct {
		PublicSignedBlocks []struct {
			Height       int64
			Header       *cmttypes.Header
			Commit       *cmttypes.Commit
			Transactions cmttypes.Txs
		}
	}
	read(filepath.Join(window, "stopped-replay.json"), &replay)
	var observation report
	read(filepath.Join(window, "transactions-result.json"), &observation)
	selected := -1
	for i, p := range replay.PublicSignedBlocks {
		if len(p.Transactions) == 32 {
			selected = i
			break
		}
	}
	if selected < 0 {
		b.Fatal("requires one actual 32-transaction block")
	}
	p := replay.PublicSignedBlocks[selected]
	vals := &coretypes.ResultValidators{BlockHeight: p.Height, Validators: trusted.Validators, Count: 4, Total: 4}
	commit := &coretypes.ResultCommit{SignedHeader: cmttypes.SignedHeader{Header: p.Header, Commit: p.Commit}, CanonicalCommit: true}
	if err := verifyBlockConfirmation(m, trusted, vals, commit, p.Height); err != nil {
		b.Fatal(err)
	}
	block := &coretypes.ResultBlock{BlockID: p.Commit.BlockID, Block: &cmttypes.Block{Header: *p.Header, Data: cmttypes.Data{Txs: p.Transactions}}}
	byHash := map[string]transactionResult{}
	for _, r := range observation.Transactions {
		byHash[r.Hash] = r
	}
	leaves := make([][]byte, len(p.Transactions))
	for i, raw := range p.Transactions {
		leaves[i] = raw.Hash()
	}
	root, proofs := merkle.ProofsFromByteSlices(leaves)
	responses := map[string]*coretypes.ResultTx{}
	results := &coretypes.ResultBlockResults{Height: p.Height}
	txs := make([]cmttypes.Tx, len(p.Transactions)*4)
	jobs := make([]acceptedObservation, len(p.Transactions))
	for i, raw := range p.Transactions {
		observed, ok := byHash[hexUpper(raw.Hash())]
		if !ok || observed.ExecutionCode == nil || *observed.ExecutionCode != 0 || !verifiedBusinessInclusion(observed) {
			b.Fatal("retained input lacks original executed business evidence")
		}
		execution := &abci.ExecTxResult{Code: *observed.ExecutionCode, Log: observed.ExecutionLog}
		results.TxsResults = append(results.TxsResults, execution)
		responses[string(raw.Hash())] = &coretypes.ResultTx{Hash: raw.Hash(), Height: p.Height, Index: uint32(i), Tx: raw, TxResult: *execution, Proof: cmttypes.TxProof{RootHash: root, Data: raw, Proof: *proofs[i]}}
		txs[i*4] = raw
		jobs[i] = acceptedObservation{index: i * 4}
	}
	stateRaw, err := readBounded(m.Nodes[0].ABCIStatePath, durableSnapshotLimit)
	if err != nil {
		b.Fatal(err)
	}
	decoded, err := decodeDurableSnapshot(context.Background(), stateRaw, migration)
	if err != nil {
		b.Fatal(err)
	}
	appHash, err := hex.DecodeString(decoded.state.AppHash)
	if err != nil {
		b.Fatal(err)
	}
	info := &coretypes.ResultABCIInfo{Response: abci.ResponseInfo{LastBlockHeight: decoded.state.Height, LastBlockAppHash: appHash}}
	for _, mode := range []string{"tx-query", "block-scan"} {
		b.Run(mode, func(b *testing.B) {
			reader, err := newDurableReader(migration, []string{m.Nodes[0].ABCIStatePath})
			if err != nil {
				b.Fatal(err)
			}
			if _, err = reader.verify(context.Background(), m.Nodes[0].ABCIStatePath, p.Transactions[0], p.Height); err != nil {
				b.Fatal(err)
			}
			before := reader.stats()
			var totals groupedObservationStats
			b.ReportAllocs()
			b.ResetTimer()
			for n := 0; n < b.N; n++ {
				client := &scannerTestClient{groupedTestClient: &groupedTestClient{txs: responses, commit: commit, validators: vals, info: info}, block: block, results: results}
				g := &groupedObserver{manifest: m, trusted: trusted, reader: reader, clients: []observationClient{client, client, client, client}, txs: txs, results: make([]transactionResult, len(txs)), included: map[int]*coretypes.ResultTx{}, inclusionMode: mode}
				if mode == "block-scan" {
					g.scanners = map[int]*blockInclusionScanner{0: {manifest: m, trusted: trusted, client: client, stats: &g.stats, start: p.Height, next: p.Height}}
				}
				started := time.Now()
				for i := range jobs {
					jobs[i].started = started
				}
				if pending := g.step(context.Background(), jobs); len(pending) != 0 {
					b.Fatal("retained block left pending")
				}
				for _, job := range jobs {
					if !verifiedBusinessInclusion(g.results[job.index]) || g.results[job.index].Status != "confirmed" {
						b.Fatal("retained signed block verification failed")
					}
				}
				totals.add(g.stats)
			}
			b.StopTimer()
			after := reader.stats()
			rpc := totals.TransactionQueries + totals.BlockQueries + totals.BlockResultsQueries + totals.CommitQueries + totals.ValidatorQueries + totals.PublishedInfoQueries
			b.ReportMetric(float64(rpc)/float64(b.N), "rpc-calls/op")
			b.ReportMetric(float64(totals.TransactionQueries)/float64(b.N), "tx-rpc/op")
			b.ReportMetric(float64(after.TransactionVerifications-before.TransactionVerifications)/float64(b.N), "signatures/op")
			b.ReportMetric(float64(after.BytesHashed-before.BytesHashed)/float64(b.N), "store-bytes/op")
		})
	}
}

func hexUpper(raw []byte) string {
	const digits = "0123456789ABCDEF"
	out := make([]byte, 2*len(raw))
	for i, v := range raw {
		out[2*i], out[2*i+1] = digits[v>>4], digits[v&15]
	}
	return string(out)
}
