//go:build unix

package consensus

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
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

// Test-only JSONL wrapper uses the actual session, owner key import, sign,
// lease and Close APIs. It is not the production CLI framing implementation.
func TestPQLabExperimentalPoisonCacheGoHelper(t *testing.T) {
	if os.Getenv("YNX_POISON_GO_CHILD") != "1" {
		t.Skip("subprocess helper only; not standalone validation")
	}
	var opts PQLabPublicOwnerSessionOptions
	if err := json.Unmarshal([]byte(os.Getenv("YNX_OWNER_SESSION_OPTIONS")), &opts); err != nil {
		t.Fatal(err)
	}
	input := os.NewFile(3, "inherited-synthetic-credential")
	credential, err := io.ReadAll(input)
	if err != nil {
		t.Fatal(err)
	}
	defer clear(credential)
	s, err := OpenPQLabPublicOwnerSession(context.Background(), opts, credential, nil)
	if err != nil {
		t.Fatal(err)
	}
	cache := &pqLabExperimentalKDFCache{}
	s.experimentalKDFCache = cache
	var keyRef []byte
	defer func() {
		if e := s.Close(); e != nil {
			t.Error(e)
		}
		cleared := len(keyRef) == 32
		for _, v := range keyRef {
			if v != 0 {
				cleared = false
			}
		}
		marker := map[string]any{"retired": s.retired.Load(), "closed": s.closed, "cacheSealed": cache.sealed, "keySliceCleared": cleared}
		data, e := json.Marshal(marker)
		if e != nil {
			t.Error(e)
			return
		}
		if e = os.WriteFile(os.Getenv("YNX_OWNER_CLOSE_MARKER"), data, 0600); e != nil {
			t.Error(e)
		}
	}()
	ready := map[string]any{"version": "YNX-PQ-LAB-PUBLIC-OWNER-READY/v1", "status": "original_public_scope_held", "owners": []int{0, 1}, "startupElapsedNs": 1, "signed": false, "nonceReserved": false, "bootstrapLoaded": false, "syntheticOnly": true, "authorityGranted": false}
	encoder := json.NewEncoder(os.Stdout)
	if err = encoder.Encode(ready); err != nil {
		t.Fatal(err)
	}
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var cmd struct {
			Operation         string             `json:"operation"`
			Request           PQLabSenderRequest `json:"request"`
			CheckpointHeight  string             `json:"checkpointHeight"`
			CheckpointAppHash string             `json:"checkpointAppHash"`
		}
		if e := json.Unmarshal(scanner.Bytes(), &cmd); e != nil {
			t.Fatal(e)
		}
		code := "UNKNOWN"
		var result any
		switch cmd.Operation {
		case "prepare-owner":
			if e := s.PrepareOwner(context.Background(), cmd.Request.OwnerIndex, nil); e != nil {
				t.Fatal(e)
			}
			keyRef = cache.key
			code = "OWNER_PREPARED"
		case "sign":
			h, e := strconv.ParseInt(cmd.CheckpointHeight, 10, 64)
			if e != nil {
				t.Fatal(e)
			}
			result, e = s.Sign(context.Background(), cmd.Request, h, cmd.CheckpointAppHash, nil)
			if e != nil {
				t.Fatal(e)
			}
			code = "ORIGINAL_SAVED"
		default:
			t.Fatal("unexpected command")
		}
		if e := encoder.Encode(map[string]any{"version": "YNX-PQ-LAB-PUBLIC-OWNER-REPLY/v1", "ownerIndex": cmd.Request.OwnerIndex, "operationId": cmd.Request.OperationID, "code": code, "result": result}); e != nil {
			t.Fatal(e)
		}
	}
	if err = scanner.Err(); err != nil {
		t.Fatal(err)
	}
}

func TestPQLabExperimentalPythonPoisonWipesActualSessionCache(t *testing.T) {
	tools, python := os.Getenv("YNX_POISON_TOOLS"), os.Getenv("YNX_POISON_PYTHON")
	if tools == "" || python == "" {
		t.Skip("explicit isolated Python/Tools candidate paths required")
	}
	plan, opts, credential := publicOwnerSessionFixture(t)
	state := publicOwnerState(t, plan)
	data, _ := json.Marshal(opts)
	checkpoint, _ := json.Marshal(map[string]any{"height": state.Height, "appHash": state.AppHash})
	cred, err := os.Open(filepath.Join(plan.RootDir, "workload", "private-senders", "recovery.raw"))
	if err != nil {
		t.Fatal(err)
	}
	defer cred.Close()
	marker := filepath.Join(t.TempDir(), "normal-close-marker.json")
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, python, "-I", "-B", filepath.Join(tools, "scripts/loadtest/pq-owner-poison-go-integration.py"))
	command.ExtraFiles = []*os.File{cred}
	command.Env = append(os.Environ(), "YNX_POISON_GO_TEST_BINARY="+os.Args[0], "YNX_POISON_GO_HELPER_TEST=TestPQLabExperimentalPoisonCacheGoHelper", "YNX_POISON_TEST_WORK="+t.TempDir(), "YNX_OWNER_SESSION_OPTIONS="+string(data), "YNX_OWNER_CLOSE_MARKER="+marker, "YNX_POISON_CHECKPOINT="+string(checkpoint))
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("actual Python + synthetic Go session: %v: %s", err, output)
	}
	var report map[string]any
	if err = json.Unmarshal(output, &report); err != nil || report["originalProcessReaped"] != true || report["gracefulEOF"] != true || report["replayed"] != false {
		t.Fatal("original retirement differs", err, string(output))
	}
	raw, err := os.ReadFile(marker)
	if err != nil {
		t.Fatal("session did not emit test-only close marker", err)
	}
	var observed map[string]bool
	if err = json.Unmarshal(raw, &observed); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"retired", "closed", "cacheSealed", "keySliceCleared"} {
		if !observed[k] {
			t.Fatal("test-only normal Close did not clear exact key slice", k)
		}
	}
	ownerDir := filepath.Join(plan.RootDir, "workload", "sender-public", "0000")
	original := poisonOriginalSnapshot(t, ownerDir)
	// Reopen only the original owner lease; no resend or fabricated confirmation.
	sender, err := OpenPQLabSender(filepath.Join(plan.RootDir, "workload"), opts.WorkloadSHA256, 0, credential)
	if err != nil {
		t.Fatal(err)
	}
	if err = sender.Close(); err != nil {
		t.Fatal(err)
	}
	for name, hash := range poisonOriginalSnapshot(t, ownerDir) {
		if original[name] != hash {
			t.Fatal("original operation changed during lease readback", name)
		}
	}
	t.Log("actual synthetic Go session Close cleared retained key slice and released owner lease; cipher/runtime copies are not attested")
}
