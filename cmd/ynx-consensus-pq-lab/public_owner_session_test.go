//go:build unix

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func publicOwnerCommandArgs(t *testing.T) ([]string, createResult, int64, string) {
	t.Helper()
	created, pin, height, hash := pqLabSenderCommandFixture(t, true)
	file, err := os.Open(filepath.Join(created.Plan.RootDir, "workload", "private-senders", "recovery.raw"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { file.Close() })
	return []string{"--synthetic", "--root", created.Plan.RootDir, "--plan-sha256", created.PlanSHA256, "--workload-sha256", pin, "--owners", "0,1", "--credential-fd", strconv.Itoa(int(file.Fd())), "--timings"}, created, height, hash
}

func publicOwnerCommandWire(commands ...pqLabSenderCommand) []byte {
	var b bytes.Buffer
	for _, c := range commands {
		raw, _ := json.Marshal(c)
		b.Write(raw)
		b.WriteByte('\n')
	}
	return b.Bytes()
}

func TestPQLabSenderPUBLICOwnersOriginalStream(t *testing.T) {
	args, created, height, hash := publicOwnerCommandArgs(t)
	args = append(args, "--ready")
	a := pqLabSenderCommand{Version: "YNX-PQ-LAB-SENDER-COMMAND/v1", Operation: "sign", Request: consensus.PQLabSenderRequest{Version: "YNX-PQ-LAB-SENDER-REQUEST/v1", OperationID: strings.Repeat("a", 64), OwnerIndex: 0, FirstNonce: 2, Members: 1}, CheckpointHeight: height, CheckpointAppHash: hash}
	unknown := a
	unknown.Request.OperationID = strings.Repeat("c", 64)
	retire := pqLabSenderCommand{Version: a.Version, Operation: "close-owner", Request: consensus.PQLabSenderRequest{Version: a.Request.Version, OwnerIndex: 0}}
	b := a
	b.Request.OwnerIndex = 1
	recover := b
	recover.Operation = "recover"
	recover.CheckpointHeight = 0
	recover.CheckpointAppHash = ""
	wrong := b
	wrong.Request.OwnerIndex = 2
	var out bytes.Buffer
	if err := runPQLabPublicOwnersInput(context.Background(), args, bytes.NewReader(publicOwnerCommandWire(a, unknown, retire, b, recover, wrong)), &out); err != nil {
		t.Fatal(err)
	}
	originalStream := bytes.Clone(out.Bytes())
	lines := bytes.Split(bytes.TrimSpace(originalStream), []byte{'\n'})
	if len(lines) != 7 {
		t.Fatal("actual command denominator lost", len(lines))
	}
	var ready struct {
		Version                                                  string
		Signed, NonceReserved, BootstrapLoaded, AuthorityGranted bool
		SyntheticOnly                                            bool
		Owners                                                   []int
	}
	if e := json.Unmarshal(lines[0], &ready); e != nil || ready.Version != "YNX-PQ-LAB-PUBLIC-OWNER-READY/v1" || ready.Signed || ready.NonceReserved || ready.BootstrapLoaded || ready.AuthorityGranted || !ready.SyntheticOnly || len(ready.Owners) != 2 {
		t.Fatal("normal READY preloaded authority or changed original owners", e)
	}
	lines = lines[1:]
	codes := []string{"ORIGINAL_SAVED", "UNKNOWN", "OWNER_RETIRED", "ORIGINAL_SAVED", "ORIGINAL_RECOVERED", "REJECTED"}
	for i, line := range lines {
		var reply struct {
			Version, Code string
			OwnerIndex    int
			Timings       consensus.PQLabMetricsSnapshot
			Session       consensus.PQLabPublicOwnerSessionStats
			Result        consensus.PQLabSenderResult
		}
		if err := json.Unmarshal(line, &reply); err != nil || reply.Code != codes[i] || reply.Version != "YNX-PQ-LAB-PUBLIC-OWNER-REPLY/v1" {
			t.Fatal("normal owner reply", i, err, string(line))
		}
		if i == 0 && reply.Timings.Stages["lab.bootstrapFullValidation"].Calls != 1 {
			t.Fatal("first cold work hidden")
		}
		if i == 3 && (reply.Timings.Stages["lab.bootstrapFullValidation"].Calls != 0 || reply.Timings.Stages["checkpoint.captureCurrentBytes"].Calls != 12 || reply.Session.OpenedOwners != 2 || reply.Session.StaticCache.Misses != 1) {
			t.Fatal("owner B lost shared public witness/fresh current", reply)
		}
		if reply.Result.AuthorityGranted {
			t.Fatal("lab caller granted authority")
		}
	}
	// EOF releases only this process's held keys and writer leases; originals
	// remain independently readable through the old one-owner normal entry.
	one := append([]string(nil), args...)
	for i := range one {
		if one[i] == "--owners" {
			one[i] = "--owner"
			one[i+1] = "1"
		}
	}
	out.Reset()
	if err := runPQLabSenderInput(one, bytes.NewReader(publicOwnerCommandWire(recover)), &out); err != nil || !bytes.Contains(out.Bytes(), []byte("ORIGINAL_RECOVERED")) {
		t.Fatal("EOF lost original or retained owner lease", err)
	}
	for _, owner := range []string{"0000", "0001"} {
		if _, err := os.Stat(filepath.Join(created.Plan.RootDir, "workload", "sender-public", owner, a.Request.OperationID, "transaction.abci")); err != nil {
			t.Fatal("owner close deleted original", err)
		}
	}
	if output := os.Getenv("YNX_PQLAB_PUBLIC_OWNER_STREAM_OUT"); output != "" {
		parent, e := filepath.EvalSymlinks(filepath.Dir(output))
		if e != nil || !filepath.IsAbs(output) || filepath.Clean(output) != output || parent != filepath.Dir(output) || bytes.Contains(originalStream, []byte(created.Plan.RootDir)) || bytes.Contains(originalStream, []byte("private-senders")) {
			t.Fatal("fresh public-only stream output required", e)
		}
		file, e := os.OpenFile(output, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e != nil {
			t.Fatal(e)
		}
		_, writeErr := file.Write(originalStream)
		syncErr, closeErr := file.Sync(), file.Close()
		if writeErr != nil || syncErr != nil || closeErr != nil {
			t.Fatal("public stream publication preserved incomplete output", writeErr, syncErr, closeErr)
		}
	}
}

func TestPQLabSenderPUBLICOwnersBoundedFramingAndLostAck(t *testing.T) {
	for _, input := range []string{"", "0,0", "1,0", "-1", "1000", "00", "0,", "0, 1"} {
		if _, err := pqLabPublicOwners(input); err == nil {
			t.Fatal("invalid startup owner set", input)
		}
	}
	var full []string
	for i := 0; i < consensus.MaxPQLabOwners; i++ {
		full = append(full, strconv.Itoa(i))
	}
	if owners, err := pqLabPublicOwners(strings.Join(full, ",")); err != nil || len(owners) != 1000 {
		t.Fatal("full declared owner set artificially capped", err)
	}
	args, created, height, hash := publicOwnerCommandArgs(t)
	command := pqLabSenderCommand{Version: "YNX-PQ-LAB-SENDER-COMMAND/v1", Operation: "sign", Request: consensus.PQLabSenderRequest{Version: "YNX-PQ-LAB-SENDER-REQUEST/v1", OperationID: strings.Repeat("f", 64), OwnerIndex: 1, FirstNonce: 2, Members: 1}, CheckpointHeight: height, CheckpointAppHash: hash}
	raw := bytes.TrimSpace(publicOwnerCommandWire(command))
	for name, bad := range map[string][]byte{
		"duplicate-owner":     bytes.Replace(raw, []byte(`"ownerIndex":1`), []byte(`"ownerIndex":0,"ownerIndex":1`), 1),
		"duplicate-operation": bytes.Replace(raw, []byte(`"operation":"sign"`), []byte(`"operation":"recover","operation":"sign"`), 1),
		"unknown-field":       append(append([]byte(nil), raw[:len(raw)-1]...), []byte(`,"extra":0}`)...),
		"trailing-json":       append(append([]byte(nil), raw...), []byte(`{}`)...),
		"line-bound":          bytes.Repeat([]byte(" "), (32<<10)+1),
	} {
		t.Run(name, func(t *testing.T) {
			var out bytes.Buffer
			if err := runPQLabPublicOwnersInput(context.Background(), args, bytes.NewReader(bad), &out); err == nil || out.Len() != 0 {
				t.Fatal("malformed command reached effect", err)
			}
		})
	}
	operation := filepath.Join(created.Plan.RootDir, "workload", "sender-public", "0001", command.Request.OperationID)
	if _, err := os.Stat(operation); !os.IsNotExist(err) {
		t.Fatal("invalid command opened an operation")
	}
	if err := runPQLabPublicOwnersInput(context.Background(), args, bytes.NewReader(raw), pqLabBrokenWorkloadOutput{}); err == nil {
		t.Fatal("lost acknowledgement hidden")
	}
	original, err := os.ReadFile(filepath.Join(operation, "transaction.abci"))
	if err != nil {
		t.Fatal(err)
	}
	command.Operation = "recover"
	command.CheckpointHeight = 0
	command.CheckpointAppHash = ""
	var out bytes.Buffer
	if err = runPQLabPublicOwnersInput(context.Background(), args, bytes.NewReader(publicOwnerCommandWire(command)), &out); err != nil || !bytes.Contains(out.Bytes(), []byte("ORIGINAL_RECOVERED")) {
		t.Fatal("cold original lost ACK recovery", err)
	}
	after, err := os.ReadFile(filepath.Join(operation, "transaction.abci"))
	if err != nil || !bytes.Equal(original, after) {
		t.Fatal("recovery re-signed or rewrote original", err)
	}
	t.Run("owned-partial-input-cancel-drains", func(t *testing.T) {
		reader, writer := io.Pipe()
		defer reader.Close()
		defer writer.Close()
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		finished := make(chan error, 1)
		go func() { finished <- runPQLabPublicOwnersOwnedInput(ctx, args, reader, io.Discard) }()
		// Pipe.Write only completes once the real normal Scanner consumes this
		// incomplete line. No EOF or productive command is supplied.
		written := make(chan error, 1)
		go func() { _, e := writer.Write([]byte(`{"version":`)); written <- e }()
		select {
		case e := <-written:
			if e != nil {
				t.Fatal(e)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("normal owned input did not enter partial read")
		}
		cancel()
		select {
		case e := <-finished:
			if e == nil {
				t.Fatal("canceled partial command reported success")
			}
		case <-time.After(5 * time.Second):
			t.Fatal("owned input cancellation retained worker/session")
		}
		// New scope can acquire the original owner lease and recover exactly
		// the preexisting durable operation after physical stream shutdown.
		var recovered bytes.Buffer
		if e := runPQLabPublicOwnersInput(context.Background(), args, bytes.NewReader(publicOwnerCommandWire(command)), &recovered); e != nil || !bytes.Contains(recovered.Bytes(), []byte("ORIGINAL_RECOVERED")) {
			t.Fatal("canceled command stream retained custody or lost original", e)
		}
	})
}
