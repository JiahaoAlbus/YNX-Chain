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
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func pqLabWorkloadCommandTemp(t *testing.T) string {
	t.Helper()
	p, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestPQLabWorkloadCommandInputsAndNoMutation(t *testing.T) {
	dir := pqLabWorkloadCommandTemp(t)
	file := filepath.Join(dir, "public.json")
	if err := os.WriteFile(file, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(dir, "alias")
	if err := os.Symlink(file, alias); err != nil {
		t.Fatal(err)
	}
	if _, err := readPQLabWorkloadFile(alias, 10); err == nil {
		t.Fatal("alias accepted")
	}
	if _, err := readPQLabWorkloadFile(file, 1); err == nil {
		t.Fatal("oversize accepted")
	}
	if raw, err := readPQLabWorkloadFile(file, 2); err != nil || string(raw) != "{}" {
		t.Fatal("normal bounded read failed", err)
	}
	output := filepath.Join(dir, "out")
	good := []string{"--synthetic", "--materials", file, "--materials-sha256", strings.Repeat("0", 64), "--proof", file, "--output", output}
	for _, args := range [][]string{nil, good, append(append([]string(nil), good...), "--materials", file), append(append([]string(nil), good...), "--now", "1"), good[1:]} {
		var out bytes.Buffer
		if err := runPQLabProofContext(args, &out); err == nil || out.Len() != 0 {
			t.Fatal("invalid trust input reported success")
		}
		if _, err := os.Stat(output); !os.IsNotExist(err) {
			t.Fatal("bad input mutated output")
		}
	}
}

// The consensus test's opt-in supplies a REAL synthetic BlockExecutor proof.
// No static fixture, fake successful JSON, network or private key is used here.
func TestPQLabWorkloadCommandRealProofInputs(t *testing.T) {
	fixture := os.Getenv("YNX_PQ_LAB_PROOF_FIXTURE_OUT")
	if fixture == "" {
		t.Skip("requires public proof emitted by TestPQLabWorkloadProofOriginalCLIInputsAndNegatives")
	}
	materialPath := filepath.Join(fixture, "operator-materials.json")
	raw, err := readPQLabWorkloadFile(materialPath, consensus.MaxPQLabProofMaterialsBytes)
	if err != nil {
		t.Fatal(err)
	}
	h := sha256.Sum256(raw)
	pin := hex.EncodeToString(h[:])
	output := filepath.Join(pqLabWorkloadCommandTemp(t), "context")
	args := []string{"--synthetic", "--materials", materialPath, "--materials-sha256", pin, "--proof", filepath.Join(fixture, "proof.json"), "--output", output}
	var out bytes.Buffer
	if err = runPQLabProofContext(args, &out); err != nil {
		t.Fatal("real normal proof producer failed", err)
	}
	var result consensus.PQLabProofExport
	if err = json.Unmarshal(out.Bytes(), &result); err != nil || !result.Result.Finalized || !result.Result.ExecutionSuccessful || result.AuthorityGranted || result.ActualNetworkExecutionClaim {
		t.Fatal("incorrect normal producer result", err)
	}
	original, err := os.ReadFile(filepath.Join(output, "trust-context.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err = runPQLabProofContext(args, &bytes.Buffer{}); err == nil {
		t.Fatal("existing original/UNKNOWN context overwritten")
	}
	after, err := os.ReadFile(filepath.Join(output, "trust-context.json"))
	if err != nil || !bytes.Equal(original, after) {
		t.Fatal("retained trust original changed")
	}
	// A lost caller acknowledgement preserves the same completed output.
	args[len(args)-1] = filepath.Join(pqLabWorkloadCommandTemp(t), "lost-ack")
	if err = runPQLabProofContext(args, pqLabBrokenWorkloadOutput{}); err == nil {
		t.Fatal("failed acknowledgement hidden")
	}
	if _, err = os.Stat(filepath.Join(args[len(args)-1], "PUBLIC-PROOF-INPUTS.json")); err != nil {
		t.Fatal("lost acknowledgement removed completed original", err)
	}
}

type pqLabBrokenWorkloadOutput struct{}

func (pqLabBrokenWorkloadOutput) Write([]byte) (int, error) {
	return 0, errors.New("synthetic output acknowledgement lost")
}
