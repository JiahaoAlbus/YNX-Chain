package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// Explicit offline ABBA on original signed journal prefixes; never business TPS.
func TestBlockJournalPrefixOriginal2048MatchedCost(t *testing.T) {
	dir := os.Getenv("YNX_PREFIX_REPLAY_FIXTURE_DIR")
	if dir == "" {
		t.Skip("explicit retained original2048 offline cost probe only")
	}
	load := func(name, want string) []byte {
		t.Helper()
		b, e := os.ReadFile(filepath.Join(dir, name))
		if e != nil {
			t.Fatal(e)
		}
		sum := sha256.Sum256(b)
		if hex.EncodeToString(sum[:]) != want {
			t.Fatal("original artifact input differs", name)
		}
		return b
	}
	data := load("ynx-abci-state.json", "7c2a5b38bdb057972462068772196e74e4ab5c8564712fea1f54a6e89bee4d0a")
	raw := load("bound-migration.json", "92b3040f1ac4aab8e4ab3163fa7132af772ea8ad22d5caaed72c98fb37981b94")
	var migration chain.ConsensusMigrationState
	if err := json.Unmarshal(raw, &migration); err != nil {
		t.Fatal(err)
	}
	header := []byte(blockJournalMagic + migration.StateHash + "\n")
	if !bytes.HasPrefix(data, header) {
		t.Fatal("original header differs")
	}
	reader := bytes.NewReader(data[len(header):])
	ends := []int{}
	end := len(header)
	for {
		payload, n, _, e := readBlockJournalFrame(reader)
		if e != nil {
			t.Fatal(e)
		}
		if payload == nil {
			break
		}
		end += int(n)
		ends = append(ends, end)
	}
	if end != len(data) || len(ends) != 8 {
		t.Fatal("original7blocks/checkpoint coverage differs", len(ends), end)
	}
	type sample struct {
		Mode           string                        `json:"mode"`
		ElapsedNs      int64                         `json:"elapsedNs"`
		AllocatedBytes uint64                        `json:"allocatedBytes"`
		ReplayedBlocks int                           `json:"replayedBlocks"`
		ReplayedInputs int                           `json:"replayedInputs"`
		PrefixReuses   int                           `json:"prefixReuses"`
		Facts          BlockJournalVerificationStats `json:"facts"`
	}
	samples := []sample{}
	expected := make([][sha256.Size]byte, len(ends))
	for order, mode := range []string{"full", "prefix", "prefix", "full"} {
		full, e := NewBlockJournalDecoder(migration)
		if e != nil {
			t.Fatal(e)
		}
		prefix, e := NewBlockJournalPrefixDecoder(migration)
		if e != nil {
			t.Fatal(e)
		}
		runtime.GC()
		var before, after runtime.MemStats
		runtime.ReadMemStats(&before)
		started := time.Now()
		row := sample{Mode: mode}
		for i, n := range ends {
			var got BlockJournalReadback
			if mode == "full" {
				got, e = full.Decode(context.Background(), data[:n])
			} else {
				var candidate BlockJournalPrefixReadback
				candidate, e = prefix.Decode(context.Background(), data[:n])
				got = candidate.BlockJournalReadback
				if candidate.ReusedPrefixBytes > 0 {
					row.PrefixReuses++
				}
			}
			if e != nil || got.CompleteBytes != n || got.IncompleteTail {
				t.Fatal("original prefix failed", e)
			}
			sum := sha256.Sum256(got.SnapshotJSON)
			if order == 0 {
				expected[i] = sum
			} else if sum != expected[i] {
				t.Fatal("matched original prefix state differs", order, i)
			}
			row.ReplayedBlocks += got.ReplayedBlocks
			row.ReplayedInputs += got.ReplayedTransactionInputs
			if i == len(ends)-1 && (len(got.State.FeeEvents) != 2048 || hex.EncodeToString(sum[:]) != "67af2a5cdeeb6a0b5c4b9aa74bede75b3ed730e3e3f5828ac390f123149e9357") {
				t.Fatal("original final network state differs")
			}
		}
		row.ElapsedNs = time.Since(started).Nanoseconds()
		runtime.ReadMemStats(&after)
		row.AllocatedBytes = after.TotalAlloc - before.TotalAlloc
		if mode == "full" {
			row.Facts = full.VerificationStats()
			if row.ReplayedInputs != 7475 || row.ReplayedBlocks != 28 {
				t.Fatal("baseline work changed", row)
			}
		} else {
			row.Facts = prefix.full.VerificationStats()
			if row.ReplayedInputs != 2048 || row.ReplayedBlocks != 7 || row.PrefixReuses != 7 {
				t.Fatal("prefix work not reduced exactly", row)
			}
		}
		if row.Facts.SuccessfulVerifications != 2048 {
			t.Fatal("new original signatures not verified", row)
		}
		samples = append(samples, row)
	}
	out := map[string]any{"kind": "matched_offline_original2048_prefix_replay_ABBA_not_network_tps", "originalRun": 39164390241, "inputPrefixes": len(ends), "journalBytes": len(data), "goVersion": runtime.Version(), "os": runtime.GOOS, "arch": runtime.GOARCH, "gomaxprocs": runtime.GOMAXPROCS(0), "samples": samples, "limits": "Same original journal/migration/prefix order, new decoders per mode with bounded original native facts. No nodes/RPC/new quorum/publication/finality, only two samples per mode. Allocations are cumulative Go work, not peak RSS. No network speedup or sustained qualification."}
	encoded, e := json.Marshal(out)
	if e != nil {
		t.Fatal(e)
	}
	t.Log(string(encoded))
}
