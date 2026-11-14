//go:build unix

package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// Retain exactly the single original operation and compare its bytes around
// independent lease reacquisition. This is test-only, never recovery/retry.
func poisonOriginalSnapshot(t *testing.T, ownerDirectory string) map[string][32]byte {
	t.Helper()
	entries, err := os.ReadDir(ownerDirectory)
	if err != nil || len(entries) != 1 || entries[0].Name() != strings.Repeat("b", 64) {
		t.Fatal("missing or replaced original operation", err)
	}
	dir := filepath.Join(ownerDirectory, entries[0].Name())
	if _, err = os.Lstat(filepath.Join(dir, "CONFIRMED.json")); !os.IsNotExist(err) {
		t.Fatal("unexpected fabricated confirmation", err)
	}
	result := map[string][32]byte{}
	for _, name := range []string{"request.json", "INTENT.json", "transaction.wire", "transaction.abci", "RESULT.json"} {
		raw, e := os.ReadFile(filepath.Join(dir, name))
		if e != nil || len(raw) == 0 {
			t.Fatal("original operation component missing", name, e)
		}
		result[name] = sha256.Sum256(raw)
	}
	return result
}

// Test-only process helper; it uses the actual production CLI entrypoint,
// signal handling and original sender session, not a simulated Go responder.
func TestPQLabExperimentalPoisonGoHelper(t *testing.T) {
	if os.Getenv("YNX_POISON_GO_CHILD") != "1" {
		t.Skip("subprocess helper only; not standalone validation")
	}
	var args []string
	if err := json.Unmarshal([]byte(os.Getenv("YNX_POISON_GO_ARGS")), &args); err != nil {
		t.Fatal(err)
	}
	if err := runPQLabPublicOwners(args, os.Stdout); err != nil {
		t.Fatal(err)
	}
}

func TestPQLabExperimentalPythonPoisonRetiresActualGoSession(t *testing.T) {
	tools := os.Getenv("YNX_POISON_TOOLS")
	python := os.Getenv("YNX_POISON_PYTHON")
	if tools == "" || python == "" {
		t.Skip("explicit isolated Python/Tools candidate paths required")
	}
	args, created, height, hash := publicOwnerCommandArgs(t)
	for i := range args {
		if args[i] == "--credential-fd" {
			args[i+1] = "3"
		}
	}
	args = append(args, "--ready")
	encoded, _ := json.Marshal(args)
	checkpoint, _ := json.Marshal(map[string]any{"height": height, "appHash": hash})
	cred, err := os.Open(filepath.Join(created.Plan.RootDir, "workload", "private-senders", "recovery.raw"))
	if err != nil {
		t.Fatal(err)
	}
	defer cred.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, python, "-I", "-B", filepath.Join(tools, "scripts/loadtest/pq-owner-poison-go-integration.py"))
	command.ExtraFiles = []*os.File{cred}
	command.Env = append(os.Environ(), "YNX_POISON_GO_TEST_BINARY="+os.Args[0], "YNX_POISON_TEST_WORK="+t.TempDir(), "YNX_POISON_GO_ARGS="+string(encoded), "YNX_POISON_CHECKPOINT="+string(checkpoint))
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("actual Python/Go poisoned stream: %v: %s", err, output)
	}
	var report struct {
		OriginalReady, OriginalOwnerPrepared, OriginalLostReply, OriginalProcessReaped, GracefulEOF bool
		LateReplyRead, Replayed, PhysicalWipeProven                                                 bool
		ReturnCode                                                                                  int
	}
	if err = json.Unmarshal(output, &report); err != nil || !report.OriginalReady || !report.OriginalOwnerPrepared || !report.OriginalLostReply || !report.OriginalProcessReaped || !report.GracefulEOF || report.LateReplyRead || report.Replayed || report.PhysicalWipeProven || report.ReturnCode != 0 {
		t.Fatal("original retirement observation differs", err, string(output))
	}
	ownerDir := filepath.Join(created.Plan.RootDir, "workload", "sender-public", "0000")
	original := poisonOriginalSnapshot(t, ownerDir)
	// The exact previous process is gone; acquire only the original owner's lease
	// to prove it released custody. This opens no operation and sends no command.
	credential, err := os.ReadFile(filepath.Join(created.Plan.RootDir, "workload", "private-senders", "recovery.raw"))
	if err != nil {
		t.Fatal(err)
	}
	defer clear(credential)
	var pin string
	for i, arg := range args {
		if arg == "--workload-sha256" {
			pin = args[i+1]
		}
	}
	owner, err := consensus.OpenPQLabSender(filepath.Join(created.Plan.RootDir, "workload"), pin, 0, credential)
	if err != nil {
		t.Fatal("original owner lease was not released", err)
	}
	if err = owner.Close(); err != nil {
		t.Fatal(err)
	}
	for name, hash := range poisonOriginalSnapshot(t, ownerDir) {
		if original[name] != hash {
			t.Fatal("original operation changed during lease readback", name)
		}
	}
	t.Log("original Go sender EOF cleanup released its owner lease; physical memory wipe is not attested")
}
