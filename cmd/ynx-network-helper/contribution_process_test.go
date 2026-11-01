package main_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/contribution"
)

// Actual positive/cancellation cases compile and launch the original nested
// import-free fixed WASM interpreter worker. No shell or substitute executable
// is used as an actual WASM proof. Temporary pin calculation binds only this
// isolated build; it is not the production issuer/manifest/consent authority.
func TestP09ContributionPinnedWASMProcess(t *testing.T) {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("original current-UID executable owner check requires Unix")
	}
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	directory, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	worker := filepath.Join(directory, "ynx-network-task-worker")
	build := exec.Command("go", "build", "-mod=readonly", "-p", "1", "-trimpath", "-o", worker, ".")
	build.Dir = filepath.Join(root, "apps/network/wasmworker")
	build.Env = append(os.Environ(), "GOMAXPROCS=2")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("actual nested fixed WASM worker build: %v\n%s", err, out)
	}
	code, err := os.ReadFile(worker)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(code)
	pin := hex.EncodeToString(digest[:])
	valid := contribution.Limits{CPUMilli: "1000", MemoryBytes: strconv.Itoa(contribution.HistogramMemoryBytes),
		StorageBytes: "0", EgressBytes: "0", DurationMillis: "5000"}
	copyWorker := func(t *testing.T) string {
		t.Helper()
		dir, err := filepath.EvalSymlinks(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(dir, "ynx-network-task-worker")
		if err = os.WriteFile(path, code, 0700); err != nil {
			t.Fatal(err)
		}
		return path
	}
	open := func(t *testing.T) (*contribution.PinnedWASMExecutor, string) {
		t.Helper()
		path := copyWorker(t)
		e, err := contribution.NewPinnedWASMExecutor(path, pin)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if err := e.Close(); err != nil {
				t.Error(err)
			}
		})
		return e, path
	}
	checkIdle := func(t *testing.T, e *contribution.PinnedWASMExecutor) {
		t.Helper()
		if occupied, child, n := e.LocalProcess(); occupied || child || n != 0 {
			t.Fatalf("child occupancy released before Wait or leaked after return: %v %v %d", occupied, child, n)
		}
	}
	waitChildInput := func(t *testing.T, e *contribution.PinnedWASMExecutor, input int, done <-chan error) {
		t.Helper()
		deadline := time.NewTimer(3 * time.Second)
		defer deadline.Stop()
		tick := time.NewTicker(time.Millisecond)
		defer tick.Stop()
		for {
			if occupied, child, read := e.LocalProcess(); occupied && child && read == uint64(input) {
				return
			}
			select {
			case err := <-done:
				t.Fatalf("actual worker exited before observed child+stdin barrier: %v", err)
			case <-deadline.C:
				t.Fatal("actual child+stdin progress barrier not observed")
			case <-tick.C:
			}
		}
	}
	checkHistogram := func(t *testing.T, input, output []byte) {
		t.Helper()
		if len(output) != contribution.HistogramOutputBytes {
			t.Fatalf("fixed output length %d", len(output))
		}
		var expected [256]uint32
		for _, value := range input {
			expected[value]++
		}
		for i, count := range expected {
			if got := binary.LittleEndian.Uint32(output[i*4 : i*4+4]); got != count {
				t.Fatalf("actual fixed WASM histogram[%d]=%d expected %d", i, got, count)
			}
		}
	}
	t.Run("actual-fixed-WASM-histogram-and-clean-environment", func(t *testing.T) {
		e, path := open(t)
		// Poison inherited loader/runtime settings. Only the child's fixed three
		// budget/locale entries are supplied; no global environment is changed.
		t.Setenv("DYLD_INSERT_LIBRARIES", "/definitely-missing/never-load.dylib")
		t.Setenv("LD_PRELOAD", "/definitely-missing/never-load.so")
		t.Setenv("GODEBUG", "invalidptr=0")
		t.Setenv("YNX_FIXTURE_SECRET_MUST_NOT_REACH_WORKER", "isolated-test-sentinel")
		input := append([]byte{0, 255, 0, 1, 2, 255}, bytes.Repeat([]byte("fixed public block bytes"), 350)...)
		out, usage, err := e.Execute(context.Background(), input, valid)
		if err != nil {
			t.Fatal(err)
		}
		checkHistogram(t, input, out)
		if usage.BytesRead != uint64(len(input)) || usage.WallMicros == 0 || usage.CPUServiceVerified {
			t.Fatalf("invented resource service accounting: %+v", usage)
		}
		checkIdle(t, e)
		if now, err := os.ReadFile(path); err != nil || !bytes.Equal(now, code) {
			t.Fatal("execution changed original pinned worker")
		}
		// A completed operation releases capacity for a fresh exact fixed call.
		out, _, err = e.Execute(context.Background(), []byte{255, 255, 0}, valid)
		if err != nil {
			t.Fatal(err)
		}
		checkHistogram(t, []byte{255, 255, 0}, out)
		checkIdle(t, e)
	})
	t.Run("constructor-identity-and-independent-pin", func(t *testing.T) {
		for _, test := range []struct {
			name   string
			change func(string) string
			pin    string
		}{
			{"wrong-pin", func(p string) string { return p }, strings.Repeat("0", 64)},
			{"missing-pin", func(p string) string { return p }, ""},
			{"short-pin", func(p string) string { return p }, pin[:63]},
			{"wrong-basename", func(p string) string {
				q := filepath.Join(filepath.Dir(p), "arbitrary-command")
				if err := os.Rename(p, q); err != nil {
					t.Fatal(err)
				}
				return q
			}, pin},
			{"group-writable", func(p string) string {
				if err := os.Chmod(p, 0720); err != nil {
					t.Fatal(err)
				}
				return p
			}, pin},
			{"world-writable", func(p string) string {
				if err := os.Chmod(p, 0702); err != nil {
					t.Fatal(err)
				}
				return p
			}, pin},
			{"not-executable", func(p string) string {
				if err := os.Chmod(p, 0600); err != nil {
					t.Fatal(err)
				}
				return p
			}, pin},
			{"symlink", func(p string) string {
				q := p + ".original"
				if err := os.Rename(p, q); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(q, p); err != nil {
					t.Fatal(err)
				}
				return p
			}, pin},
		} {
			t.Run(test.name, func(t *testing.T) {
				path := test.change(copyWorker(t))
				e, err := contribution.NewPinnedWASMExecutor(path, test.pin)
				if err == nil {
					_ = e.Close()
					t.Fatal("unsafe worker accepted")
				}
			})
		}
	})
	t.Run("bounds-fail-before-any-worker", func(t *testing.T) {
		e, _ := open(t)
		for _, test := range []struct {
			name  string
			edit  func(*contribution.Limits)
			input int
			want  error
		}{
			{"empty", func(*contribution.Limits) {}, 0, contribution.ErrLimit},
			{"input-over", func(*contribution.Limits) {}, contribution.HistogramMaxInputBytes + 1, contribution.ErrLimit},
			{"memory-under", func(l *contribution.Limits) { l.MemoryBytes = strconv.Itoa(contribution.HistogramMemoryBytes - 1) }, 1, contribution.ErrLimit},
			{"memory-over", func(l *contribution.Limits) { l.MemoryBytes = strconv.Itoa(contribution.MaxMemoryBytes + 1) }, 1, contribution.ErrLimit},
			{"cpu-zero", func(l *contribution.Limits) { l.CPUMilli = "0" }, 1, contribution.ErrLimit},
			{"cpu-over", func(l *contribution.Limits) { l.CPUMilli = "1001" }, 1, contribution.ErrLimit},
			{"duration-zero", func(l *contribution.Limits) { l.DurationMillis = "0" }, 1, contribution.ErrLimit},
			{"duration-over", func(l *contribution.Limits) { l.DurationMillis = "5001" }, 1, contribution.ErrLimit},
			{"storage", func(l *contribution.Limits) { l.StorageBytes = "1" }, 1, contribution.ErrLimit},
			{"network", func(l *contribution.Limits) { l.EgressBytes = "1" }, 1, contribution.ErrLimit},
			{"noncanonical", func(l *contribution.Limits) { l.CPUMilli = "01" }, 1, contribution.ErrInvalid},
			{"numeric-overflow", func(l *contribution.Limits) { l.MemoryBytes = strings.Repeat("9", 21) }, 1, contribution.ErrInvalid},
			{"flag-injection", func(l *contribution.Limits) { l.CPUMilli = "1 --module arbitrary.wasm" }, 1, contribution.ErrInvalid},
		} {
			t.Run(test.name, func(t *testing.T) {
				limits := valid
				test.edit(&limits)
				out, usage, err := e.Execute(context.Background(), make([]byte, test.input), limits)
				if !errors.Is(err, test.want) || out != nil || usage != (contribution.Usage{}) {
					t.Fatalf("preflight output/usage/effect: %d %+v %v", len(out), usage, err)
				}
				checkIdle(t, e)
			})
		}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, usage, err := e.Execute(ctx, []byte{1}, valid)
		if !errors.Is(err, context.Canceled) || usage != (contribution.Usage{}) {
			t.Fatalf("cancelled preflight launched child: %+v %v", usage, err)
		}
	})
	t.Run("same-bytes-replaced-inode-and-changed-code-denied", func(t *testing.T) {
		for _, rewrite := range []bool{false, true} {
			t.Run(strconv.FormatBool(rewrite), func(t *testing.T) {
				e, path := open(t)
				if rewrite {
					mutated := append([]byte(nil), code...)
					mutated[len(mutated)-1] ^= 1
					if err := os.WriteFile(path, mutated, 0700); err != nil {
						t.Fatal(err)
					}
				} else {
					if err := os.Rename(path, path+".original"); err != nil {
						t.Fatal(err)
					}
					if err := os.WriteFile(path, code, 0700); err != nil {
						t.Fatal(err)
					}
				}
				out, usage, err := e.Execute(context.Background(), []byte{1}, valid)
				if !errors.Is(err, contribution.ErrInvalid) || out != nil || usage != (contribution.Usage{}) {
					t.Fatalf("changed source ran: %+v %v", usage, err)
				}
				checkIdle(t, e)
			})
		}
	})
	t.Run("cancel-after-real-child-input-barrier-and-reuse", func(t *testing.T) {
		e, _ := open(t)
		limits := valid
		limits.CPUMilli = "1"
		input := make([]byte, contribution.HistogramMaxInputBytes)
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		done := make(chan error, 1)
		go func() {
			out, usage, err := e.Execute(ctx, input, limits)
			if out != nil || usage.CPUServiceVerified || usage.BytesRead > uint64(len(input)) {
				done <- errors.New("invalid cancelled output/accounting")
				return
			}
			done <- err
		}()
		waitChildInput(t, e, len(input), done)
		if _, _, err := e.Execute(context.Background(), []byte{1}, valid); !errors.Is(err, contribution.ErrCapacity) {
			t.Fatalf("busy actual child did not retain capacity: %v", err)
		}
		cancel()
		select {
		case err := <-done:
			if !errors.Is(err, context.Canceled) {
				t.Fatal(err)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("cancel failed to kill and Wait owned actual child")
		}
		checkIdle(t, e)
		out, _, err := e.Execute(context.Background(), []byte{3, 3, 4}, valid)
		if err != nil {
			t.Fatal(err)
		}
		checkHistogram(t, []byte{3, 3, 4}, out)
		checkIdle(t, e)
	})
	t.Run("duration-and-stop-wait-real-child", func(t *testing.T) {
		e, _ := open(t)
		limits := valid
		limits.CPUMilli = "1"
		input := make([]byte, contribution.HistogramMaxInputBytes)
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		done := make(chan error, 1)
		go func() { _, _, err := e.Execute(ctx, input, limits); done <- err }()
		waitChildInput(t, e, len(input), done)
		stopCtx, stopCancel := context.WithTimeout(context.Background(), time.Second)
		defer stopCancel()
		if err := e.Stop(stopCtx); err != nil {
			t.Fatal(err)
		}
		checkIdle(t, e)
		select {
		case err := <-done:
			if !errors.Is(err, context.Canceled) {
				t.Fatal(err)
			}
		case <-time.After(time.Second):
			t.Fatal("Stop returned without actual owned Wait completion")
		}
		if _, _, err := e.Execute(context.Background(), []byte{1}, valid); !errors.Is(err, contribution.ErrStopped) {
			t.Fatalf("stop restarted worker: %v", err)
		}
	})
	t.Run("deadline-kills-and-waits-with-measured-usage", func(t *testing.T) {
		e, _ := open(t)
		limits := valid
		limits.CPUMilli = "1"
		limits.DurationMillis = "500"
		out, usage, err := e.Execute(context.Background(), make([]byte, contribution.HistogramMaxInputBytes), limits)
		if !errors.Is(err, context.DeadlineExceeded) || out != nil || usage.WallMicros == 0 || usage.CPUServiceVerified {
			t.Fatalf("deadline failed closed accounting: %+v %v", usage, err)
		}
		checkIdle(t, e)
	})
	t.Run("source-replaced-during-owned-child-invalidates-result", func(t *testing.T) {
		e, path := open(t)
		limits := valid
		limits.CPUMilli = "1"
		input := make([]byte, contribution.HistogramMaxInputBytes)
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		done := make(chan error, 1)
		go func() {
			out, _, err := e.Execute(ctx, input, limits)
			if out != nil {
				done <- errors.New("source changed but output retained")
				return
			}
			done <- err
		}()
		waitChildInput(t, e, len(input), done)
		if err := os.Rename(path, path+".original"); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, code, 0700); err != nil {
			t.Fatal(err)
		}
		cancel()
		select {
		case err := <-done:
			if !errors.Is(err, contribution.ErrInvalid) {
				t.Fatal(err)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("changed source cancelled child leaked")
		}
		checkIdle(t, e)
	})
	t.Log("actual nested fixed no-import WASM subprocess tested; isolated build pin only, CPU service/reward/production authority remain unverified")
}

// This binary is deliberately NOT the WASM interpreter. It is an isolated Go
// host-transport negative fixture, independently pinned only to exercise the
// adapter's oversized-output cancellation and Wait paths. It is never counted
// as a WASM positive, production job, publisher identity or sandbox authority.
func TestP09ContributionProcessTransportOverflow(t *testing.T) {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("original fixed executable ownership adapter requires Unix")
	}
	directory, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	fixture := filepath.Join(directory, "host_transport_negative.go")
	const source = `package main
import("io";"os";"time")
func main(){io.Copy(io.Discard,os.Stdin);if len(os.Args)==9&&os.Args[4]=="999"{os.Stdout.Write(make([]byte,2048))}else{os.Stderr.Write(make([]byte,8192))};for{time.Sleep(time.Hour)}}`
	if err = os.WriteFile(fixture, []byte(source), 0600); err != nil {
		t.Fatal(err)
	}
	worker := filepath.Join(directory, "ynx-network-task-worker")
	build := exec.Command("go", "build", "-p", "1", "-trimpath", "-o", worker, fixture)
	build.Dir = directory
	build.Env = append(os.Environ(), "GOMAXPROCS=2", "GOWORK=off")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("explicit host-transport negative fixture build: %v\n%s", err, out)
	}
	code, err := os.ReadFile(worker)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(code)
	executor, err := contribution.NewPinnedWASMExecutor(worker, hex.EncodeToString(digest[:]))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = executor.Close() })
	if executor.Executions() != 0 {
		t.Fatal("constructor started a process")
	}
	limits := contribution.Limits{CPUMilli: "999", MemoryBytes: strconv.Itoa(contribution.HistogramMemoryBytes), StorageBytes: "0", EgressBytes: "0", DurationMillis: "5000"}
	input := bytes.Repeat([]byte{1}, 64)
	for i, stream := range []string{"stdout", "stderr"} {
		t.Run(stream, func(t *testing.T) {
			limits.CPUMilli = strconv.Itoa(999 - i)
			started := time.Now()
			output, usage, err := executor.Execute(context.Background(), input, limits)
			if !errors.Is(err, contribution.ErrLimit) || output != nil || usage.BytesRead != uint64(len(input)) || usage.WallMicros == 0 || usage.CPUServiceVerified {
				t.Fatalf("oversized %s response escaped bounds: output=%d usage=%+v err=%v", stream, len(output), usage, err)
			}
			if elapsed := time.Since(started); elapsed > 2*time.Second {
				t.Fatalf("overflow did not promptly cancel and Wait: %s", elapsed)
			}
			if occupied, child, read := executor.LocalProcess(); occupied || child || read != 0 {
				t.Fatal("overflow returned before owned child Wait/occupancy release")
			}
			if executor.Executions() != uint64(i+1) {
				t.Fatalf("actual Start count=%d expected=%d", executor.Executions(), i+1)
			}
		})
	}
	if err = executor.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, _, err = executor.Execute(context.Background(), input, limits); !errors.Is(err, contribution.ErrStopped) || executor.Executions() != 2 {
		t.Fatalf("sealed executor restarted a process: starts=%d err=%v", executor.Executions(), err)
	}
	t.Log("two explicit non-WASM Go host-transport negatives killed and Waited; neither is recorded as actual WASM execution proof")
}

// Cleanup-only fixture bytes are captured but NEVER executed. These cases
// prove preservation of unknown filesystem content, not WASM functionality.
func TestP09ContributionProcessCaptureCleanup(t *testing.T) {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("original fixed executable owner checks require Unix")
	}
	newCapture := func(t *testing.T) (*contribution.PinnedWASMExecutor, string, string) {
		t.Helper()
		directory, err := filepath.EvalSymlinks(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		original := filepath.Join(directory, "ynx-network-task-worker")
		code := []byte("isolated capture cleanup bytes; never executed")
		if err = os.WriteFile(original, code, 0700); err != nil {
			t.Fatal(err)
		}
		before, err := os.ReadDir(os.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		known := make(map[string]bool)
		for _, entry := range before {
			known[entry.Name()] = true
		}
		pin := sha256.Sum256(code)
		e, err := contribution.NewPinnedWASMExecutor(original, hex.EncodeToString(pin[:]))
		if err != nil {
			t.Fatal(err)
		}
		after, err := os.ReadDir(os.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		var capture string
		for _, entry := range after {
			if !known[entry.Name()] && strings.HasPrefix(entry.Name(), "ynx-network-fixed-wasm-") {
				candidate := filepath.Join(os.TempDir(), entry.Name())
				actual, readErr := os.ReadFile(filepath.Join(candidate, "ynx-network-task-worker"))
				if readErr == nil && bytes.Equal(actual, code) {
					if capture != "" {
						t.Fatal("ambiguous test-owned capture directory")
					}
					capture = candidate
				}
			}
		}
		if capture == "" {
			t.Fatal("constructor capture not observed in dedicated test TMPDIR")
		}
		// The test eventually removes only this isolated fixture directory after
		// proving product Close retained unknown content. Product never recurses.
		t.Cleanup(func() { _ = os.RemoveAll(capture); _ = os.RemoveAll(capture + ".isolated-original") })
		return e, capture, original
	}
	t.Run("normal-and-repeated-close", func(t *testing.T) {
		e, capture, original := newCapture(t)
		if err := e.Close(); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Lstat(capture); !os.IsNotExist(err) {
			t.Fatalf("normal Close left original capture: %v", err)
		}
		if err := e.Close(); err != nil {
			t.Fatalf("repeated normal Close failed: %v", err)
		}
		if _, err := os.Stat(original); err != nil || e.Executions() != 0 {
			t.Fatal("Close removed original source or started a process")
		}
	})
	t.Run("unknown-entry-preserved-before-any-delete", func(t *testing.T) {
		e, capture, _ := newCapture(t)
		unknown := filepath.Join(capture, "unknown-user-data")
		payload := []byte("preserve unknown bytes")
		if err := os.WriteFile(unknown, payload, 0600); err != nil {
			t.Fatal(err)
		}
		if err := e.Close(); !errors.Is(err, contribution.ErrConflict) {
			t.Fatalf("unknown entry did not block cleanup: %v", err)
		}
		if raw, err := os.ReadFile(unknown); err != nil || !bytes.Equal(raw, payload) {
			t.Fatal("Close deleted or rewrote unknown data")
		}
		if _, err := os.Stat(filepath.Join(capture, "ynx-network-task-worker")); err != nil {
			t.Fatal("unknown entry cleanup already deleted original capture")
		}
		// Only this controlled test removes its injected unknown file; the
		// preserved original identity may then be closed normally and repeated.
		if err := os.Remove(unknown); err != nil {
			t.Fatal(err)
		}
		if err := e.Close(); err != nil {
			t.Fatal(err)
		}
		if err := e.Close(); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("capture-replaced-inode-preserved", func(t *testing.T) {
		e, capture, _ := newCapture(t)
		worker := filepath.Join(capture, "ynx-network-task-worker")
		original := filepath.Join(filepath.Dir(capture), filepath.Base(capture)+".captured-original")
		if err := os.Rename(worker, original); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.Remove(original) })
		payload := []byte("unknown replacement executable; never run")
		if err := os.WriteFile(worker, payload, 0500); err != nil {
			t.Fatal(err)
		}
		if err := e.Close(); !errors.Is(err, contribution.ErrInvalid) {
			t.Fatalf("replacement capture did not block cleanup: %v", err)
		}
		if raw, err := os.ReadFile(worker); err != nil || !bytes.Equal(raw, payload) {
			t.Fatal("Close deleted replacement capture")
		}
		if _, err := os.Stat(original); err != nil {
			t.Fatal("Close deleted displaced original capture")
		}
	})
	t.Run("capture-changed-bytes-preserved", func(t *testing.T) {
		e, capture, _ := newCapture(t)
		worker := filepath.Join(capture, "ynx-network-task-worker")
		payload := []byte("changed in-place capture bytes; never run")
		if err := os.Chmod(worker, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(worker, payload, 0500); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(worker, 0500); err != nil {
			t.Fatal(err)
		}
		if err := e.Close(); !errors.Is(err, contribution.ErrInvalid) {
			t.Fatalf("changed capture did not block cleanup: %v", err)
		}
		if raw, err := os.ReadFile(worker); err != nil || !bytes.Equal(raw, payload) {
			t.Fatal("Close deleted changed capture bytes")
		}
	})
	t.Run("directory-replacement-preserves-both-identities", func(t *testing.T) {
		e, capture, _ := newCapture(t)
		displaced := capture + ".isolated-original"
		if err := os.Rename(capture, displaced); err != nil {
			t.Fatal(err)
		}
		if err := os.Mkdir(capture, 0700); err != nil {
			t.Fatal(err)
		}
		unknown := filepath.Join(capture, "unknown-directory-data")
		payload := []byte("preserve foreign replacement directory")
		if err := os.WriteFile(unknown, payload, 0600); err != nil {
			t.Fatal(err)
		}
		if err := e.Close(); !errors.Is(err, contribution.ErrInvalid) {
			t.Fatalf("replaced directory did not block cleanup: %v", err)
		}
		if raw, err := os.ReadFile(unknown); err != nil || !bytes.Equal(raw, payload) {
			t.Fatal("Close deleted foreign replacement directory content")
		}
		if _, err := os.Stat(filepath.Join(displaced, "ynx-network-task-worker")); err != nil {
			t.Fatal("Close deleted original displaced capture")
		}
	})
	t.Run("directory-mode-change-preserved", func(t *testing.T) {
		e, capture, _ := newCapture(t)
		if err := os.Chmod(capture, 0750); err != nil {
			t.Fatal(err)
		}
		if err := e.Close(); !errors.Is(err, contribution.ErrInvalid) {
			t.Fatalf("directory mode change did not block cleanup: %v", err)
		}
		if _, err := os.Stat(filepath.Join(capture, "ynx-network-task-worker")); err != nil {
			t.Fatal("Close deleted mode-changed directory content")
		}
	})
}
