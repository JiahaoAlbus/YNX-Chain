//go:build linux

package contribution

import (
	"bufio"
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

const linuxParentReadyPrefix = "P09_PARENT_READY "

type linuxParentReady struct {
	Job           string `json:"job"`
	Inode         uint64 `json:"inode"`
	InputReleased uint64 `json:"inputReleased"`
}

// This subprocess exists only in the test binary. The product helper/worker
// has no corresponding environment switch, entry point or executable selector.
func TestLinuxCreatorParentProbe(t *testing.T) {
	if os.Getenv("YNX_NETWORK_LINUX_QA") != "1" || os.Getenv("YNX_NETWORK_LINUX_PARENT_PROBE") != "1" {
		t.Skip("test-only subprocess of the scheduled parent-death case")
	}
	probe, pin := linuxQACode(t, "ynx-network-resource-probe")
	raw, err := os.ReadFile(probe)
	if err != nil {
		t.Fatal(err)
	}
	directory, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	worker := filepath.Join(directory, processWorkerName)
	if err = os.WriteFile(worker, raw, 0700); err != nil {
		t.Fatal(err)
	}
	e, err := NewLinuxContainedWASMExecutor(worker, pin, os.Getenv("YNX_NETWORK_LINUX_QA_BWRAP_SHA256"))
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	l := Limits{CPUMilli: "1000", MemoryBytes: strconv.Itoa(MaxMemoryBytes), StorageBytes: "0", EgressBytes: "0", DurationMillis: "5000"}
	done := make(chan error, 1)
	go func() { _, _, err := e.Execute(context.Background(), []byte("stop"), l); done <- err }()
	deadline := time.Now().Add(2 * time.Second)
	var read uint64
	for {
		_, started, n := e.LocalProcess()
		if started && n > 0 {
			read = n // Only exposed after the worker's challenge-bound FD3 admission.
			break
		}
		select {
		case err := <-done:
			t.Fatalf("worker ended before parent-death challenge: %v", err)
		default:
		}
		if time.Now().After(deadline) {
			t.Fatal("no admitted worker before parent-death challenge")
		}
		time.Sleep(time.Millisecond)
	}
	entries, err := e.linux.delegate.ReadDir(-1)
	if err != nil {
		t.Fatal(err)
	}
	var ready linuxParentReady
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), "job-") {
			continue
		}
		if ready.Job != "" {
			t.Fatal("ambiguous dedicated-unit job directories")
		}
		info, err := entry.Info()
		if err != nil {
			t.Fatal(err)
		}
		ready = linuxParentReady{entry.Name(), info.Sys().(*syscall.Stat_t).Ino, read}
	}
	if ready.Job == "" {
		t.Fatal("admitted worker has no live leaf")
	}
	message, err := json.Marshal(ready)
	if err != nil {
		t.Fatal(err)
	}
	fmt.Printf("%s%s\n", linuxParentReadyPrefix, message)
	err = <-done
	t.Fatalf("parent was not killed before natural worker termination: %v", err)
}

func linuxRuntimeParentDeath(t *testing.T) {
	t.Helper()
	raw, err := os.ReadFile("/proc/self/cgroup")
	if err != nil {
		t.Fatal(err)
	}
	path, err := linuxUnitParent(string(raw))
	if err != nil {
		t.Fatal(err)
	}
	delegate, err := linuxOpenDir(path)
	if err != nil {
		t.Fatal(err)
	}
	defer delegate.Close()
	if _, err = linuxCgroupDirectory(delegate, uint32(os.Geteuid())); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestLinuxCreatorParentProbe$", "-test.timeout=7s", "-test.count=1")
	cmd.Env = append(os.Environ(), "YNX_NETWORK_LINUX_PARENT_PROBE=1")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	parentStarted := time.Now()
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	waited := false
	defer func() {
		if !waited {
			_ = cmd.Process.Kill() // Only the original returned process handle.
			_ = cmd.Wait()
		}
	}()
	type announcement struct {
		ready linuxParentReady
		err   error
	}
	announced := make(chan announcement, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 4096), 16384)
		for scanner.Scan() {
			if strings.HasPrefix(scanner.Text(), linuxParentReadyPrefix) {
				var ready linuxParentReady
				err := json.Unmarshal([]byte(strings.TrimPrefix(scanner.Text(), linuxParentReadyPrefix)), &ready)
				announced <- announcement{ready, err}
				return
			}
		}
		announced <- announcement{err: fmt.Errorf("parent exited without ready line: %v", scanner.Err())}
	}()
	var ready linuxParentReady
	select {
	case message := <-announced:
		if message.err != nil {
			t.Fatal(message.err)
		}
		ready = message.ready
	case <-time.After(3 * time.Second):
		t.Fatal("parent-death subprocess did not admit a worker")
	}
	nonce := strings.TrimPrefix(ready.Job, "job-")
	decoded, err := hex.DecodeString(nonce)
	if err != nil || len(decoded) != 16 || hex.EncodeToString(decoded) != nonce || ready.Job != "job-"+nonce || ready.Inode == 0 || ready.InputReleased != 4 {
		t.Fatal("invalid fresh live-leaf announcement")
	}
	// The announced name grants no write/signal authority. Open a read-only
	// handle under this process's own delegate and bind its original inode.
	fd, err := unix.Openat(int(delegate.Fd()), ready.Job, unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_DIRECTORY|unix.O_RDONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	leaf := os.NewFile(uintptr(fd), ready.Job)
	defer leaf.Close()
	info, err := linuxCgroupDirectory(leaf, uint32(os.Geteuid()))
	if err != nil || info.Sys().(*syscall.Stat_t).Ino != ready.Inode {
		t.Fatal("live leaf identity mismatch")
	}
	procs, err := linuxRead(leaf, "cgroup.procs")
	if err != nil || procs == "" {
		t.Fatal("worker group not populated before parent kill")
	}
	began := time.Now()
	if err = cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	err = cmd.Wait()
	waited = true
	if cmd.ProcessState == nil {
		t.Fatalf("original parent Wait has no terminal status: %v", err)
	}
	status, ok := cmd.ProcessState.Sys().(syscall.WaitStatus)
	if err == nil || !ok || !status.Signaled() || status.Signal() != syscall.SIGKILL {
		t.Fatalf("original parent handle not killed/waited: %v stderr=%q", err, stderr.String())
	}
	for {
		events, err := linuxRead(leaf, "cgroup.events")
		if err != nil {
			t.Fatal(err)
		}
		values, err := linuxNumbers(events)
		if err != nil {
			t.Fatal(err)
		}
		populated, exists := values["populated"]
		if !exists || time.Since(began) > time.Second {
			t.Fatalf("parent-death chain did not empty original group within 1s: %s", events)
		}
		if exists && populated == 0 {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if time.Since(parentStarted) >= 4*time.Second {
		t.Fatal("parent-death observation too late to distinguish the worker deadline")
	}
	t.Logf("original creator parent SIGKILL/Wait; admittedInput=%d heldLeafInode=%d group populated0 after %s (worker deadline5s); observation only, no cgroup writes/PID import", ready.InputReleased, ready.Inode, time.Since(began))
	// The crashed helper's empty leaf/captures are preserved for the original
	// outer unit's cleanup. This observer never deletes an announced path.
}
