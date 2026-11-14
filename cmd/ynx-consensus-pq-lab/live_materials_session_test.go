//go:build unix

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestPQLabLiveSessionCommandStrictInputs(t *testing.T) {
	for _, args := range [][]string{
		{}, {"--policy", "/missing", "--policy-sha256", strings.Repeat("a", 64)},
		{"--synthetic", "--policy", "/missing", "--policy-sha256", strings.Repeat("a", 64), "--ready"},
		{"--synthetic", "--policy", "/missing", "--policy", "/replacement"},
		{"--synthetic", "--now", "2030-01-01"}, {"--synthetic", "--trusted-block", "from-rpc"},
	} {
		var out bytes.Buffer
		if err := runPQLabLiveMaterialsSessionInput(context.Background(), args, strings.NewReader(""), &out); err == nil || out.Len() != 0 {
			t.Fatal("invalid normal lane emitted READY", args, err)
		}
	}
	if err := runPQLabLiveMaterialsSessionOwnedInput(nil, nil, io.NopCloser(strings.NewReader("")), io.Discard); err == nil {
		t.Fatal("missing owned context accepted")
	}
	// This uses the actual main dispatcher, not an unregistered helper.
	var dispatch bytes.Buffer
	if err := run([]string{"live-materials-session"}, &dispatch); err == nil || err.Error() != "explicit original live lane and command stream required" || dispatch.Len() != 0 {
		t.Fatal("original live session dispatcher is not registered", err)
	}
	var out bytes.Buffer
	if err := run([]string{"live-materials-session", "--synthetic", "--ready", "--policy", "/missing", "--policy-sha256", strings.Repeat("a", 64)}, &out); err == nil || out.Len() != 0 {
		t.Fatal("new normal dispatcher claimed missing source", err)
	}
}

func TestPQLabLiveSessionFailureProjection(t *testing.T) {
	private := errors.New("/private/original/source malformed secret-input-body")
	for _, item := range []struct {
		err  error
		want string
	}{
		{nil, ""}, {private, "REFUSED_OR_UNKNOWN"},
		{errors.Join(private, consensus.ErrPQLabLiveMaterialsBusy), "BUSY"},
		{fmt.Errorf("%w: %v", context.Canceled, private), "CONTEXT_ENDED"},
		{errors.Join(context.DeadlineExceeded, private), "CONTEXT_ENDED"},
	} {
		got := pqLabLiveFailureClass(item.err)
		if got != item.want || strings.Contains(got, "/private") || strings.Contains(got, "secret-input") {
			t.Fatal("private diagnostic leaked or refusal reclassified", got)
		}
	}
}

// The original normal-CI owning-source producer supplies this fixture. Missing
// input is a named opt-in skip, never qualification: its dedicated collector
// requires an actual unique RUN/PASS and rejects all nested skips.
func TestPQLabLiveSessionCommandOriginalSourceAndLostAck(t *testing.T) {
	root := os.Getenv("YNX_PQ_LAB_LIVE_FIXTURE_ROOT")
	if root == "" {
		t.Skip("explicit original synthetic live source fixture required; no Node is started")
	}
	setupRaw, err := os.ReadFile(filepath.Join(root, "live-command-input.json"))
	if err != nil {
		t.Fatal(err)
	}
	var setup consensus.PQLabLiveMaterialsSetup
	if err = json.Unmarshal(setupRaw, &setup); err != nil {
		t.Fatal(err)
	}
	args := []string{"--synthetic", "--policy", setup.Policy.Path, "--policy-sha256", setup.Policy.SHA256, "--ready", "--timings"}
	command := pqLabLiveMaterialsCommand{Version: "YNX-PQ-LAB-LIVE-MATERIALS-COMMAND/v1", Operation: "result", Sequence: 1}
	wire := func(commands ...pqLabLiveMaterialsCommand) []byte {
		var data bytes.Buffer
		for _, c := range commands {
			b, e := json.Marshal(c)
			if e != nil {
				t.Fatal(e)
			}
			data.Write(b)
			data.WriteByte('\n')
		}
		return data.Bytes()
	}
	var out bytes.Buffer
	if err = runPQLabLiveMaterialsSessionInput(context.Background(), args, bytes.NewReader(wire(command, command)), &out); err != nil {
		t.Fatal(err)
	}
	lines := bytes.Split(bytes.TrimSpace(out.Bytes()), []byte{'\n'})
	if len(lines) != 3 {
		t.Fatal("READY and two explicit reads required", len(lines))
	}
	var ready struct {
		Version, Status                          string
		PreparationTimings                       consensus.PQLabMetricsSnapshot
		Session                                  consensus.PQLabLiveMaterialsSessionStats
		CurrentCheckpointClaim, AuthorityGranted bool
	}
	if err = json.Unmarshal(lines[0], &ready); err != nil || ready.Version != "YNX-PQ-LAB-LIVE-MATERIALS-READY/v1" || ready.Status != "original_static_source_and_anchor_held" || ready.AuthorityGranted || ready.CurrentCheckpointClaim || ready.Session.Commands != 0 || ready.PreparationTimings.Stages["lab.bootstrapFullValidation"].Calls != 1 || ready.PreparationTimings.Stages["live.anchorFullValidation"].Calls != 1 {
		t.Fatal("READY not fully held static-only", err, ready)
	}
	t.Logf("LIVE_SESSION_READY_DATA %s", lines[0])
	want, err := consensus.ReadPQLabLiveMaterialsResult(setup.Policy.Path, setup.Policy.SHA256, 1)
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range lines[1:] {
		var reply struct {
			Outcome, FailureClass string
			FirstCausePresent     bool
			Result                consensus.PQLabLiveMaterialsResult
			Timings               consensus.PQLabMetricsSnapshot
		}
		if err = json.Unmarshal(line, &reply); err != nil || reply.Outcome != "original_result_read" || reply.FailureClass != "" || reply.FirstCausePresent || !reflect.DeepEqual(reply.Result, want) || reply.Timings.Stages["lab.bootstrapFullValidation"].Calls != 0 || reply.Timings.Stages["live.anchorFullValidation"].Calls != 0 {
			t.Fatal("actual normal original result changed", err)
		}
	}
	// Use a definitely absent, bounded slot, and provide a later valid command:
	// refusal must stop the stream after one safe diagnostic, with original error.
	missing := command
	missing.Sequence = ready.Session.MaxOperations + 1
	out.Reset()
	if err = runPQLabLiveMaterialsSessionInput(context.Background(), args, bytes.NewReader(wire(missing, command)), &out); err == nil {
		t.Fatal("refusal exited zero")
	}
	lines = bytes.Split(bytes.TrimSpace(out.Bytes()), []byte{'\n'})
	if len(lines) != 2 || bytes.Contains(lines[1], []byte(root)) || bytes.Contains(lines[1], []byte(`"failure":`)) {
		t.Fatal("refusal consumed next command or exposed private diagnostic", out.String())
	}
	var refusal struct {
		Outcome, FailureClass string
		FirstCausePresent     bool
	}
	if json.Unmarshal(lines[1], &refusal) != nil || refusal.Outcome != "REFUSED_OR_UNKNOWN_NO_RETRY" || refusal.FailureClass != "REFUSED_OR_UNKNOWN" || !refusal.FirstCausePresent {
		t.Fatal("refusal projection lost uncertainty")
	}
	if err = runPQLabLiveMaterialsSessionInput(context.Background(), args, bytes.NewReader(wire(command)), pqLabBrokenWorkloadOutput{}); err == nil {
		t.Fatal("lost READY ACK hidden")
	}
	// A new explicit reader can still inspect the very same durable result;
	// no original request, proof or debt is cleared by the failed writer.
	got, err := consensus.ReadPQLabLiveMaterialsResult(setup.Policy.Path, setup.Policy.SHA256, 1)
	if err != nil || !reflect.DeepEqual(want, got) {
		t.Fatal("lost ACK damaged original", err)
	}
	t.Log("LIVE_SESSION_CLI_ORIGINAL_DATA staticFullValidation=1 anchorFullValidation=1 explicitReads=2 steadyStaticAndAnchor=0 noNodeStart=true")
}
