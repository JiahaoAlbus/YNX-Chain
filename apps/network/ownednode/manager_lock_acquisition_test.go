//go:build darwin || linux

package ownednode

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestOwnedNodeManagerLockOpenedIdentity(t *testing.T) {
	root := t.TempDir()
	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(root, 0700); err != nil {
		t.Fatal(err)
	}
	rootInfo, err := os.Stat(root)
	if err != nil {
		t.Fatal(err)
	}
	m := Manager{directory: root, rootInfo: rootInfo, uid: uint32(os.Geteuid())}
	m.state.ManagerID = randomID()
	if err := m.acquireRootLock(); err != nil {
		t.Fatal(err)
	}
	defer m.closeLocks()

	path := filepath.Join(root, lockName)
	marker, err := json.Marshal(lockRecord{Version: stateVersion, ManagerID: m.state.ManagerID})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, marker, 0600); err != nil {
		t.Fatal(err)
	}
	prior, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	retained := path + ".original"
	if err := os.Rename(path, retained); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, marker, 0600); err != nil {
		t.Fatal(err)
	}
	replacement, err := openManagerLock(m.rootLock, false)
	if err != nil {
		t.Fatal(err)
	}
	defer replacement.Close()
	if err := m.bindManagerLock(path, replacement, prior, false); !errors.Is(err, ErrUnsafePath) {
		t.Fatalf("same marker data hid replacement between lstat and open: %v", err)
	}
	if m.lock != nil {
		t.Fatal("unrecognized inode became the manager lock")
	}
	for _, name := range []string{path, retained} {
		bytesRead, err := os.ReadFile(name)
		if err != nil || !bytes.Equal(bytesRead, marker) {
			t.Fatalf("marker changed on refusal: %v", err)
		}
	}
}

func TestOwnedNodeManagerLockCreateStaysOnHeldRoot(t *testing.T) {
	base, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(base, DirectoryName)
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	rootInfo, err := os.Stat(root)
	if err != nil {
		t.Fatal(err)
	}
	m := Manager{directory: root, rootInfo: rootInfo, uid: uint32(os.Geteuid())}
	if err := m.acquireRootLock(); err != nil {
		t.Fatal(err)
	}
	defer m.closeLocks()

	moved := filepath.Join(base, "original-root")
	if err := os.Rename(root, moved); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, lockName)
	// Simulate replacement between the root check and the real marker open.
	// The syscall can only create under the already held directory.
	opened, err := openManagerLock(m.rootLock, true)
	if err != nil {
		t.Fatal(err)
	}
	defer opened.Close()
	if err := m.bindManagerLock(path, opened, nil, true); !errors.Is(err, ErrUnsafePath) {
		t.Fatalf("manager accepted replacement root: %v", err)
	}
	if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("replacement directory was modified: %v", err)
	}
	raw, err := os.ReadFile(filepath.Join(moved, lockName))
	if err != nil || len(raw) != 0 || m.lock != nil {
		t.Fatalf("partial original marker was adopted or rewritten: %v", err)
	}
}

func TestOwnedNodeCloseWithReplacedMarker(t *testing.T) {
	t.Run("invalid-marker", func(t *testing.T) { runOwnedNodeClose(t, true) })
	t.Run("final-journal-identity-failure", func(t *testing.T) { runOwnedNodeClose(t, false) })
}

func runOwnedNodeClose(t *testing.T, replaceMarker bool) {
	peer := startLifecyclePeer(t)
	base, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	cfg := Config{Directory: filepath.Join(base, DirectoryName), IsolatedFixture: true, StopGrace: 2 * time.Second}
	m, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close(context.Background())
	const firstCause = "PUBLIC original prior failure"
	m.firstCause(errors.New(firstCause))
	read := func(path string) []byte {
		t.Helper()
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	quoted := "'" + strings.ReplaceAll(executable, "'", "'\"'\"'") + "'"
	artifact := []byte(fmt.Sprintf("#!/bin/sh\nexec %s -test.run='^TestOwnedNodeManagerLockChild$'\n", quoted))
	digest := sha256.Sum256(artifact)
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	intent, approval := startLifecycleApproval(t, m, peer, "install", hex.EncodeToString(digest[:]))
	if err := m.InstallFixture(ctx, peer, intent, approval, artifact); err != nil {
		t.Fatal(err)
	}
	// Start the actual child and install its original Wait state directly in
	// this package-local fixture. The separate normal Start/Stop regression
	// covers the public entry. Omitting only the periodic monitor here makes
	// the Close/drain fault deterministic without changing production code.
	runID := randomID()
	capture, err := m.captureRuntime(artifact, runID)
	if err != nil {
		t.Fatal(err)
	}
	logs, err := m.createRunLogs(runID, 4096)
	if err != nil {
		t.Fatal(err)
	}
	defer logs.close()
	cmd := exec.Command(capture.path)
	cmd.Dir = filepath.Join(cfg.Directory, "data")
	cmd.Env = []string{"LC_ALL=C", "LANG=C", "GOMAXPROCS=1"}
	cmd.Stdout, cmd.Stderr = logs.stdout, logs.stderr
	if err := os.WriteFile(filepath.Join(cmd.Dir, "PUBLIC-lock-child-fixture"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	reads, cancelReads := context.WithCancel(context.Background())
	running := &child{cmd: cmd, done: make(chan struct{}), exited: make(chan struct{}), runID: runID,
		capture: capture, logs: logs, readContext: reads, cancelReads: cancelReads}
	m.process = running
	m.state.Stage = "running"
	m.state.RunID = runID
	m.state.LastPID = cmd.Process.Pid
	m.state.Generation++
	go m.wait(running)
	m.mu.Lock()
	err = m.save()
	m.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	foreign := exec.Command("/bin/sleep", "40")
	if err := foreign.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if foreign.ProcessState == nil {
			_ = foreign.Process.Kill()
			_ = foreign.Wait()
		}
	}()
	waitFile := func(name string) {
		t.Helper()
		for {
			if _, err := os.Stat(filepath.Join(cfg.Directory, "data", name)); err == nil {
				return
			}
			select {
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			case <-time.After(5 * time.Millisecond):
			}
		}
	}
	waitFile("PUBLIC-lock-child-ready")
	stop, permitted := startLifecycleApproval(t, m, peer, "stop", "")
	lockPath := filepath.Join(cfg.Directory, lockName)
	journalPath := filepath.Join(cfg.Directory, stateName)
	original := read(lockPath)
	journal := read(journalPath)
	retained := filepath.Join(base, "original-held-lock")
	if replaceMarker {
		if err := os.Rename(lockPath, retained); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(lockPath, original, 0600); err != nil {
			t.Fatal(err)
		}
		if err := m.Stop(ctx, peer, stop, permitted); !errors.Is(err, ErrUnsafePath) {
			t.Fatalf("approved Stop did not verify its original owner: %v", err)
		}
	}
	closed := make(chan error, 1)
	var originalStop chan error
	if replaceMarker {
		go func() { closed <- m.Close(ctx) }()
	} else {
		originalStop = make(chan error, 1)
		go func() { originalStop <- m.Stop(ctx, peer, stop, permitted) }()
	}
	waitFile("PUBLIC-lock-child-draining")
	if !replaceMarker {
		journal = read(journalPath)
		if !bytes.Contains(journal, []byte(`"stage":"stopping"`)) {
			t.Fatal("close did not publish the genuine provisional stopping journal")
		}
		// Restore the same bytes at a different inode while Wait is pending.
		// This leaves both ownership locks valid and only final save refuses.
		if err := os.Rename(journalPath, filepath.Join(base, "original-journal")); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(journalPath, journal, 0600); err != nil {
			t.Fatal(err)
		}
		go func() { closed <- m.Close(ctx) }()
		for {
			m.closeMu.Lock()
			closing := m.closeInFlight != nil
			m.closeMu.Unlock()
			if closing {
				break
			}
			select {
			case <-ctx.Done():
				t.Fatal("Close did not join the original approved Stop")
			case <-time.After(5 * time.Millisecond):
			}
		}
	}
	short, stopWaiting := context.WithTimeout(ctx, 25*time.Millisecond)
	defer stopWaiting()
	cancelledClose := make(chan error, 1)
	// Simulate the manager mutex remaining occupied by native cleanup. The
	// joining caller must still observe its own cancellation promptly.
	m.mu.Lock()
	go func() { cancelledClose <- m.Close(short) }()
	select {
	case err := <-cancelledClose:
		m.mu.Unlock()
		if !errors.Is(err, context.DeadlineExceeded) || !errors.Is(err, ErrReconcile) {
			t.Fatalf("cancelled joiner did not retain pending result: %v", err)
		}
	case <-time.After(time.Second):
		m.mu.Unlock()
		t.Fatal("cancelled joiner did not return within its own bound")
	}
	stopWaiting()
	select {
	case <-running.done:
		t.Fatal("cancelled joiner terminated the original held child")
	default:
	}
	joined := make(chan error, 1)
	go func() { joined <- m.Close(ctx) }()
	if next, err := New(cfg); err == nil {
		_ = next.Close(ctx)
		t.Fatal("second owner acquired directory before the original drain")
	}
	if m.PhysicalReleased() {
		t.Fatal("owner released descriptors before the original Wait")
	}
	if err := os.WriteFile(filepath.Join(cfg.Directory, "data", "PUBLIC-lock-child-release"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	if originalStop != nil {
		select {
		case err := <-originalStop:
			if !errors.Is(err, ErrReconcile) || !errors.Is(err, ErrUnsafePath) {
				t.Fatalf("original Stop lost its final journal save failure: %v", err)
			}
		case <-ctx.Done():
			t.Fatal("original Stop did not return from the held Wait")
		}
	}
	for _, result := range []chan error{closed, joined} {
		select {
		case closeErr := <-result:
			if !errors.Is(closeErr, ErrUnsafePath) || !errors.Is(closeErr, ErrReconcile) || !m.PhysicalReleased() {
				t.Fatalf("same close result omitted the original Wait failure or physical release: %v", closeErr)
			}
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
	if running.cmd.ProcessState == nil || !running.cmd.ProcessState.Success() ||
		m.state.FirstCause != firstCause || m.state.Stage != "reconcile_required" ||
		!errors.Is(running.waitErr, ErrUnsafePath) || !errors.Is(running.waitErr, ErrReconcile) {
		t.Fatalf("missing original Wait result or first cause: %v %s %s", running.cmd.ProcessState, m.state.FirstCause, m.state.Stage)
	}
	if err := foreign.Process.Signal(syscall.Signal(0)); err != nil {
		t.Fatalf("unrelated child no longer running: %v", err)
	}
	if err := foreign.Process.Kill(); err != nil {
		t.Fatalf("unrelated child did not remain under the test owner's control: %v", err)
	}
	var foreignExit *exec.ExitError
	if err := foreign.Wait(); !errors.As(err, &foreignExit) {
		t.Fatalf("unrelated child did not observe the test owner's cleanup: %v", err)
	}
	waitStatus, ok := foreignExit.Sys().(syscall.WaitStatus)
	if !ok || waitStatus.Signal() != syscall.SIGKILL {
		t.Fatalf("unexpected unrelated child exit: %v", foreignExit)
	}
	log := read(filepath.Join(cfg.Directory, "logs", runID, "stdout.log"))
	if !bytes.Contains(log, []byte("PUBLIC held child log")) || !bytes.Equal(read(journalPath), journal) ||
		!bytes.Equal(read(lockPath), original) {
		t.Fatal("Close lost log bytes or rewrote evidence under an unsafe owner")
	}
	if replaceMarker && !bytes.Equal(read(retained), original) {
		t.Fatal("retained original marker was modified")
	}
	if !replaceMarker && !bytes.Equal(read(filepath.Join(base, "original-journal")), journal) {
		t.Fatal("retained original journal was modified")
	}
}

func TestOwnedNodeManagerLockChild(t *testing.T) {
	// The private child inherits no environment except the fixed manager
	// allowlist. An absent fixture selector is a harmless direct test entry.
	if _, err := os.Stat("PUBLIC-lock-child-fixture"); err != nil {
		return
	}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt)
	defer signal.Stop(signals)
	fmt.Println("PUBLIC held child log")
	if err := os.WriteFile("PUBLIC-lock-child-ready", nil, 0600); err != nil {
		t.Fatal(err)
	}
	select {
	case <-signals:
	case <-time.After(10 * time.Second):
		t.Fatal("original Close did not signal the held child")
	}
	if err := os.WriteFile("PUBLIC-lock-child-draining", nil, 0600); err != nil {
		t.Fatal(err)
	}
	for start := time.Now(); time.Since(start) < 5*time.Second; time.Sleep(5 * time.Millisecond) {
		if _, err := os.Stat("PUBLIC-lock-child-release"); err == nil {
			return
		}
	}
	t.Fatal("parent never released the original child")
}
