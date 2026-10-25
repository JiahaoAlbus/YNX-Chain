package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// Measures existing real history/replay work without creating transactions,
// changing the retained stores or starting a node. These are different workload
// shapes, not a before/after optimization or extrapolated sustained capacity.
func BenchmarkJournalReadbackPressure(b *testing.B) {
	root := os.Getenv("YNX_CHAIN_REPLAY_FIXTURE_ROOT")
	if root == "" {
		b.Skip("requires retained performance workspace")
	}
	for _, size := range []string{"network64", "application1024", "network1024"} {
		b.Run(size, func(b *testing.B) {
			var migration chain.ConsensusMigrationState
			var statePath string
			expectedFees := 1024
			if size != "application1024" {
				window := "window-oJZYQJ"
				if size == "network1024" {
					window = "window-RWY2KW"
				}
				manifestPath := filepath.Join(root, "artifacts/chain-network-performance", window, "network/network-manifest.json")
				manifestRaw, err := readBounded(manifestPath, 16<<20)
				if err != nil {
					b.Fatal(err)
				}
				var m consensus.EphemeralNetworkManifest
				if err = json.Unmarshal(manifestRaw, &m); err != nil {
					b.Fatal(err)
				}
				if err = validateManifest(m); err != nil {
					b.Fatal(err)
				}
				if err = validateLocalPaths(m, manifestPath); err != nil {
					b.Fatal(err)
				}
				migration, err = readMigration(m)
				if err != nil {
					b.Fatal(err)
				}
				statePath = m.Nodes[0].ABCIStatePath
				if size == "network64" {
					expectedFees = 64
				}
			} else {
				migrationRaw, err := readBounded(filepath.Join(root, "artifacts/chain-performance-20261017/local-performance-migration.json"), 16<<20)
				if err != nil {
					b.Fatal(err)
				}
				if err = json.Unmarshal(migrationRaw, &migration); err != nil {
					b.Fatal(err)
				}
				statePath = filepath.Join(root, "artifacts/chain-performance-20261017/abci-run-3560683502/state.json")
			}
			data, err := readBounded(statePath, durableSnapshotLimit)
			if err != nil {
				b.Fatal(err)
			}
			baseline, err := decodeDurableSnapshot(context.Background(), data, migration)
			if err != nil || baseline.format != "block-journal" || baseline.incompleteTail || len(baseline.state.FeeEvents) != expectedFees {
				b.Fatal("retained workload identity/reconstruction mismatch", err)
			}
			sum := sha256.Sum256(data)
			snapshot := sha256.Sum256(baseline.payload)
			b.Logf("store=%s bytes=%d sha256=%s canonicalSha256=%s fees=%d tailBlocks=%d replayInputs=%d", statePath, len(data), hex.EncodeToString(sum[:]), hex.EncodeToString(snapshot[:]), len(baseline.state.FeeEvents), baseline.replayedBlocks, baseline.replayedTxInputs)
			for _, operation := range []string{"reconstruct", "reconstruct_with_shared_facts", "validate_reconstructed_state"} {
				b.Run(operation, func(b *testing.B) {
					decoder, err := consensus.NewBlockJournalDecoder(migration)
					if err != nil {
						b.Fatal(err)
					}
					if operation == "reconstruct_with_shared_facts" {
						if _, err := decoder.Decode(context.Background(), data); err != nil {
							b.Fatal(err)
						}
					}
					before := decoder.VerificationStats()
					b.ReportAllocs()
					b.ResetTimer()
					for n := 0; n < b.N; n++ {
						if operation != "validate_reconstructed_state" {
							var facts *consensus.BlockJournalDecoder
							if operation == "reconstruct_with_shared_facts" {
								facts = decoder
							}
							decoded, err := decodeDurableSnapshotWithFacts(context.Background(), data, migration, facts)
							if err != nil || decoded.state.AppHash != baseline.state.AppHash || decoded.incompleteTail || len(decoded.state.FeeEvents) != expectedFees || sha256.Sum256(decoded.payload) != snapshot {
								b.Fatal("reconstruction changed real state", err)
							}
						} else if err := baseline.state.Validate(migration); err != nil {
							b.Fatal(err)
						}
					}
					b.StopTimer()
					b.ReportMetric(float64(expectedFees), "history-fees/op")
					b.ReportMetric(float64(len(data)), "input-store-B")
					if operation != "validate_reconstructed_state" {
						b.ReportMetric(float64(baseline.replayedTxInputs), "replayed-inputs/op")
						b.ReportMetric(float64(baseline.replayedBlocks), "replayed-blocks/op")
					}
					if operation == "reconstruct_with_shared_facts" {
						after := decoder.VerificationStats()
						b.ReportMetric(float64(after.Hits-before.Hits)/float64(b.N), "replay-crypto-cache-hits/op")
						b.ReportMetric(float64(after.SuccessfulVerifications-before.SuccessfulVerifications)/float64(b.N), "new-replay-crypto-verifications/op")
					}
				})
			}
		})
	}
}
