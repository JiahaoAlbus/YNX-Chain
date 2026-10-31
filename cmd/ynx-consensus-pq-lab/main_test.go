//go:build unix

package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestPQLabNormalCommandFreshIndependentProcessInputs(t *testing.T) {
	parent, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(parent, "four-normal-processes")
	args := []string{"create", "--synthetic", "--root", root, "--transactions", "4", "--batch-size", "2"}
	var out bytes.Buffer
	if err = run(args, &out); err != nil {
		t.Fatal(err)
	}
	var result createResult
	if err = json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.NodeStarted || result.PQQuorumVerified || len(result.Plan.Nodes) != 4 || len(result.Workload.Transactions) != 2 || result.Plan.NativeChainID != 642399 {
		t.Fatal("normal producer did not preserve isolated original metadata")
	}
	before, err := os.ReadFile(result.PlanFile)
	if err != nil {
		t.Fatal(err)
	}
	if err = run(args, &bytes.Buffer{}); err == nil {
		t.Fatal("normal command regenerated existing lab")
	}
	after, err := os.ReadFile(result.PlanFile)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("retry removed original plan", err)
	}
	regArgs := []string{"registration", "--synthetic", "--root", root, "--plan-sha256", result.PlanSHA256, "--node", "0", "--approved-at", result.Workload.SourceHeight}
	// SourceHeight is strictly before the first Comet height. The command must
	// not silently advance an approval signed for the wrong ledger coordinate.
	if err = run(regArgs, &bytes.Buffer{}); err == nil {
		t.Fatal("wrong registration height accepted")
	}
}

func TestPQLabNormalCommandRefusesImplicitOrDuplicateInputs(t *testing.T) {
	for _, args := range [][]string{nil, {"unknown"}, {"create"}, {"create", "--root", "/unused"}, {"create", "--synthetic", "--root", "/unused", "--root", "/other"}, {"create", "--synthetic", "--root", "/unused", "--transactions", "0"}, {"activate", "--synthetic", "--root", "/unused", "--unknown", "x"}, {"registration", "--synthetic", "--root"}} {
		var out bytes.Buffer
		if err := run(args, &out); err == nil || out.Len() != 0 {
			t.Fatal("invalid normal command produced a ready response", args, err)
		}
	}
}
