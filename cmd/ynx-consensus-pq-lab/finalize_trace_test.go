//go:build unix

package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func TestPQLabFinalizeTraceCommandClosedInputs(t *testing.T) {
	for _, args := range [][]string{{"finalize-trace"}, {"finalize-trace", "other"}, {"finalize-trace", "export"}, {"finalize-trace", "replay"}, {"finalize-trace", "replay", "--synthetic", "--root", "/unused"}, {"finalize-trace", "export", "--synthetic", "--root", "/unused", "--root", "/other"}, {"finalize-trace", "replay", "--synthetic", "--trace", "/unused", "--trace-sha256", "bad", "--output", "/unused"}} {
		var out bytes.Buffer
		if e := run(args, &out); e == nil || out.Len() != 0 {
			t.Fatal("unknown/partial arguments returned success", args, e)
		}
	}
}

type traceBrokenOutput struct{}

func (traceBrokenOutput) Write([]byte) (int, error) {
	return 0, errors.New("original stdout acknowledgement lost")
}

func TestPQLabFinalizeTraceCommandOriginalPublicReplayAndLostOutput(t *testing.T) {
	dir := os.Getenv("YNX_PQ_LAB_FINALIZE_TRACE_FIXTURE_OUT")
	if dir == "" {
		t.Skip("explicit original public trace fixture not supplied")
	}
	raw, e := os.ReadFile(filepath.Join(dir, "result.json"))
	if e != nil {
		t.Fatal(e)
	}
	sum := sha256.Sum256(raw)
	pin := hex.EncodeToString(sum[:])
	var source consensus.PQLabFinalizeTrace
	if e = json.Unmarshal(raw, &source); e != nil {
		t.Fatal(e)
	}
	parent, e := filepath.EvalSymlinks(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	args := []string{"finalize-trace", "replay", "--synthetic", "--trace", dir, "--trace-sha256", pin, "--output", filepath.Join(parent, "normal-replay")}
	var out bytes.Buffer
	if e = run(args, &out); e != nil {
		t.Fatal("normal command original trace", e)
	}
	var result consensus.PQLabFinalizeReplay
	if e = json.Unmarshal(out.Bytes(), &result); e != nil {
		t.Fatal(e)
	}
	if !result.CompleteStateBytesReconstructed || !result.FullResponsesCompared || result.NormalizationApplied || result.NodeStarted || result.AuthorityGranted || result.LiveNetworkPairQualified || result.FirstHeight != source.FirstHeight || result.LastHeight != source.LastHeight || result.Records.SHA256 != source.Records.SHA256 {
		t.Fatal("normal command changed source/evidence scope")
	}
	args[len(args)-1] = filepath.Join(parent, "lost-ack")
	if e = run(args, traceBrokenOutput{}); e == nil || e.Error() != "original stdout acknowledgement lost" {
		t.Fatal("lost stdout not preserved", e)
	}
	retained, e := os.ReadFile(filepath.Join(args[len(args)-1], "result.json"))
	if e != nil {
		t.Fatal("complete durable original lost", e)
	}
	if e = run(args, &bytes.Buffer{}); e == nil {
		t.Fatal("unknown acknowledgement blindly retried")
	}
	after, e := os.ReadFile(filepath.Join(args[len(args)-1], "result.json"))
	if e != nil || !bytes.Equal(after, retained) {
		t.Fatal("original result changed", e)
	}
	after, e = os.ReadFile(filepath.Join(dir, "result.json"))
	if e != nil || !bytes.Equal(raw, after) {
		t.Fatal("public original trace mutated", e)
	}
}
