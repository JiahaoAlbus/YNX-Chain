//go:build linux || (darwin && cgo)

package securelink

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

var publicOriginalPeerUnknownMu sync.Mutex
var publicOriginalPeerUnknownDebts []*originalLocalCallerPeer

// Only PUBLIC test fixtures observe themselves to form expected DATA. No
// production constructor or Source registration uses this helper.
func publicOriginalLocalCallerExpected(t *testing.T) LocalCallerExpectedProcess {
	t.Helper()
	image, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	return publicOriginalLocalCallerExpectedPID(t, os.Getpid(), image)
}
func publicOriginalLocalCallerExpectedPID(t *testing.T, pid int, image string) LocalCallerExpectedProcess {
	t.Helper()
	image, err := filepath.EvalSymlinks(image)
	if err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(image)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.New()
	n, readErr := io.Copy(hash, io.LimitReader(f, (128<<20)+1))
	closeErr := f.Close()
	if readErr != nil || closeErr != nil || n < 1 || n > 128<<20 {
		t.Fatalf("PUBLIC image observation read=%v close=%v bytes=%d", readErr, closeErr, n)
	}
	kind, a, b, uid := publicOriginalLocalCallerExpectedStart(t, pid)
	expected := LocalCallerExpectedProcess{UID: uid, PID: pid, StartKind: kind, StartA: a, StartB: b, ImagePath: image, ImageBytes: uint64(n)}
	copy(expected.ImageSHA256[:], hash.Sum(nil))
	return expected
}

func originalPeerEvidence(t *testing.T, value any) {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("PUBLIC_PEER RootAdmission=false SourceAdmission=false %s", data)
	if root := os.Getenv("YNX_LINK_OWNED_LOCAL_CLIENT_TEST_EVIDENCE"); root != "" {
		if err := os.MkdirAll(root, 0700); err != nil {
			t.Fatal(err)
		}
		file, err := os.CreateTemp(root, "peer-*.json")
		if err != nil {
			t.Fatal(err)
		}
		_, writeErr := file.Write(append(data, '\n'))
		closeErr := file.Close()
		if writeErr != nil || closeErr != nil {
			t.Fatalf("evidence write=%v close=%v", writeErr, closeErr)
		}
	}
}

func publicOriginalPeerSocketDirectory(t *testing.T, prefix string) string {
	t.Helper()
	base := os.Getenv("YNX_LINK_OWNED_LOCAL_CLIENT_TEST_SOCKET_ROOT")
	if base == "" {
		base = os.TempDir()
	}
	if err := os.MkdirAll(base, 0700); err != nil {
		t.Fatal(err)
	}
	if len([]byte(filepath.Join(base, prefix+"XXXXXX", "s"))) >= 104 {
		t.Fatal("PUBLIC owned Unix endpoint requires an explicit short socket root")
	}
	directory, err := os.MkdirTemp(base, prefix)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(directory) })
	return directory
}

func publicOriginalPeerSockets(t *testing.T) (*net.UnixConn, *net.UnixConn) {
	t.Helper()
	// The test owns only this short private local endpoint, not an application
	// listener or a Source resource. All build/evidence paths remain external.
	directory := publicOriginalPeerSocketDirectory(t, "lp-")
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: filepath.Join(directory, "s"), Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	client, err := net.DialUnix("unix", nil, listener.Addr().(*net.UnixAddr))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Close() })
	server, err := listener.AcceptUnix()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Close() })
	return client, server
}
func publicOriginalPeerPrepare(t *testing.T, expected LocalCallerExpectedProcess) *originalLocalCallerPeer {
	t.Helper()
	p, err := prepareOriginalLocalCallerPeer(context.Background(), expected)
	if p == nil {
		t.Fatal("original nonnull partial required")
	}
	t.Cleanup(func() {
		if err := p.close(); err != nil || !p.closed() {
			t.Errorf("PUBLIC peer physical cleanup: error=%v closed=%t", err, p.closed())
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestOriginalLocalCallerPeerSameConnectedIdentity(t *testing.T) {
	expected := publicOriginalLocalCallerExpected(t)
	p := publicOriginalPeerPrepare(t, expected)
	client, server := publicOriginalPeerSockets(t)
	if err := p.bind(context.Background(), client); err != nil {
		t.Fatal(err)
	}
	observed, err := p.current(context.Background(), client, false)
	if err != nil || !observed.PeerIdentityAvailable || !observed.ProcessIdentityAvailable || !observed.SameOriginalConnection || !observed.LivenessProved {
		t.Fatalf("live original peer: %+v %v", observed, err)
	}
	other, _ := publicOriginalPeerSockets(t)
	if _, err = p.current(context.Background(), other, false); err == nil {
		t.Fatal("another same-PID connection replaced the original socket")
	}
	if _, err = server.Write([]byte("whole")); err != nil {
		t.Fatal(err)
	}
	if err = server.Close(); err != nil {
		t.Fatal(err)
	}
	var raw [5]byte
	if _, err = io.ReadFull(client, raw[:]); err != nil || string(raw[:]) != "whole" {
		t.Fatal("original bytes", err)
	}
	var end [1]byte
	if n, readErr := client.Read(end[:]); n != 0 || !errors.Is(readErr, io.EOF) {
		t.Fatal("actual terminal EOF required", n, readErr)
	}
	terminal, err := p.current(context.Background(), client, true)
	if err != nil || !terminal.SameOriginalConnection || !terminal.ProcessIdentityAvailable || !terminal.TerminalEOFObserved || terminal.LivenessProved {
		t.Fatalf("terminal DATA observation: %+v %v", terminal, err)
	}
	if _, err = p.current(context.Background(), client, false); err == nil {
		t.Fatal("terminal EOF became live Current")
	}
	originalPeerEvidence(t, map[string]any{"case": "same-connected-terminal", "expectedPUBLIC": expected, "live": observed, "terminal": terminal})
}

func TestOriginalLocalCallerPeerRejectsWrongExpectedIdentity(t *testing.T) {
	good := publicOriginalLocalCallerExpected(t)
	for _, name := range []string{"start", "digest", "uid", "pid"} {
		t.Run(name, func(t *testing.T) {
			bad := good
			switch name {
			case "start":
				bad.StartA++
			case "digest":
				bad.ImageSHA256[0] ^= 1
			case "uid":
				bad.UID++
			case "pid":
				bad.PID += 100000000
			}
			p, err := prepareOriginalLocalCallerPeer(context.Background(), bad)
			if p == nil || err == nil {
				t.Fatalf("wrong registered %s accepted: %v", name, err)
			}
			if closeErr := p.close(); closeErr != nil || !p.closed() {
				t.Fatalf("known failed partial must close: %v closed=%t", closeErr, p.closed())
			}
			originalPeerEvidence(t, map[string]any{"case": "wrong-" + name, "rejected": true, "physicalClosed": true, "actualPIDReuseOccurred": false})
		})
	}
}

func TestOriginalLocalCallerPeerCloseUnknownRetainedOnce(t *testing.T) {
	p, err := prepareOriginalLocalCallerPeer(context.Background(), publicOriginalLocalCallerExpected(t))
	if p == nil || err != nil {
		t.Fatal(err)
	}
	// Explicit test-only ownership violation injects a real EBADF close result.
	// The production path has no hook and does not close a borrowed descriptor.
	fd, err := unix.Open(os.DevNull, unix.O_RDONLY|unix.O_CLOEXEC, 0)
	if err != nil {
		t.Fatal(err)
	}
	temporary := p.own(fd, "PUBLIC-temporary-close-fault")
	if err = unix.Close(fd); err != nil {
		t.Fatal(err)
	}
	first := p.finish(temporary)
	if !errors.Is(first, unix.EBADF) {
		t.Fatal("actual first close must fail", first)
	}
	if err = p.close(); !errors.Is(err, ErrOriginalLocalCallerCloseUnknown) || p.closed() {
		t.Fatalf("unknown was reclaimed: %v closed=%t", err, p.closed())
	}
	if again := p.finish(temporary); again != first || !temporary.selected || temporary.closed {
		t.Fatal("unknown temporary close retried or lost")
	}
	if again := p.close(); again != err || p.closed() {
		t.Fatal("second cleanup reselected unknown closure")
	}
	p.mu.Lock()
	retained := len(p.files)
	p.mu.Unlock()
	if retained != 1 {
		t.Fatal("all known FDs must drain, retaining only the original UNKNOWN record", retained)
	}
	// Retain the real unknown record until process exit, exactly as an Auth
	// parent must retain a failed physical child. Never GC it into success.
	publicOriginalPeerUnknownMu.Lock()
	publicOriginalPeerUnknownDebts = append(publicOriginalPeerUnknownDebts, p)
	publicOriginalPeerUnknownMu.Unlock()
	originalPeerEvidence(t, map[string]any{"case": "temporary-close-unknown", "actualErrno": "EBADF", "physicalClosed": false, "retainedUnknownRecords": retained, "closeRetried": false})
}

// Child-only PUBLIC process fixture, excluded from the focused top-name guard.
func TestLINKPrivateExchangePeerHelper(t *testing.T) {
	if os.Getenv("YNX_LINK_PUBLIC_PEER_PROCESS") != "1" {
		return
	}
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: os.Getenv("YNX_LINK_PUBLIC_PEER_SOCKET"), Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	fmt.Println("PUBLIC_PEER_READY")
	conn, err := listener.AcceptUnix()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := conn.SyscallConn()
	if err != nil {
		t.Fatal(err)
	}
	var controlErr error
	if err = raw.Control(func(fd uintptr) {
		flags, e := unix.FcntlInt(fd, unix.F_GETFD, 0)
		if e == nil {
			_, e = unix.FcntlInt(fd, unix.F_SETFD, flags & ^unix.FD_CLOEXEC)
		}
		controlErr = e
	}); err != nil || controlErr != nil {
		t.Fatal(err, controlErr)
	}
	fmt.Println("PUBLIC_PEER_ACCEPTED")
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil || line != "exec\n" {
		t.Fatal("PUBLIC command", err)
	}
	// The actual same connected fd survives this same-PID exec. The shell emits
	// a barrier after exec and waits on our private test stdin until cleanup.
	err = syscall.Exec("/bin/sh", []string{"sh", "-c", "printf 'PUBLIC_PEER_EXECUTED\\n'; read owned_exit"}, os.Environ())
	t.Fatal(err)
}

func TestOriginalLocalCallerPeerActualExecChange(t *testing.T) {
	directory := publicOriginalPeerSocketDirectory(t, "le-")
	image, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, image, "-test.run=^TestLINKPrivateExchangePeerHelper$")
	cmd.Env = append(os.Environ(), "YNX_LINK_PUBLIC_PEER_PROCESS=1", "YNX_LINK_PUBLIC_PEER_SOCKET="+filepath.Join(directory, "s"))
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	waited := false
	t.Cleanup(func() {
		if !waited {
			_ = stdin.Close()
			waitErr := cmd.Wait()
			t.Errorf("PUBLIC exec fixture required normal cleanup: %v %s", waitErr, stderr.String())
		}
	})
	scanner := bufio.NewScanner(stdout)
	if !scanner.Scan() || scanner.Text() != "PUBLIC_PEER_READY" {
		t.Fatal("PUBLIC ready", scanner.Err(), stderr.String())
	}
	expected := publicOriginalLocalCallerExpectedPID(t, cmd.Process.Pid, image)
	p := publicOriginalPeerPrepare(t, expected) // pre-Dial PID/proc/image hold
	conn, err := net.DialUnix("unix", nil, &net.UnixAddr{Name: filepath.Join(directory, "s"), Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	if !scanner.Scan() || scanner.Text() != "PUBLIC_PEER_ACCEPTED" {
		t.Fatal("PUBLIC accepted", scanner.Err())
	}
	if err = p.bind(ctx, conn); err != nil {
		t.Fatal(err)
	}
	if _, err = p.current(ctx, conn, false); err != nil {
		t.Fatal("original live child", err)
	}
	if _, err = io.WriteString(stdin, "exec\n"); err != nil {
		t.Fatal(err)
	}
	if !scanner.Scan() || scanner.Text() != "PUBLIC_PEER_EXECUTED" {
		t.Fatal("actual exec barrier", scanner.Err(), stderr.String())
	}
	// Distinguish image rejection from an ordinary disconnected peer. The
	// actual same child PID must still own this connected socket after exec.
	originalRaw, err := conn.SyscallConn()
	if err != nil {
		t.Fatal(err)
	}
	var stillConnected error
	if err = originalRaw.Control(func(fd uintptr) {
		uid, pid, e := localPeerCredentials(int(fd))
		if e != nil || uid != expected.UID || pid != expected.PID {
			stillConnected = errors.Join(ErrDenied, e)
			return
		}
		var byte [1]byte
		n, _, e := unix.Recvfrom(int(fd), byte[:], unix.MSG_PEEK|unix.MSG_DONTWAIT)
		if e == nil && n == 0 {
			stillConnected = io.EOF
			return
		}
		if e != nil && e != unix.EAGAIN && e != unix.EWOULDBLOCK {
			stillConnected = e
			return
		}
		poll := []unix.PollFd{{Fd: int32(fd), Events: unix.POLLIN}}
		if _, e = unix.Poll(poll, 0); e != nil || poll[0].Revents&(unix.POLLERR|unix.POLLHUP|unix.POLLNVAL) != 0 {
			stillConnected = errors.Join(ErrDenied, e)
		}
	}); err != nil || stillConnected != nil {
		t.Fatal("exec must preserve the original live socket", err, stillConnected)
	}
	if _, err = p.current(ctx, conn, false); err == nil {
		t.Fatal("same PID executing another image retained the original peer lease")
	}
	if _, err = io.WriteString(stdin, "exit\n"); err != nil {
		t.Fatal(err)
	}
	if err = stdin.Close(); err != nil {
		t.Fatal(err)
	}
	for scanner.Scan() {
	}
	if err = scanner.Err(); err != nil {
		t.Fatal(err)
	}
	waitErr := cmd.Wait()
	waited = true
	if waitErr != nil {
		t.Fatal("PUBLIC normal child exit required", waitErr, stderr.String())
	}
	originalPeerEvidence(t, map[string]any{"case": "actual-same-pid-exec", "pid": expected.PID, "startA": expected.StartA, "startB": expected.StartB, "retainedSocketAcrossExec": true, "rejectedChangedImage": true, "actualPIDReuseOccurred": false, "childExit": 0})
}
