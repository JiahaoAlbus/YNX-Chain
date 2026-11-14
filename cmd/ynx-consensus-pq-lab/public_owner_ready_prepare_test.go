//go:build unix

package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// Exercise the normal CLI as an interactive stream. The next command is not
// available to its scanner until the caller has received the preceding ACK.
// These are four ordinary PUBLIC application writers, not running nodes or a
// Wallet authority. The Sign callee still independently validates all states.
func TestPQLabSenderPUBLICOwnersPreparedReadyThenPrepareAndCurrentSign(t *testing.T) {
	args, created, _, _ := publicOwnerCommandArgs(t)
	args = append(args, "--ready", "--prepare-source")
	ctx, cancel := context.WithCancel(context.Background())
	input, commands := io.Pipe()
	responses, output := io.Pipe()
	done := make(chan error, 1)
	go func() {
		err := runPQLabPublicOwnersInput(ctx, args, input, output)
		_ = output.CloseWithError(err)
		done <- err
	}()
	joined := false
	t.Cleanup(func() {
		cancel()
		_ = commands.Close()
		_ = input.Close()
		_ = responses.Close()
		_ = output.Close()
		if !joined {
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Error("normal owner command did not join after closing its test pipes")
			}
		}
	})
	reader := bufio.NewReader(responses)
	read := func(value any) {
		t.Helper()
		raw, err := reader.ReadBytes('\n')
		if err != nil || json.Unmarshal(raw, value) != nil {
			t.Fatal("complete original CLI frame required", err, string(raw))
		}
		t.Logf("PUBLIC_PREPARED_OWNER_FRAME %s", bytes.TrimSuffix(raw, []byte{'\n'}))
	}
	send := func(command pqLabSenderCommand) {
		t.Helper()
		if _, err := commands.Write(publicOwnerCommandWire(command)); err != nil {
			t.Fatal(err)
		}
	}
	noOperations := func() {
		t.Helper()
		for _, owner := range []string{"0000", "0001"} {
			entries, err := os.ReadDir(filepath.Join(created.Plan.RootDir, "workload", "sender-public", owner))
			if err != nil || len(entries) != 0 {
				t.Fatal("pre-sign preparation or rejection created an operation", owner, err, len(entries))
			}
		}
	}
	var ready struct {
		Version, Status                                                         string
		BootstrapLoaded, Signed, NonceReserved, SyntheticOnly, AuthorityGranted bool
		PreparationTimings                                                      consensus.PQLabMetricsSnapshot
		Session                                                                 consensus.PQLabPublicOwnerSessionStats
	}
	read(&ready)
	if ready.Version != "YNX-PQ-LAB-PUBLIC-OWNER-READY/v2" || ready.Status != "original_public_static_source_held" || !ready.BootstrapLoaded || !ready.SyntheticOnly || ready.AuthorityGranted || ready.Signed || ready.NonceReserved || ready.Session.OpenedOwners != 0 || ready.Session.Commands != 0 || ready.PreparationTimings.Stages["lab.bootstrapFullValidation"].Calls != 1 || ready.PreparationTimings.Stages["checkpoint.captureCurrentBytes"].Calls != 0 {
		t.Fatal("READY v2 must hold only the original public static source", ready)
	}
	noOperations()
	prepare := pqLabSenderCommand{Version: "YNX-PQ-LAB-SENDER-COMMAND/v1", Operation: "prepare-owner", Request: consensus.PQLabSenderRequest{Version: "YNX-PQ-LAB-SENDER-REQUEST/v1", OwnerIndex: 0}}
	type reply struct {
		Version, Code, OperationID string
		OwnerIndex                 int
		Result                     json.RawMessage
		Failure                    *pqLabPublicOwnerFailureDiagnostic
		Timings                    consensus.PQLabMetricsSnapshot
		Session                    consensus.PQLabPublicOwnerSessionStats
	}
	send(prepare)
	var prepared reply
	read(&prepared)
	if prepared.Version != "YNX-PQ-LAB-PUBLIC-OWNER-REPLY/v1" || prepared.Code != "OWNER_PREPARED" || prepared.OwnerIndex != 0 || prepared.OperationID != "" || !bytes.Equal(prepared.Result, []byte("null")) || prepared.Failure != nil || prepared.Session.OpenedOwners != 1 || prepared.Session.Commands != 1 || prepared.Timings.Stages["sender.importFullPrivatePublicPair"].Calls != 1 || prepared.Timings.Stages["checkpoint.loadTotal"].Calls != 0 || prepared.Timings.Stages["checkpoint.captureCurrentBytes"].Calls != 0 || prepared.Timings.Stages["sender.dualSignEncodeAndSelfVerify"].Calls != 0 {
		t.Fatal("prepare ACK must import only the selected owner without choosing a checkpoint", prepared)
	}
	noOperations()

	// Sample only now, after the actual prepare ACK; do not reuse the fixture's
	// returned coordinates or let READY/prepare invent the caller's checkpoint.
	if len(created.Plan.Nodes) != 4 {
		t.Fatal("four original application states required")
	}
	var height int64
	var appHash string
	for _, node := range created.Plan.Nodes {
		raw, err := os.ReadFile(node.StatePath)
		var state consensus.CommittedState
		if err != nil || json.Unmarshal(raw, &state) != nil || !state.Initialized || state.Height < 1 || len(state.AppHash) != 64 || state.MigrationStateHash != created.Plan.MigrationStateHash {
			t.Fatal("original committed checkpoint sample", err)
		}
		if height != 0 && (height != state.Height || appHash != state.AppHash) {
			t.Fatal("four independently read original checkpoints differ")
		}
		height, appHash = state.Height, state.AppHash
	}
	command := pqLabSenderCommand{Version: prepare.Version, Operation: "sign", Request: consensus.PQLabSenderRequest{Version: prepare.Request.Version, OperationID: strings.Repeat("7", 64), OwnerIndex: 0, FirstNonce: 2, Members: 1}, CheckpointHeight: height, CheckpointAppHash: appHash}
	wrong := command
	wrong.Request.OperationID = strings.Repeat("8", 64)
	wrong.CheckpointAppHash = strings.Repeat("0", 64)
	if wrong.CheckpointAppHash == appHash {
		t.Fatal("negative checkpoint must actually differ")
	}
	send(wrong)
	var rejected reply
	read(&rejected)
	if rejected.Code != "REJECTED" || rejected.OperationID != wrong.Request.OperationID || rejected.OwnerIndex != 0 || rejected.Failure == nil || !rejected.Failure.FirstCausePresent || rejected.Timings.Stages["sender.dualSignEncodeAndSelfVerify"].Calls != 0 || rejected.Timings.Stages["sender.importFullPrivatePublicPair"].Calls != 0 || rejected.Session.Commands != 2 {
		t.Fatal("prepared owner accepted a different checkpoint or hid the first failure", rejected)
	}
	noOperations()

	// A distinct original request uses the observed checkpoint, not a retry of
	// an UNKNOWN operation. The failed request above never acquired an intent.
	send(command)
	var saved reply
	read(&saved)
	var result consensus.PQLabSenderResult
	if err := json.Unmarshal(saved.Result, &result); err != nil {
		t.Fatal(err)
	}
	if saved.Code != "ORIGINAL_SAVED" || saved.OperationID != command.Request.OperationID || saved.OwnerIndex != 0 || saved.Failure != nil || saved.Session.OpenedOwners != 1 || saved.Session.Commands != 3 || result.OperationID != command.Request.OperationID || result.OwnerIndex != 0 || result.CheckpointHeight != height || result.CheckpointAppHash != appHash || result.AuthorityGranted || !result.SyntheticOnly || result.Transaction.FirstNonce != "2" || result.Transaction.Members != "1" || saved.Timings.Stages["lab.bootstrapFullValidation"].Calls != 0 || saved.Timings.Stages["sender.importFullPrivatePublicPair"].Calls != 0 || saved.Timings.Stages["checkpoint.captureCurrentBytes"].Calls != 12 || saved.Timings.Stages["sender.dualSignEncodeAndSelfVerify"].Calls != 1 {
		t.Fatal("prepared normal sign lost original request, static reuse or fresh checks", saved, result)
	}
	if err := commands.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := reader.ReadByte(); err != io.EOF {
		t.Fatal("unexpected extra CLI response or close failure", err)
	}
	if err := <-done; err != nil {
		t.Fatal("normal EOF did not release source and owner", err)
	}
	joined = true
	for _, name := range []string{"request.json", "INTENT.json", "transaction.wire", "transaction.abci", "RESULT.json"} {
		if _, err := os.Stat(filepath.Join(created.Plan.RootDir, "workload", "sender-public", "0000", command.Request.OperationID, name)); err != nil {
			t.Fatal("normal EOF lost a durable original", name, err)
		}
	}
}
