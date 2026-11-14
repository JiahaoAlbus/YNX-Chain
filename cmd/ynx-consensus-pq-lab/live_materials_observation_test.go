//go:build unix

package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func publicRequestObservationFile(t *testing.T) *os.File {
	t.Helper()
	file, err := os.OpenFile(filepath.Join(t.TempDir(), "PUBLIC-observation.jsonl"), os.O_RDWR|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = file.Close() })
	return file
}

func TestPQLabLiveObservationCommandOptInAndLegacy(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	args := []string{"request", "--synthetic", "--policy", filepath.Join(root, "DO-NOT-EMIT-original-policy.json"), "--policy-sha256", strings.Repeat("a", 64), "--sequence", "1"}
	// Compare with the actual original callee, not a guessed filesystem errno:
	// its path validation can refuse before os.Lstat is reached.
	_, original := consensus.PublishPQLabLiveMaterialsRequestMeasured(args[3], args[5], consensus.PQLabLiveMaterialsRequest{Version: "YNX-PQ-LAB-LIVE-MATERIALS-REQUEST/v1", PolicySHA256: args[5], Sequence: 1}, nil)
	if original == nil {
		t.Fatal("missing original policy unexpectedly qualified")
	}
	for _, enabled := range []bool{false, true} {
		for _, timings := range []bool{false, true} {
			t.Run(fmt.Sprintf("enabled-%t-timings-%t", enabled, timings), func(t *testing.T) {
				file := publicRequestObservationFile(t)
				command := append(append([]string(nil), args...), fmt.Sprintf("--observe-stages=%t", enabled), fmt.Sprintf("--timings=%t", timings))
				var stdout bytes.Buffer
				e := runPQLabLiveMaterialsDiagnostic(command, &stdout, file)
				if e == nil || stdout.Len() != 0 {
					t.Fatal("missing original policy did not retain its real refusal")
				}
				if !timings {
					if e.Error() != original.Error() || errors.Is(e, os.ErrNotExist) != errors.Is(original, os.ErrNotExist) {
						t.Fatal("observer changed the original missing-file error identity")
					}
				} else {
					parts := strings.Split(e.Error(), "; elapsed=")
					if len(parts) != 2 || parts[0] != original.Error() {
						t.Fatal("original --timings failure envelope changed")
					}
					var reply struct {
						Version, Outcome string
						CalleeElapsedNS  int64
						Timings          consensus.PQLabMetricsSnapshot
					}
					if json.Unmarshal([]byte(parts[1]), &reply) != nil || reply.Version != "YNX-PQ-LAB-CALLEE-FAILURE/v1" || reply.Outcome != "REFUSED_OR_UNKNOWN_NO_RETRY" || reply.CalleeElapsedNS <= 0 || reply.Timings.Stages["live.policyLoadTotal"].Calls != 1 || reply.Timings.Stages["live.publishTotal"].Calls != 1 {
						t.Fatal("original nested callee timing contract changed")
					}
				}
				raw, err := os.ReadFile(file.Name())
				if err != nil {
					t.Fatal(err)
				}
				if !enabled {
					if len(raw) != 0 {
						t.Fatal("disabled diagnostics wrote output")
					}
					return
				}
				if bytes.Contains(raw, []byte(root)) || bytes.Contains(raw, []byte("DO-NOT-EMIT")) || bytes.Contains(raw, []byte(e.Error())) {
					t.Fatal("diagnostic forwarded a path, original error or request parameter")
				}
				lines := bytes.Split(bytes.TrimSpace(raw), []byte{'\n'})
				want := []string{"BEGIN:REQUEST", "BEGIN:REQUEST_PUBLISH", "BEGIN:POLICY_LOAD", "END:POLICY_LOAD", "END:REQUEST_PUBLISH", "END:REQUEST"}
				if len(lines) != len(want) {
					t.Fatal("normal callee did not expose its actual nested refusal boundaries")
				}
				for i, line := range lines {
					var event struct{ Event, Stage string }
					if json.Unmarshal(line, &event) != nil || event.Event+":"+event.Stage != want[i] {
						t.Fatal("actual stage order differs")
					}
				}
			})
		}
	}
	entries, err := os.ReadDir(root)
	if err != nil || len(entries) != 0 {
		t.Fatal("observation created a request or changed the absent original policy")
	}
}

func TestPQLabLiveObservationCommandScopeAndSink(t *testing.T) {
	for _, kind := range []string{"setup", "result"} {
		if e := runPQLabLiveMaterialsDiagnostic([]string{kind, "--synthetic", "--observe-stages"}, &bytes.Buffer{}, nil); e == nil {
			t.Fatal("request-only observer broadened another operation")
		}
	}
	read, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer read.Close()
	defer write.Close()
	args := []string{"request", "--synthetic", "--observe-stages", "--sequence", "1"}
	if e := runPQLabLiveMaterialsDiagnostic(args, &bytes.Buffer{}, write); e == nil || !strings.Contains(e.Error(), "original regular diagnostic file") {
		t.Fatal("observer introduced a blocking pipe sink")
	}
}

func TestPQLabLiveObservationSignalForwarding(t *testing.T) {
	if mode := os.Getenv("YNX_PUBLIC_LIVE_OBSERVER_CHILD"); mode != "" {
		if mode != "enabled" && mode != "disabled" {
			t.Fatal("closed PUBLIC child mode required")
		}
		if mode == "enabled" {
			_, observation, err := consensus.NewPQLabLiveRequestObservation(os.Stderr)
			if err != nil {
				t.Fatal(err)
			}
			defer observation.Finish()
			defer pqLabObserveRequestSignals(observation)()
		}
		fmt.Fprintln(os.Stdout, "PUBLIC_SIGNAL_READY")
		select {}
	}
	for _, sig := range []syscall.Signal{syscall.SIGINT, syscall.SIGTERM} {
		t.Run(sig.String(), func(t *testing.T) {
			var baseline syscall.WaitStatus
			for _, mode := range []string{"disabled", "enabled"} {
				file := publicRequestObservationFile(t)
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestPQLabLiveObservationSignalForwarding$", "-test.timeout=10s")
				command.Env = append(os.Environ(), "YNX_PUBLIC_LIVE_OBSERVER_CHILD="+mode)
				command.Stderr = file
				stdout, err := command.StdoutPipe()
				if err != nil {
					cancel()
					t.Fatal(err)
				}
				if err = command.Start(); err != nil {
					cancel()
					t.Fatal(err)
				}
				line, readErr := bufio.NewReader(stdout).ReadString('\n')
				if readErr != nil || line != "PUBLIC_SIGNAL_READY\n" {
					cancel()
					_ = command.Wait()
					t.Fatal("PUBLIC signal child did not reach its original wait")
				}
				if err = command.Process.Signal(sig); err != nil {
					cancel()
					_ = command.Wait()
					t.Fatal(err)
				}
				err = command.Wait()
				deadline := ctx.Err()
				cancel()
				var failed *exec.ExitError
				if deadline != nil || !errors.As(err, &failed) {
					t.Fatal("signal was swallowed, delayed past the bound, or mapped to exit zero")
				}
				status := failed.Sys().(syscall.WaitStatus)
				if !status.Signaled() || status.Signal() != sig {
					t.Fatal("original default signal exit status changed")
				}
				if mode == "disabled" {
					baseline = status
					continue
				}
				if status != baseline {
					t.Fatal("enabled observer changed original process exit status")
				}
				raw, e := os.ReadFile(file.Name())
				if e != nil {
					t.Fatal(e)
				}
				lines := bytes.Split(bytes.TrimSpace(raw), []byte{'\n'})
				var first, last struct{ Event, Reason string }
				if len(lines) != 2 || json.Unmarshal(lines[0], &first) != nil || json.Unmarshal(lines[1], &last) != nil || first.Event != "BEGIN" || last.Event != "CANCEL" || last.Reason != map[syscall.Signal]string{syscall.SIGINT: "SIGINT", syscall.SIGTERM: "SIGTERM"}[sig] {
					t.Fatal("signal trace did not preserve observed cancellation without an END/completion")
				}
			}
		})
	}
}
