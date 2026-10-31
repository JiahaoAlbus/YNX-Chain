//go:build unix

package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func TestPQLabLiveMaterialsCommandStrictInputs(t *testing.T) {
	for _, args := range [][]string{
		{"live-materials"},
		{"live-materials", "unknown"},
		{"live-materials", "setup", "--root", "/missing"},
		{"live-materials", "setup", "--synthetic", "--root", "/missing", "--max-operations", "10001"},
		{"live-materials", "setup", "--synthetic", "--root", "/missing", "--root", "/replacement"},
		{"live-materials", "request", "--synthetic", "--sequence", "4294967296"},
		{"live-materials", "request", "--synthetic", "--sequence", "1", "--now", "2030-01-01"},
		{"live-materials", "request", "--synthetic", "--sequence", "1", "--trusted-block", "from-rpc"},
		{"live-materials", "result", "--synthetic", "--sequence", "0"},
		{"live-materials", "result", "--synthetic", "--sequence", "1", "--policy", "/missing", "--policy-sha256", strings.Repeat("a", 64)},
	} {
		var out bytes.Buffer
		if err := run(args, &out); err == nil || out.Len() != 0 {
			t.Fatal("invalid normal live command emitted ready/success", args, err)
		}
	}
}

func TestPQLabLiveMaterialsCommandOriginalSourceResultAndProofContext(t *testing.T) {
	root := os.Getenv("YNX_PQ_LAB_LIVE_FIXTURE_ROOT")
	if root == "" {
		t.Skip("explicit original synthetic live source fixture not supplied; no network is started")
	}
	raw, err := os.ReadFile(filepath.Join(root, "live-command-input.json"))
	if err != nil {
		t.Fatal(err)
	}
	var setup consensus.PQLabLiveMaterialsSetup
	if json.Unmarshal(raw, &setup) != nil {
		t.Fatal("original setup fixture")
	}
	args := []string{"live-materials", "result", "--synthetic", "--policy", setup.Policy.Path, "--policy-sha256", setup.Policy.SHA256, "--sequence", "1"}
	var out bytes.Buffer
	if err = run(args, &out); err != nil {
		t.Fatal("normal original live result command", err)
	}
	var result consensus.PQLabLiveMaterialsResult
	if json.Unmarshal(out.Bytes(), &result) != nil || !result.Verified.Result.Finalized || !result.Verified.Result.ExecutionSuccessful || result.AuthorityGranted || result.FourNodeAgreementClaim {
		t.Fatal("result changed source/authority boundary")
	}
	var proof bytes.Buffer
	if err = run([]string{"proof-context", "--synthetic", "--materials", result.Materials.Path, "--materials-sha256", result.Materials.SHA256, "--proof", result.Proof.Path, "--output", filepath.Join(root, "normal-live-proof-context")}, &proof); err != nil {
		t.Fatal("normal live original full proof consumer", err)
	}
	var verified consensus.PQLabProofExport
	if json.Unmarshal(proof.Bytes(), &verified) != nil || !reflect.DeepEqual(verified.Result, result.Verified.Result) {
		t.Fatal("normal verifier disagrees with original source proof")
	}
	unknown := append([]string(nil), args...)
	unknown[len(unknown)-1] = "3"
	if err = run(unknown, &bytes.Buffer{}); err == nil {
		t.Fatal("normal CLI converted retained UNKNOWN to success")
	}
	if err = run(append([]string{"live-materials", "request", "--synthetic", "--policy", setup.Policy.Path, "--policy-sha256", setup.Policy.SHA256, "--sequence", "4"}), &bytes.Buffer{}); err == nil {
		t.Fatal("fixed operation capacity bypassed")
	}
	before, err := os.ReadFile(filepath.Join(filepath.Dir(setup.Policy.Path), "operation-000003", "failure.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err = run(unknown, &bytes.Buffer{}); err == nil {
		t.Fatal("UNKNOWN reread became a retry")
	}
	after, err := os.ReadFile(filepath.Join(filepath.Dir(setup.Policy.Path), "operation-000003", "failure.json"))
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("normal CLI removed or changed original UNKNOWN", err)
	}
}
