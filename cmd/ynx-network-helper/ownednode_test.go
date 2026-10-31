package main_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/ownednode"
)

// Each permission test starts from an actual kernel-authenticated Unix caller.
// Explicit=true below is isolated test-native consent, never production UI proof.
func ownedPeer(t *testing.T) localipc.Peer {
	t.Helper()
	dir := filepath.Join(ipcRoot(t), "ipc")
	seen := make(chan localipc.Peer, 1)
	s, err := localipc.Start(context.Background(), localipc.Config{Directory: dir, Handler: func(c context.Context, p localipc.Peer, r localipc.Request) (localipc.Result, error) {
		seen <- p
		return ipcStatus(c, p, r)
	}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ipcClose(t, s) })
	if _, err = localipc.Call(context.Background(), dir, ipcRequest()); err != nil {
		t.Fatal(err)
	}
	return <-seen
}
func ownedConfig(t *testing.T) ownednode.Config {
	return ownednode.Config{Directory: filepath.Join(ipcRoot(t), ownednode.DirectoryName), IsolatedFixture: true}
}
func ownedClose(t *testing.T, m *ownednode.Manager) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := m.Close(ctx); err != nil {
		t.Errorf("owned manager close: %v", err)
	}
}
func ownedApproval(t *testing.T, m *ownednode.Manager, p localipc.Peer, action, digest string) (ownednode.Intent, *ownednode.Approval) {
	t.Helper()
	intent, err := m.Prepare(p, action, digest)
	if err != nil {
		t.Fatal(err)
	}
	approval, err := m.Approve(p, intent, true, 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	return intent, approval
}

var isolatedNodeArtifact = []byte("#!/bin/sh\nexec /bin/sleep 30\n")

func installOwnedFixture(t *testing.T, m *ownednode.Manager, p localipc.Peer) {
	t.Helper()
	sum := sha256.Sum256(isolatedNodeArtifact)
	intent, approval := ownedApproval(t, m, p, "install", hex.EncodeToString(sum[:]))
	if err := m.InstallFixture(context.Background(), p, intent, approval, isolatedNodeArtifact); err != nil {
		t.Fatal(err)
	}
}
func TestNetworkOwnedNodeProductionMissingOriginalReleaseAndZeroPeerDenied(t *testing.T) {
	peer := ownedPeer(t)
	cfg := ownedConfig(t)
	cfg.IsolatedFixture = false
	m, err := ownednode.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer ownedClose(t, m)
	if _, err = m.Status(localipc.Peer{}); !errors.Is(err, localipc.ErrPeerDenied) {
		t.Fatal("zero/JSON peer passed native gate")
	}
	if err = m.Install(context.Background(), peer, ownednode.Intent{}, nil); !errors.Is(err, ownednode.ErrOriginalReleaseMissing) {
		t.Fatal(err)
	}
	if _, err = m.Start(context.Background(), peer, ownednode.Intent{}, nil); !errors.Is(err, ownednode.ErrOriginalReleaseMissing) {
		t.Fatal(err)
	}
	if err = m.InstallFixture(context.Background(), peer, ownednode.Intent{}, nil, isolatedNodeArtifact); !errors.Is(err, ownednode.ErrOriginalReleaseMissing) {
		t.Fatal("fixture path available in production")
	}
	status, err := m.Status(peer)
	if err != nil || status.Stage != "not_installed" || status.ProductionSupported || status.ProcessOwned {
		t.Fatalf("production capability fabricated: %+v %v", status, err)
	}
}
func TestNetworkOwnedNodeRealFixtureInstallStartStopReopenAndReplay(t *testing.T) {
	peer := ownedPeer(t)
	cfg := ownedConfig(t)
	m, err := ownednode.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer ownedClose(t, m)
	installOwnedFixture(t, m, peer)
	intent, err := m.Prepare(peer, "start", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = m.Start(context.Background(), peer, intent, nil); !errors.Is(err, ownednode.ErrConsent) {
		t.Fatal("start without consent")
	}
	approval, err := m.Approve(peer, intent, true, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	runID, err := m.Start(context.Background(), peer, intent, approval)
	if err != nil || runID == "" {
		t.Fatal(err)
	}
	status, err := m.Status(peer)
	if err != nil || status.Stage != "running" || !status.ProcessOwned || status.LastPID <= 0 || status.Mode != "isolated-lifecycle-fixture" {
		t.Fatalf("real fixture not running %+v %v", status, err)
	}
	if _, err = m.Start(context.Background(), peer, intent, approval); err == nil {
		t.Fatal("duplicate child started")
	}
	stopIntent, stopApproval := ownedApproval(t, m, peer, "stop", "")
	if err = m.Stop(context.Background(), peer, stopIntent, stopApproval); err != nil {
		t.Fatal(err)
	}
	status, err = m.Status(peer)
	if err != nil || status.Stage != "stopped" || status.ProcessOwned || status.RunID != runID {
		t.Fatalf("owned child not reaped %+v %v", status, err)
	}
	if _, err = m.Start(context.Background(), peer, intent, approval); err == nil {
		t.Fatal("consumed/stale start approval replayed")
	}
	ownedClose(t, m)
	m2, err := ownednode.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer ownedClose(t, m2)
	restored, err := m2.Status(peer)
	if err != nil || restored.Stage != "stopped" || restored.RunID != runID || restored.ArtifactSHA256 != status.ArtifactSHA256 {
		t.Fatalf("reopen lost journal %+v %v", restored, err)
	}
	newIntent, newApproval := ownedApproval(t, m2, peer, "start", "")
	if _, err = m2.Start(context.Background(), peer, newIntent, newApproval); err != nil {
		t.Fatal(err)
	}
	ownedClose(t, m2)
}
func TestNetworkOwnedNodeConsentExpiryTamperAndManagerLease(t *testing.T) {
	peer := ownedPeer(t)
	cfg := ownedConfig(t)
	m, err := ownednode.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer ownedClose(t, m)
	installOwnedFixture(t, m, peer)
	if second, err := ownednode.New(cfg); err == nil {
		ownedClose(t, second)
		t.Fatal("second writer took manager lease")
	}
	intent, err := m.Prepare(peer, "start", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = m.Approve(peer, intent, false, time.Minute); !errors.Is(err, ownednode.ErrConsent) {
		t.Fatal("implicit approval accepted")
	}
	expired, err := m.Approve(peer, intent, true, time.Nanosecond)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(time.Millisecond)
	if _, err = m.Start(context.Background(), peer, intent, expired); !errors.Is(err, ownednode.ErrConsent) {
		t.Fatal("expired approval accepted")
	}
	_, approval := ownedApproval(t, m, peer, "start", "")
	path := filepath.Join(cfg.Directory, "bin", "node")
	if err = os.WriteFile(path, []byte("changed-byte"), 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err = m.Start(context.Background(), peer, intent, approval); err == nil {
		t.Fatal("tampered artifact launched")
	}
	status, _ := m.Status(peer)
	if status.ProcessOwned {
		t.Fatal("tampered process exists")
	}
}
func TestNetworkOwnedNodeCapacityAndUnknownPathsPreserved(t *testing.T) {
	peer := ownedPeer(t)
	cfg := ownedConfig(t)
	cfg.StorageQuotaBytes = 4096
	m, err := ownednode.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer ownedClose(t, m)
	unknown := filepath.Join(cfg.Directory, "data", "retained")
	if err = os.WriteFile(unknown, bytes.Repeat([]byte{'x'}, 4096), 0o600); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(isolatedNodeArtifact)
	intent, approval := ownedApproval(t, m, peer, "install", hex.EncodeToString(sum[:]))
	if err = m.InstallFixture(context.Background(), peer, intent, approval, isolatedNodeArtifact); !errors.Is(err, ownednode.ErrCapacity) {
		t.Fatalf("capacity not enforced: %v", err)
	}
	if info, err := os.Stat(unknown); err != nil || info.Size() != 4096 {
		t.Fatal("capacity failure deleted data")
	}
	if err = os.Remove(unknown); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(ipcRoot(t), "outside")
	if err = os.WriteFile(target, []byte("outside-preserve"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink(target, filepath.Join(cfg.Directory, "bin", "node")); err != nil {
		t.Fatal(err)
	}
	if err = m.InstallFixture(context.Background(), peer, intent, approval, isolatedNodeArtifact); err == nil {
		t.Fatal("symlink artifact accepted")
	}
	raw, _ := os.ReadFile(target)
	if string(raw) != "outside-preserve" {
		t.Fatal("outside file changed")
	}
	root := ipcRoot(t)
	dir := filepath.Join(root, ownednode.DirectoryName)
	if err = os.Mkdir(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(dir, "manager.lock")
	if err = os.WriteFile(marker, []byte("foreign-lock"), 0o600); err != nil {
		t.Fatal(err)
	}
	if other, err := ownednode.New(ownednode.Config{Directory: dir, IsolatedFixture: true}); err == nil {
		ownedClose(t, other)
		t.Fatal("unknown lock accepted")
	}
	raw, _ = os.ReadFile(marker)
	if string(raw) != "foreign-lock" {
		t.Fatal("unknown lock removed")
	}
}
func TestNetworkOwnedNodeRestartNeverSignalsStoredForeignHandle(t *testing.T) {
	peer := ownedPeer(t)
	cfg := ownedConfig(t)
	m, err := ownednode.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	installOwnedFixture(t, m, peer)
	ownedClose(t, m)
	// Independent, test-owned process is not a manager child. Its PID is planted
	// only into the isolated journal to prove reopen cannot acquire kill authority.
	sentinel := exec.Command("/bin/sleep", "30")
	if err = sentinel.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = sentinel.Process.Kill(); _ = sentinel.Wait() }()
	path := filepath.Join(cfg.Directory, "manager.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	raw = bytes.Replace(raw, []byte(`"stage":"installed"`), []byte(`"stage":"running"`), 1)
	raw = bytes.Replace(raw, []byte(`"lastPid":0`), []byte(fmt.Sprintf(`"lastPid":%d`, sentinel.Process.Pid)), 1)
	if err = os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	reopened, err := ownednode.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer ownedClose(t, reopened)
	status, err := reopened.Status(peer)
	if err != nil || status.Stage != "reconcile_required" || status.ProcessOwned || !strings.Contains(status.FirstCause, "without the original") {
		t.Fatalf("restart falsely adopted child: %+v %v", status, err)
	}
	intent, approval := ownedApproval(t, reopened, peer, "stop", "")
	if err = reopened.Stop(context.Background(), peer, intent, approval); !errors.Is(err, ownednode.ErrReconcile) {
		t.Fatal("stored PID became stop authority")
	}
	if err = sentinel.Process.Signal(syscall.Signal(0)); err != nil {
		t.Fatal("foreign test-owned process was signalled")
	}
	intent, approval = ownedApproval(t, reopened, peer, "start", "")
	if _, err = reopened.Start(context.Background(), peer, intent, approval); !errors.Is(err, ownednode.ErrReconcile) {
		t.Fatal("unknown prior run replayed")
	}
}

func TestNetworkOwnedNodeRuntimeQuotaStopsOnlyOwnedFixtureAndRetainsUsage(t *testing.T) {
	peer := ownedPeer(t)
	cfg := ownedConfig(t)
	cfg.StorageQuotaBytes = 8192
	m, err := ownednode.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer ownedClose(t, m)
	installOwnedFixture(t, m, peer)
	intent, approval := ownedApproval(t, m, peer, "start", "")
	if _, err = m.Start(context.Background(), peer, intent, approval); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(cfg.Directory, "data", "retained-quota-data")
	if err = os.WriteFile(path, bytes.Repeat([]byte{'q'}, 8192), 0o600); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for {
		status, _ := m.Status(peer)
		if status.Stage == "stopped" {
			if status.ProcessOwned || !strings.Contains(status.FirstCause, "capacity limit") || !status.Capacity.Complete || status.Capacity.UsedBytes < 8192 {
				t.Fatalf("quota outcome lost: %+v", status)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("own fixture did not stop after quota excess: %+v", status)
		}
		time.Sleep(10 * time.Millisecond)
	}
	if info, err := os.Stat(path); err != nil || info.Size() != 8192 {
		t.Fatal("usage data removed on stop")
	}
}

func TestNetworkOwnedNodeCloseReapsOwnedProcessAndFixtureCannotBecomeProduction(t *testing.T) {
	peer := ownedPeer(t)
	cfg := ownedConfig(t)
	m, err := ownednode.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	installOwnedFixture(t, m, peer)
	intent, approval := ownedApproval(t, m, peer, "start", "")
	if _, err = m.Start(context.Background(), peer, intent, approval); err != nil {
		t.Fatal(err)
	}
	ownedClose(t, m)
	cfg.IsolatedFixture = false
	if prod, err := ownednode.New(cfg); err == nil {
		ownedClose(t, prod)
		t.Fatal("fixture directory adopted as original production release")
	}
	cfg.IsolatedFixture = true
	reopened, err := ownednode.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer ownedClose(t, reopened)
	status, err := reopened.Status(peer)
	if err != nil || status.ProcessOwned || status.Stage != "stopped" {
		t.Fatalf("Close left owned child unreaped: %+v %v", status, err)
	}
}
