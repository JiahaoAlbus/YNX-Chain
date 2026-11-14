//go:build unix

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func TestPQLabSenderPUBLICOwnersPreparedReady(t *testing.T) {
	args, created, height, hash := publicOwnerCommandArgs(t)
	args = append(args, "--ready", "--prepare-source")
	command := pqLabSenderCommand{Version: "YNX-PQ-LAB-SENDER-COMMAND/v1", Operation: "sign", Request: consensus.PQLabSenderRequest{Version: "YNX-PQ-LAB-SENDER-REQUEST/v1", OperationID: strings.Repeat("d", 64), OwnerIndex: 0, FirstNonce: 2, Members: 1}, CheckpointHeight: height, CheckpointAppHash: hash}
	var out bytes.Buffer
	if err := runPQLabPublicOwnersInput(context.Background(), args, bytes.NewReader(publicOwnerCommandWire(command)), &out); err != nil {
		t.Fatal(err)
	}
	lines := bytes.Split(bytes.TrimSpace(out.Bytes()), []byte{'\n'})
	if len(lines) != 2 {
		t.Fatal("exact ready and one normal command required", len(lines))
	}
	var ready struct {
		Version, Status                                                         string
		BootstrapLoaded, Signed, NonceReserved, SyntheticOnly, AuthorityGranted bool
		StartupElapsedNs                                                        int64
		PreparationTimings                                                      consensus.PQLabMetricsSnapshot
		Session                                                                 consensus.PQLabPublicOwnerSessionStats
	}
	if err := json.Unmarshal(lines[0], &ready); err != nil {
		t.Fatal(err)
	}
	stages := ready.PreparationTimings.Stages
	if ready.Version != "YNX-PQ-LAB-PUBLIC-OWNER-READY/v2" || ready.Status != "original_public_static_source_held" || !ready.BootstrapLoaded || ready.Signed || ready.NonceReserved || ready.AuthorityGranted || !ready.SyntheticOnly || ready.Session.OpenedOwners != 0 || ready.Session.Commands != 0 || ready.StartupElapsedNs <= 0 || stages["lab.bootstrapFullValidation"].Calls != 1 || stages["checkpoint.captureCurrentBytes"].Calls != 0 || stages["publicOwner.prepareSource"].Calls != 1 {
		t.Fatal("READY did not describe actual static-only preparation", ready)
	}
	t.Logf("PREPARED_READY_DATA %s", lines[0])
	var reply struct {
		Code    string
		Timings consensus.PQLabMetricsSnapshot
	}
	if err := json.Unmarshal(lines[1], &reply); err != nil {
		t.Fatal(err)
	}
	if reply.Code != "ORIGINAL_SAVED" || reply.Timings.Stages["lab.bootstrapFullValidation"].Calls != 0 || reply.Timings.Stages["checkpoint.captureCurrentBytes"].Calls != 12 {
		t.Fatal("normal command lost static reuse or dynamic reads", reply)
	}
	if _, err := os.Stat(filepath.Join(created.Plan.RootDir, "workload", "sender-public", "0000", command.Request.OperationID, "RESULT.json")); err != nil {
		t.Fatal(err)
	}
}

func TestPQLabSenderPUBLICOwnersPreparedReadyRefusals(t *testing.T) {
	args, created, _, _ := publicOwnerCommandArgs(t)
	invoke := func(argv []string, out *bytes.Buffer) error {
		return runPQLabPublicOwnersInput(context.Background(), argv, strings.NewReader(""), out)
	}
	var out bytes.Buffer
	if err := invoke(append(append([]string(nil), args...), "--prepare-source"), &out); err == nil || out.Len() != 0 {
		t.Fatal("silent preparation without READY accepted", err)
	}
	args = append(args, "--ready", "--prepare-source")
	migration := created.Plan.MigrationFile
	if err := os.Rename(migration, migration+".held"); err != nil {
		t.Fatal(err)
	}
	err := invoke(args, &out)
	restore := os.Rename(migration+".held", migration)
	if err == nil || out.Len() != 0 || restore != nil {
		t.Fatal("missing original emitted READY", err, restore)
	}
	// Failed READY output ends this process before reading any command. The
	// original material is reusable by a new normal scope; no intent was made.
	if err := runPQLabPublicOwnersInput(context.Background(), args, strings.NewReader("invalid command must not be read"), pqLabBrokenWorkloadOutput{}); err == nil {
		t.Fatal("lost READY acknowledgment hidden")
	}
	for _, owner := range []string{"0000", "0001"} {
		children, err := os.ReadDir(filepath.Join(created.Plan.RootDir, "workload", "sender-public", owner))
		if err != nil || len(children) != 0 {
			t.Fatal("read-only preparation created an operation", err, len(children))
		}
	}
	if err := invoke(args, &out); err != nil {
		t.Fatal("lost READY leaked held source", err)
	}
	if bytes.Count(out.Bytes(), []byte("original_public_static_source_held")) != 1 {
		t.Fatal("one real READY required")
	}
}
