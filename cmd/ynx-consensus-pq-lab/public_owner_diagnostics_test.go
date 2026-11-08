//go:build unix

package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// PUBLIC scope-only fixture. There is deliberately no owner key, policy,
// genesis, vault or ledger. It exercises genuine admission refusal and an
// unopened owner's retirement; it cannot import a key or sign any operation.
func publicOwnerDiagnosticScope(t *testing.T) ([]string, string) {
	t.Helper()
	root, e := filepath.EvalSymlinks(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	if e = os.Chmod(root, 0700); e != nil {
		t.Fatal(e)
	}
	if e = os.MkdirAll(filepath.Join(root, "workload", "private-senders"), 0700); e != nil {
		t.Fatal(e)
	}
	write := func(name string, value any) string {
		t.Helper()
		raw, e := json.Marshal(value)
		if e != nil {
			t.Fatal(e)
		}
		if e = os.WriteFile(filepath.Join(root, name), raw, 0600); e != nil {
			t.Fatal(e)
		}
		sum := sha256.Sum256(raw)
		return hex.EncodeToString(sum[:])
	}
	plan := consensus.PQLabNetworkPlan{Version: "PUBLIC-REJECTION-FIXTURE", RootDir: root, SyntheticOnly: true, NativeChainID: consensus.PQLabNativeChainID, OriginalGenesisHash: strings.Repeat("1", 64), MigrationStateHash: strings.Repeat("2", 64)}
	pin := write("network-plan.json", plan)
	manifest := consensus.PQLabWorkloadManifest{Version: consensus.PQLabWorkloadVersion, SyntheticOnly: true, Mode: "online", NativeChainID: "642399", OriginalGenesisHash: plan.OriginalGenesisHash, MigrationStateHash: plan.MigrationStateHash, Owners: []consensus.PQLabWorkloadOwner{{Index: 0, MemberCapacity: "1"}}}
	workload := write("workload/PUBLIC-WORKLOAD.json", manifest)
	// This known zero-filled test-only input is never a generated key/credential
	// for any real vault. No valid encrypted material exists in this fixture.
	path := filepath.Join(root, "workload", "private-senders", "recovery.raw")
	if e = os.WriteFile(path, make([]byte, 32), 0600); e != nil {
		t.Fatal(e)
	}
	fd, e := os.Open(path)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = fd.Close() })
	return []string{"--synthetic", "--root", root, "--plan-sha256", pin, "--workload-sha256", workload, "--owners", "0", "--credential-fd", strconv.Itoa(int(fd.Fd())), "--timings"}, root
}

func TestPQLabPublicOwnerFailureDiagnosticActualRejection(t *testing.T) {
	args, root := publicOwnerDiagnosticScope(t)
	request := consensus.PQLabSenderRequest{Version: "YNX-PQ-LAB-SENDER-REQUEST/v1", OwnerIndex: 1, OperationID: strings.Repeat("a", 64), FirstNonce: 1, Members: 1}
	sign := pqLabSenderCommand{Version: "YNX-PQ-LAB-SENDER-COMMAND/v1", Operation: "sign", Request: request, CheckpointHeight: 1, CheckpointAppHash: strings.Repeat("3", 64)}
	recover := sign
	recover.Operation = "recover"
	recover.CheckpointHeight = 0
	recover.CheckpointAppHash = ""
	close := pqLabSenderCommand{Version: sign.Version, Operation: "close-owner", Request: consensus.PQLabSenderRequest{Version: request.Version, OwnerIndex: 0}}
	confirm := recover
	confirm.Operation = "confirm"
	confirm.MaterialsFile = filepath.Join(root, "private-senders", "forbidden-public-proof")
	confirm.ProofFile = confirm.MaterialsFile
	var out bytes.Buffer
	if e := runPQLabPublicOwnersInput(context.Background(), args, bytes.NewReader(publicOwnerCommandWire(sign, recover, close, close, confirm)), &out); e != nil {
		t.Fatal("actual rejection stream failed before reply", e)
	}
	if bytes.Contains(out.Bytes(), []byte(root)) || bytes.Contains(out.Bytes(), []byte("forbidden-public-proof")) || bytes.Contains(out.Bytes(), []byte("original owner or bounded command budget refused")) {
		t.Fatal("reply exposed path or raw cause")
	}
	rows := bytes.Split(bytes.TrimSpace(out.Bytes()), []byte{'\n'})
	if len(rows) != 5 {
		t.Fatal("lost synchronous reply denominator")
	}
	for i, line := range rows {
		var reply struct {
			Version, Code string
			Result        json.RawMessage
			Failure       *struct {
				Version, ErrorClass, FailurePhase string
				FirstCausePresent                 bool
			}
			Session consensus.PQLabPublicOwnerSessionStats
		}
		if json.Unmarshal(line, &reply) != nil {
			t.Fatal("reply encoding")
		}
		if reply.Version != "YNX-PQ-LAB-PUBLIC-OWNER-REPLY/v1" || reply.Session.OpenedOwners != 0 || reply.Session.SourceInputs.State != "NOT_LOADED" {
			t.Fatal("diagnostic changed original scope or performed private/cold work")
		}
		if i == 2 {
			if reply.Code != "OWNER_RETIRED" || reply.Failure != nil {
				t.Fatal("successful unopened-owner retirement changed")
			}
			continue
		}
		if reply.Code != "REJECTED" || !bytes.Equal(reply.Result, []byte("null")) {
			t.Fatal("rejection changed")
		}
		if reply.Failure == nil || reply.Failure.Version != "YNX-PQ-LAB-PUBLIC-OWNER-FAILURE/v1" || !reply.Failure.FirstCausePresent || reply.Failure.ErrorClass == "" || reply.Failure.FailurePhase == "" {
			t.Fatal("PUBLIC_OWNER_DIAGNOSTIC_MISSING: real rejected callee error was discarded")
		}
		wantPhase := []string{"SIGN", "RECOVER", "", "CLOSE_OWNER", "CONFIRM_MATERIALS"}[i]
		wantClass := []string{"OWNER_SCOPE_REJECTED", "OWNER_SCOPE_REJECTED", "", "OWNER_RETIRED", "PUBLIC_INPUT_REJECTED"}[i]
		if reply.Failure.FailurePhase != wantPhase || reply.Failure.ErrorClass != wantClass {
			t.Fatal("actual callee diagnostic lost its closed phase/class")
		}
	}
	// No sender lease, intent, outbox, transaction or history was created.
	entries, e := os.ReadDir(filepath.Join(root, "workload"))
	if e != nil || len(entries) != 2 {
		t.Fatal("diagnostic refusal created operation state")
	}
	private, e := os.ReadDir(filepath.Join(root, "workload", "private-senders"))
	if e != nil || len(private) != 1 || private[0].Name() != "recovery.raw" {
		t.Fatal("diagnostic imported or created private material")
	}
}

func TestPQLabPublicOwnerFailureDiagnosticClosedVocabulary(t *testing.T) {
	const sensitive = "DO-NOT-EMIT-test-marker/private-senders/credentials"
	cases := []struct {
		name, class string
		err         error
	}{
		{"unknown", "ORIGINAL_UNKNOWN", consensus.ErrPQLabSenderUnknown},
		{"wrapped-unknown", "ORIGINAL_UNKNOWN", fmt.Errorf("%s: %w", sensitive, consensus.ErrPQLabSenderUnknown)},
		{"joined-unknown-first", "ORIGINAL_UNKNOWN", errors.Join(consensus.ErrPQLabSenderUnknown, context.Canceled)},
		{"joined-unknown-last", "ORIGINAL_UNKNOWN", errors.Join(context.DeadlineExceeded, consensus.ErrPQLabSenderUnknown)},
		{"unknown-lookalike", "OPERATION_REJECTED", errors.New(consensus.ErrPQLabSenderUnknown.Error())},
		{"busy", "OWNER_BUSY", consensus.ErrPQLabPublicOwnerBusy},
		{"cancel", "CONTEXT_CANCELED", fmt.Errorf("%s: %w", sensitive, context.Canceled)},
		{"deadline", "DEADLINE_EXCEEDED", context.DeadlineExceeded},
		{"not-found", "NOT_FOUND", &os.PathError{Op: "open", Path: sensitive, Err: os.ErrNotExist}},
		{"permission", "PERMISSION_DENIED", &os.PathError{Op: "read", Path: sensitive, Err: os.ErrPermission}},
		{"exists", "ALREADY_EXISTS", &os.PathError{Op: "create", Path: sensitive, Err: os.ErrExist}},
		{"io-path", "IO_FAILURE", &os.PathError{Op: "read", Path: sensitive, Err: errors.New(sensitive)}},
		{"io-eof", "IO_FAILURE", io.EOF},
		{"io-unexpected", "IO_FAILURE", io.ErrUnexpectedEOF},
		{"io-short-write", "IO_FAILURE", io.ErrShortWrite},
		{"proof", "PROOF_REJECTED", &consensus.PQLightProofError{Code: sensitive, Detail: sensitive}},
		{"scope", "OWNER_SCOPE_REJECTED", errors.New("original owner or bounded command budget refused")},
		{"retired", "OWNER_RETIRED", errors.New("original owner retired")},
		{"checkpoint", "CHECKPOINT_REJECTED", errors.New("actual four-node checkpoint differs from independently supplied H/AppHash")},
		{"source", "SOURCE_CHANGED", errors.New("committed source changed during read")},
		{"nonce", "NONCE_OR_BALANCE_REJECTED", errors.New("actual owner nonce or balance differs from original request")},
		{"conflict", "REQUEST_CONFLICT", errors.New("operation id already belongs to different exact request")},
		{"input", "PUBLIC_INPUT_REJECTED", errors.New("canonical 32-byte operation id required")},
		{"literal-with-suffix", "OPERATION_REJECTED", errors.New("original owner retired: " + sensitive)},
		{"unknown-cause", "OPERATION_REJECTED", errors.New(sensitive)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			result := &struct{ Value string }{Value: sensitive}
			code, got, diagnostic := pqLabPublicOwnerOutcome("sign", pqLabPublicOwnerSign, result, tc.err)
			wantCode := "REJECTED"
			if errors.Is(tc.err, consensus.ErrPQLabSenderUnknown) {
				wantCode = "UNKNOWN"
			}
			if code != wantCode || got != nil || diagnostic == nil || diagnostic.ErrorClass != tc.class || !diagnostic.FirstCausePresent || diagnostic.FailurePhase != "SIGN" {
				t.Fatal("original error state or safe diagnostic differs")
			}
			raw, e := json.Marshal(diagnostic)
			if e != nil || len(raw) > 256 || bytes.Contains(raw, []byte(sensitive)) || bytes.Contains(raw, []byte(tc.err.Error())) {
				t.Fatal("diagnostic emitted unbounded/raw error data")
			}
			var fields map[string]json.RawMessage
			if json.Unmarshal(raw, &fields) != nil || len(fields) != 4 || string(fields["version"]) != `"YNX-PQ-LAB-PUBLIC-OWNER-FAILURE/v1"` || string(fields["firstCausePresent"]) != "true" || len(fields["errorClass"]) == 0 || len(fields["failurePhase"]) == 0 {
				t.Fatal("diagnostic schema is not the closed four-field v1 shape")
			}
		})
	}
	t.Run("success-unchanged", func(t *testing.T) {
		for operation, want := range map[string]string{"sign": "ORIGINAL_SAVED", "recover": "ORIGINAL_RECOVERED", "close-owner": "OWNER_RETIRED", "confirm": "PROOF_CONFIRMED_DATA"} {
			result := &struct{}{}
			code, got, diagnostic := pqLabPublicOwnerOutcome(operation, 0, result, nil)
			if code != want || got != result || diagnostic != nil {
				t.Fatal("successful operation changed or acquired a failure")
			}
		}
	})
	t.Run("phase-is-not-caller-text", func(t *testing.T) {
		for phase, want := range map[pqLabPublicOwnerFailurePhase]string{0: "UNSPECIFIED", pqLabPublicOwnerSign: "SIGN", pqLabPublicOwnerRecover: "RECOVER", pqLabPublicOwnerClose: "CLOSE_OWNER", pqLabPublicOwnerConfirmMaterials: "CONFIRM_MATERIALS", pqLabPublicOwnerConfirm: "CONFIRM", 255: "UNSPECIFIED"} {
			_, _, diagnostic := pqLabPublicOwnerOutcome(sensitive, phase, nil, errors.New(sensitive))
			if diagnostic.FailurePhase != want {
				t.Fatal("phase is not a fixed internal enum")
			}
		}
	})
}
