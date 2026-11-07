//go:build unix

package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// The existing uncached migration reader accepts JSON document whitespace and
// still validates the complete original object, bootstrap and four checkpoints.
// This exceeds the optional cache's raw-byte budget with a small REAL synthetic
// fixture, without inventing 500 owners, dropping history or changing any pin.
func TestPQLabCheckpointCacheFallbackLargeOriginal(t *testing.T) {
	created, pin, height, appHash := pqLabSenderCommandFixture(t, true)
	path := created.Plan.MigrationFile
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	padded := append(bytes.Repeat([]byte(" "), 33<<20), raw...)
	if err = os.WriteFile(path, padded, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = consensus.LoadPQLabSenderCheckpointMeasured(created.Plan.RootDir, created.PlanSHA256, "", height, appHash, nil); err != nil {
		t.Fatal("legal original input failed full uncached validation", err)
	}
	credential, err := os.Open(filepath.Join(created.Plan.RootDir, "workload", "private-senders", "recovery.raw"))
	if err != nil {
		t.Fatal(err)
	}
	defer credential.Close()
	args := []string{"--synthetic", "--root", created.Plan.RootDir, "--plan-sha256", created.PlanSHA256, "--workload-sha256", pin, "--owner", "0", "--credential-fd", strconv.Itoa(int(credential.Fd())), "--timings"}
	request := consensus.PQLabSenderRequest{Version: "YNX-PQ-LAB-SENDER-REQUEST/v1", OperationID: strings.Repeat("a", 64), OwnerIndex: 0, FirstNonce: 2, Members: 1}
	command := pqLabSenderCommand{Version: "YNX-PQ-LAB-SENDER-COMMAND/v1", Operation: "sign", Request: request, CheckpointHeight: height, CheckpointAppHash: appHash}
	wire, err := json.Marshal(command)
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err = runPQLabSenderInput(args, bytes.NewReader(append(wire, '\n')), &output); err != nil {
		t.Fatal(err)
	}
	var reply struct {
		Code        string                          `json:"code"`
		Result      consensus.PQLabSenderResult     `json:"result"`
		Timings     consensus.PQLabMetricsSnapshot  `json:"timings"`
		StaticCache consensus.PQLabStaticCacheStats `json:"staticCache"`
	}
	if err = json.Unmarshal(output.Bytes(), &reply); err != nil {
		t.Fatal(err)
	}
	if reply.Code != "ORIGINAL_SAVED" {
		t.Fatal("PUBLIC_PQLAB_CACHE_BOUND_REJECTED_LEGAL_INPUT", reply.Code)
	}
	if reply.Result.Transaction.Members != "1" || reply.Result.AuthorityGranted || reply.Result.CheckpointHeight != height || reply.Result.CheckpointAppHash != appHash {
		t.Fatal("original N1 checkpoint/signing semantics changed")
	}
	if reply.Timings.Stages["checkpoint.nodeReadAndValidate"].Calls != 12 || reply.Timings.Stages["checkpoint.currentFourNodeRead"].Calls != 2 {
		t.Fatal("uncached fallback omitted a dynamic four-node check")
	}
	if reply.StaticCache.Entries != 0 || reply.StaticCache.Bypasses != 1 {
		t.Fatal("oversized originals retained in the optional cache")
	}
	if _, err = os.Stat(filepath.Join(created.Plan.RootDir, "workload", "sender-public", "0000", request.OperationID, "transaction.abci")); err != nil {
		t.Fatal("normal signed original was not durably saved", err)
	}
}

func TestPQLabCheckpointCacheFallbackOnlyExactBound(t *testing.T) {
	for _, test := range []struct {
		name string
		err  error
		want bool
	}{
		{"success", nil, false},
		{"clean-bound", consensus.ErrPQLabStaticCacheBound, true},
		{"wrapped-bound", fmt.Errorf("unknown wrapper: %w", consensus.ErrPQLabStaticCacheBound), false},
		{"joined-bound", errors.Join(consensus.ErrPQLabStaticCacheBound), false},
		{"cleanup-error", errors.Join(consensus.ErrPQLabStaticCacheBound, os.ErrClosed), false},
		{"signature-error", errors.Join(consensus.ErrPQLabStaticCacheBound, errors.New("signature rejected")), false},
		{"history-error", errors.New("history rejected"), false},
		{"authorization-error", errors.New("authorization rejected"), false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := pqLabCheckpointCacheBoundOnly(test.err); got != test.want {
				t.Fatal("error was mistaken for optional-cache eligibility", got)
			}
		})
	}
}

func TestPQLabCheckpointCacheFallbackRereadsOriginalAndCurrent(t *testing.T) {
	created, _, height, appHash := pqLabSenderCommandFixture(t, true)
	path := created.Plan.MigrationFile
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	padded := append(bytes.Repeat([]byte(" "), 33<<20), raw...)
	if err = os.WriteFile(path, padded, 0600); err != nil {
		t.Fatal(err)
	}
	loader := pqLabSenderCheckpointLoader{}
	defer loader.close()
	first, second := &consensus.PQLabMetrics{}, &consensus.PQLabMetrics{}
	if _, err = loader.load(created.Plan.RootDir, created.PlanSHA256, "", height, appHash, first); err != nil {
		t.Fatal(err)
	}
	if _, err = loader.load(created.Plan.RootDir, created.PlanSHA256, "", height, appHash, second); err != nil {
		t.Fatal(err)
	}
	stats := loader.stats()
	if stats.Misses != 1 || stats.Bypasses != 1 || stats.Entries != 0 || stats.HeldFiles != 0 || stats.OriginalBytes != 0 {
		t.Fatal("optional cache was enlarged or retried instead of full validation", stats)
	}
	if first.Snapshot().Stages["checkpoint.loadTotal"].Calls != 1 || second.Snapshot().Stages["checkpoint.loadTotal"].Calls != 1 || second.Snapshot().Stages["lab.bootstrapFullValidation"].Calls != 0 || second.Snapshot().Stages["checkpoint.nodeReadAndValidate"].Calls != 4 {
		t.Fatal("held source rebuilt immutable validation or omitted actual current state")
	}
	for _, test := range []struct {
		name, plan, hash string
		height           int64
	}{
		{"foreign-plan", strings.Repeat("f", 64), appHash, height},
		{"wrong-height", created.PlanSHA256, appHash, height + 1},
		{"wrong-hash", created.PlanSHA256, strings.Repeat("f", 64), height},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := loader.load(created.Plan.RootDir, test.plan, "", test.height, test.hash, nil); err == nil {
				t.Fatal("uncached eligibility became independent checkpoint authority")
			}
		})
	}
	statePath := created.Plan.Nodes[0].StatePath
	state, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(statePath, []byte(`{"invalid-current-policy":true}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = loader.load(created.Plan.RootDir, created.PlanSHA256, "", height, appHash, nil); err == nil {
		t.Fatal("uncached mode retained an earlier current policy/checkpoint")
	}
	if err = os.WriteFile(statePath, state, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, append(padded, 'x'), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = loader.load(created.Plan.RootDir, created.PlanSHA256, "", height, appHash, nil); err == nil {
		t.Fatal("uncached mode retained earlier original migration validation")
	}
	entries, err := os.ReadDir(filepath.Join(created.Plan.RootDir, "workload", "sender-public", "0000"))
	if err != nil || len(entries) != 0 {
		t.Fatal("checkpoint-only validation reserved an operation or nonce", err)
	}
}
