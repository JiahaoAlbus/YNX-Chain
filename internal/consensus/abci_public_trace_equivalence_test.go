//go:build unix

package consensus

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// This fixed PUBLIC synthetic trace is unrelated to any held or UNKNOWN live
// operation. The normal replay checks complete response, full state bytes and
// AppHash against the exact independently pinned original at every height.
func TestABCIPublicTraceFullStateAndAppHashEveryHeight(t *testing.T) {
	fixture, err := filepath.Abs(filepath.Join("..", "..", "scripts", "loadtest", "fixtures", "finalize-1b-public"))
	if err != nil {
		t.Fatal(err)
	}
	fixture, err = filepath.EvalSymlinks(fixture)
	if err != nil {
		t.Fatal(err)
	}
	const pin = "11ff25aba4aa4052f8a3062930bac41d223384ca218f460afb7c7847433fb0f6"
	raw, err := os.ReadFile(filepath.Join(fixture, "result.json"))
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != pin {
		t.Fatal("fixed PUBLIC trace identity differs")
	}
	parent, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	// The production reader requires original regular files mode 0600; Git
	// fixtures have repository mode 0644. Make one exact private public-DATA
	// copy in a fresh local test directory; the pinned replay rechecks all roles.
	trace := filepath.Join(parent, "trace")
	if err := os.Mkdir(trace, 0700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"intent.json", "result.json", "migration.json", "genesis.json", "schedule.json", "init-chain.pb", "initial-state.json", "final-state.json", "records.jsonl"} {
		data, err := os.ReadFile(filepath.Join(fixture, name))
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(trace, name), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	output := filepath.Join(parent, "original-replay")
	replay, err := ReplayPQLabFinalizeTrace(context.Background(), trace, pin, output)
	if err != nil {
		t.Fatal(err)
	}
	if replay.FirstHeight != 4 || replay.LastHeight != 12 || !replay.CompleteStateBytesReconstructed || !replay.FullResponsesCompared || !replay.SyntheticOnly || !replay.SourceReadOnly || replay.NodeStarted || replay.AuthorityGranted || replay.LiveNetworkPairQualified || replay.NormalizationApplied {
		t.Fatalf("replay changed its evidence boundary: %+v", replay)
	}
	want, err := os.ReadFile(filepath.Join(trace, "records.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(output, "replay.jsonl"))
	if err != nil || !bytes.Equal(want, got) {
		t.Fatal("complete per-height records differ", err)
	}
	wantFinal, err := os.ReadFile(filepath.Join(trace, "final-state.json"))
	if err != nil {
		t.Fatal(err)
	}
	gotFinal, err := os.ReadFile(filepath.Join(output, "final-state.json"))
	if err != nil || !bytes.Equal(wantFinal, gotFinal) {
		t.Fatal("full cold final state differs", err)
	}
	scanner := bufio.NewScanner(bytes.NewReader(got))
	scanner.Buffer(make([]byte, 64<<10), 8<<20)
	height := int64(4)
	for scanner.Scan() {
		var row PQLabFinalizeTraceRecord
		if err := json.Unmarshal(scanner.Bytes(), &row); err != nil {
			t.Fatal(err)
		}
		if row.Height != height || row.AppHash == "" || row.StateSHA256 == "" || row.StateBytes <= 0 {
			t.Fatalf("missing original full-state result at %d", height)
		}
		t.Logf("PUBLIC synthetic height=%d stateBytes=%d stateSHA256=%s appHash=%s", row.Height, row.StateBytes, row.StateSHA256, row.AppHash)
		height++
	}
	if err := scanner.Err(); err != nil || height != 13 {
		t.Fatal("incomplete original height trajectory", err, height)
	}
}
